// Minecraft 服务器在线监控：轮询皮肤站状态，检测人数/玩家变化并主动播报到 QQ 群。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getMcAdminOverview, getMcServerStatus } from './skin-site.mjs'
import { getMcOnlinePlayers } from './mengli-site.mjs'
import { getMcPlayerSample } from './mc-ping.mjs'

function readState(file) {
  try {
    if (!existsSync(file)) return { servers: {} }
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && data.servers ? data : { servers: {} }
  } catch {
    return { servers: {} }
  }
}

function writeState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state, null, 2))
  } catch {
    // 状态写失败不影响下一轮
  }
}

function playersByServer(overview) {
  const map = new Map()
  for (const server of Array.isArray(overview?.servers) ? overview.servers : []) {
    const id = String(server.id || '')
    if (!id) continue
    const names = (Array.isArray(server.players) ? server.players : [])
      .map(player => String(player?.name || '').trim())
      .filter(Boolean)
    if (names.length) map.set(id, [...new Set(names)])
  }
  return map
}

function playerList(names) {
  return names.join('、')
}

function endpointOf(server) {
  const host = String(server?.host || '').trim()
  const port = Number(server?.port)
  if (host && Number.isInteger(port) && port > 0 && port <= 65535) return { host, port }
  const address = String(server?.address || '').trim()
  const match = address.match(/^([^:]+):(\d+)$/)
  if (!match) return null
  const fallbackPort = Number(match[2])
  if (!Number.isInteger(fallbackPort) || fallbackPort < 1 || fallbackPort > 65535) return null
  return { host: match[1], port: fallbackPort }
}

function limitedPlayerList(names, onlineCount, limit) {
  const max = Math.max(1, Math.min(20, Number(limit) || 5))
  const shown = names.slice(0, max)
  const total = Math.max(Number(onlineCount) || 0, names.length)
  return `${playerList(shown)}${total > shown.length ? ` 等 ${total} 人` : ''}`
}

function countChangeLine(server, previousCount, currentCount) {
  const delta = Number(currentCount) - Number(previousCount)
  return `${server.name} 在线人数 ${previousCount} → ${currentCount} 人${delta > 0 ? `（增加 ${delta}）` : `（减少 ${Math.abs(delta)}）`}。`
}

function diffPlayers(previousNames, names) {
  return {
    joined: names.filter(name => !previousNames.includes(name)),
    left: previousNames.filter(name => !names.includes(name)),
  }
}

function namedChangeLines(server, currentCount, names, joined, left, playerLimit = 5) {
  const lines = []
  const onlineLine = names.length
    ? `当前在线 ${currentCount} 人：${limitedPlayerList(names, currentCount, playerLimit)}`
    : `当前在线 ${currentCount} 人`
  if (joined.length) {
    lines.push(`[${server.name}]:▶ ${playerList(joined)} 加入了服务器`, onlineLine)
  }
  if (left.length) {
    lines.push(`[${server.name}]:◀ ${playerList(left)} 退出了服务器`, onlineLine)
  }
  return lines
}

function formatChange(server, previous, current, names, playerLimit = 5) {
  const previousCount = Number(previous.count) || 0
  const currentCount = Number(current.count) || 0
  if (previous.online !== current.online) {
    return [current.online
      ? `${server.name} 已上线，当前在线 ${currentCount} 人${names.length ? `：${limitedPlayerList(names, currentCount, playerLimit)}` : ''}。`
      : `${server.name} 已离线。`]
  }
  if (!current.online) return []
  const prevNames = Array.isArray(previous.players) ? previous.players : []
  const { joined, left } = diffPlayers(prevNames, names)
  const lines = namedChangeLines(server, currentCount, names, joined, left, playerLimit)
  if (lines.length) return lines
  if (previousCount !== currentCount) {
    return [countChangeLine(server, previousCount, currentCount)]
  }
  return []
}

// 站点 ping 只有约 2 秒窗口，一次超时就会返回离线；离线要连续确认，避免假播报。
export function applyServerObservation({
  server,
  previous,
  observed,
  names = [],
  offlineConfirmPolls = 2,
  playerLimit = 5,
  nameWaitPolls = 3,
  now = Date.now(),
}) {
  let next = { ...observed, offlinePolls: 0 }
  let confirmedOffline = false
  if (previous?.online && !next.online) {
    const offlinePolls = (Number(previous.offlinePolls) || 0) + 1
    if (offlinePolls < Math.max(1, Number(offlineConfirmPolls) || 2)) {
      return {
        next: { ...previous, at: next.at, offlinePolls },
        lines: [],
        suppressed: true,
        offlinePolls,
        confirmedOffline: false,
      }
    }
    confirmedOffline = true
  }
  if (!previous) {
    return { next, lines: [], suppressed: false, offlinePolls: 0, confirmedOffline }
  }
  if (!next.online) {
    return {
      next,
      lines: formatChange(server, previous, next, names, playerLimit),
      suppressed: false,
      offlinePolls: 0,
      confirmedOffline,
    }
  }
  if (!previous.online) {
    return {
      next: { ...next, pendingPolls: 0, pendingSince: 0, countOnlyAt: 0 },
      lines: formatChange(server, previous, next, names, playerLimit),
      suppressed: false,
      offlinePolls: 0,
      confirmedOffline,
    }
  }

  const prevNames = Array.isArray(previous.players) ? previous.players : []
  const previousCount = Number(previous.count) || 0
  const currentCount = Number(next.count) || 0
  const countChanged = previousCount !== currentCount
  const namesMissing = names.length === 0 && currentCount > 0
  const { joined, left } = namesMissing ? { joined: [], left: [] } : diffPlayers(prevNames, names)
  const hasNameDiff = joined.length > 0 || left.length > 0

  // 已经播过人数变化，等名单恢复后的这一轮只用来重建基线，避免再播一次退出/加入。
  if (previous.countOnlyAt && !namesMissing) {
    return {
      next: { ...next, countOnlyAt: 0, pendingPolls: 0, pendingSince: 0 },
      lines: [],
      suppressed: false,
      offlinePolls: 0,
      confirmedOffline,
    }
  }

  if (namesMissing && !countChanged) {
    return {
      next: { ...previous, at: next.at, pendingPolls: 0, pendingSince: 0 },
      lines: [],
      suppressed: true,
      offlinePolls: 0,
      confirmedOffline,
    }
  }

  // 人数变了但名单没变或没拿到：先等一轮，等名单同步后再播具体是谁，避免先报人数再报退出。
  if (countChanged && !hasNameDiff) {
    if (prevNames.length) {
      const pendingPolls = (Number(previous.pendingPolls) || 0) + 1
      if (pendingPolls < Math.max(1, Number(nameWaitPolls) || 3)) {
        return {
          next: {
            ...previous,
            at: next.at,
            pendingPolls,
            pendingSince: previous.pendingSince || now,
          },
          lines: [],
          suppressed: true,
          offlinePolls: 0,
          confirmedOffline,
          waitingNames: true,
          pendingPolls,
        }
      }
    } else if (previousCount === 0 && !namesMissing && names.length) {
      return {
        next: { ...next, countOnlyAt: 0, pendingPolls: 0, pendingSince: 0 },
        lines: namedChangeLines(server, currentCount, names, names, [], playerLimit),
        suppressed: false,
        offlinePolls: 0,
        confirmedOffline,
      }
    }
    return {
      next: { ...next, players: [], pendingPolls: 0, pendingSince: 0, countOnlyAt: now },
      lines: [countChangeLine(server, previousCount, currentCount)],
      suppressed: false,
      offlinePolls: 0,
      confirmedOffline,
      countOnly: true,
    }
  }

  next = { ...next, pendingPolls: 0, pendingSince: 0, countOnlyAt: 0 }
  return {
    next,
    lines: hasNameDiff
      ? namedChangeLines(server, currentCount, names, joined, left, playerLimit)
      : [],
    suppressed: false,
    offlinePolls: 0,
    confirmedOffline,
  }
}

export function startMcWatch({ root, groups, intervalMs = 20000, send, log, playerLimit = 5 }) {
  const groupList = [...new Set((groups || []).map(value => String(value).trim()).filter(Boolean))]
  if (!groupList.length) {
    log('服务器监控未启动：没有配置 QQBOT_MC_NOTIFY_GROUPS')
    return () => {}
  }
  const stateFile = join(root, 'runtime', 'mc-watch-state.json')
  let state = readState(stateFile)
  let stopped = false
  let running = false
  let timer = null
  let cookieWarned = false
  const interval = Math.max(10000, Number(intervalMs) || 20000)
  const offlineConfirmPolls = Math.max(1, Number(process.env.QQBOT_MC_OFFLINE_CONFIRM_POLLS) || 2)
  const nameWaitPolls = Math.max(1, Number(process.env.QQBOT_MC_NAME_WAIT_POLLS) || 3)
  const currentPlayerLimit = () => {
    const raw = typeof playerLimit === 'function' ? playerLimit() : playerLimit
    return Math.max(1, Math.min(20, Number(raw) || 5))
  }

  async function poll() {
    const status = await getMcServerStatus()
    let players = new Map()
    try {
      const overview = await getMcOnlinePlayers()
      players = playersByServer(overview)
    } catch (error) {
      try {
        const overview = await getMcAdminOverview()
        players = playersByServer(overview)
      } catch (fallbackError) {
        if (!cookieWarned) {
          cookieWarned = true
          log(`服务器监控：没有拿到在线玩家名单，先只播报人数变化（${String(error.message || error).slice(0, 120)}）`)
        }
      }
    }

    // 站点没有 game-report 心跳时 online_players 为空，但服务端 status ping 的 players.sample 仍可能带名单。
    const sampleTasks = []
    for (const server of status.servers || []) {
      if (!server.online) continue
      const id = String(server.id || '')
      const onlineCount = Math.max(0, Number(server.onlineCount) || 0)
      const knownNames = players.get(id) || []
      if (!onlineCount && !knownNames.length) continue
      if (knownNames.length && knownNames.length >= onlineCount) continue
      const endpoint = endpointOf(server)
      if (!endpoint) continue
      sampleTasks.push(getMcPlayerSample({ ...endpoint, timeoutMs: 3000 }).then(sample => {
        const expected = Math.max(onlineCount, Number(sample.online) || 0)
        if (sample.names.length && sample.names.length >= expected) {
          players.set(id, sample.names)
        }
      }).catch(() => {
        // 采样失败时继续使用人数兜底
      }))
    }
    if (sampleTasks.length) await Promise.all(sampleTasks)

    const lines = []
    const nextServers = {}
    for (const server of status.servers || []) {
      const id = String(server.id || '')
      if (!id) continue
      const onlineCount = Math.max(0, Number(server.onlineCount) || 0)
      const rawNames = players.get(id) || []
      const names = rawNames.length >= onlineCount ? rawNames : []
      const observed = {
        online: Boolean(server.online),
        count: onlineCount,
        players: names,
        at: new Date().toISOString(),
      }
      const previous = state.servers?.[id]
      const result = applyServerObservation({
        server,
        previous,
        observed,
        names,
        offlineConfirmPolls,
        playerLimit: currentPlayerLimit(),
        nameWaitPolls,
      })
      if (result.suppressed) {
        if (result.offlinePolls === 1) {
          log(`服务器监控：${server.name} 探测离线，等待下一次确认（${result.offlinePolls}/${offlineConfirmPolls}）`)
        } else if (result.waitingNames && result.pendingPolls === 1) {
          log(`服务器监控：${server.name} 人数变化但玩家名单暂不可用，等待下一次确认`)
        }
        nextServers[id] = result.next
        continue
      }
      if (result.countOnly) {
        log(`服务器监控：${server.name} 玩家名单连续 ${nameWaitPolls} 次不可用，先播报人数变化`)
      }
      if (result.confirmedOffline) {
        log(`服务器监控：${server.name} 连续 ${offlineConfirmPolls} 次探测离线，确认播报`)
      }
      nextServers[id] = result.next
      lines.push(...result.lines)
    }
    state = { ...state, servers: nextServers, updatedAt: new Date().toISOString() }
    writeState(stateFile, state)

    if (!lines.length) return
    const text = ['【服务器播报】', ...lines].join('\n')
    for (const groupId of groupList) {
      try {
        await send(groupId, text)
        log(`服务器播报已发送 group=${groupId.slice(0, 8)}… ${lines.length} 条变化`)
      } catch (error) {
        log(`服务器播报发送失败 group=${groupId.slice(0, 8)}…：${String(error.message || error).slice(0, 200)}`)
      }
    }
  }

  async function loop() {
    if (stopped || running) return
    running = true
    try {
      await poll()
    } catch (error) {
      log(`服务器监控轮询失败：${String(error.message || error).slice(0, 200)}`)
    } finally {
      running = false
      if (!stopped) timer = setTimeout(loop, interval)
    }
  }

  log(`服务器监控已启动，每 ${Math.round(interval / 1000)} 秒检查一次，目标群 ${groupList.length} 个`)
  void loop()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
