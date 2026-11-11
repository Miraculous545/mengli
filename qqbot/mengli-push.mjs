// 把 QQ 群事件日志和群友记忆快照推送到皮肤站的 mengli 插件。
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_ENDPOINT = 'https://www.swustmc.com/api/plugins/mengli/ingest'
const MAX_LOG_BATCH = 200
const MEMORY_INTERVAL_MS = 30000

function readState(file) {
  try {
    if (!existsSync(file)) return { offset: 0, lastMemoryAt: 0 }
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return {
      offset: Number(data.offset || 0),
      lastMemoryAt: Number(data.lastMemoryAt || 0),
    }
  } catch {
    return { offset: 0, lastMemoryAt: 0 }
  }
}

function writeState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state, null, 2))
  } catch {
    // 状态写失败不影响下一轮
  }
}

function readLocalSettings(file) {
  try {
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function readLocalBindings(file) {
  try {
    if (!existsSync(file)) return {}
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const bindings = data?.bindings
    if (!bindings || typeof bindings !== 'object') return {}
    return Object.fromEntries(Object.entries(bindings)
      .filter(([key, binding]) => key && binding && typeof binding === 'object'))
  } catch {
    return {}
  }
}

function applyRemoteSettings(file, settings, log) {
  if (!settings || typeof settings !== 'object') return false
  const current = readLocalSettings(file)
  const next = {
    mediaEnabled: settings.mediaEnabled !== false,
    mcPlayerLimit: Number(settings.mcPlayerLimit) || 5,
    autoReplyEnabled: settings.autoReplyEnabled === true,
    autoReplyProbability: Number(settings.autoReplyProbability) || 0,
    autoReplyCooldownSeconds: Number(settings.autoReplyCooldownSeconds) || 0,
    autoReplySmart: settings.autoReplySmart !== false,
    autoReplyUserCooldownSeconds: Number(settings.autoReplyUserCooldownSeconds) || 0,
    memoryEnabled: settings.memoryEnabled !== false,
    memoryRetentionDays: Number(settings.memoryRetentionDays) || 0,
    memoryRecentMessages: Number(settings.memoryRecentMessages) || 6,
    memoryAutoProfile: settings.memoryAutoProfile === true,
    memoryAutoProfileEvery: Number(settings.memoryAutoProfileEvery) || 20,
    // 独立记忆群只在本地监控页配置，站点设置里没有这个字段时不能把它覆盖掉。
    memoryIsolatedGroups: Array.isArray(settings.memoryIsolatedGroups)
      ? settings.memoryIsolatedGroups
      : (Array.isArray(current?.memoryIsolatedGroups) ? current.memoryIsolatedGroups : []),
  }
  if (current && JSON.stringify(current) === JSON.stringify(next)) return false
  try {
    writeFileSync(file, JSON.stringify(next, null, 2))
    log('梦璃站点设置已同步到本地')
    return true
  } catch (error) {
    log(`梦璃站点设置写入失败：${String(error.message || error).slice(0, 160)}`)
    return false
  }
}

function readNewEvents(file, offset) {
  if (!existsSync(file)) return { events: [], nextOffset: offset }
  const size = statSync(file).size
  const start = size < offset ? 0 : Math.max(0, offset)
  const buffer = readFileSync(file)
  const chunk = buffer.subarray(start)
  const text = chunk.toString('utf8')
  const parts = text.split('\n')
  const tail = parts.pop() || ''
  const consumed = chunk.length - Buffer.byteLength(tail, 'utf8')
  const events = []
  for (const line of parts) {
    const value = line.trim()
    if (!value) continue
    try {
      events.push(JSON.parse(value))
    } catch {
      // 忽略损坏行
    }
  }
  return {
    events: events.slice(-MAX_LOG_BATCH),
    nextOffset: start + consumed,
  }
}

function memorySnapshot(memoryStore) {
  const stats = memoryStore.stats()
  const members = memoryStore.listMembers({ limit: 300 }).map(member => {
    const detail = memoryStore.getMemberDetail(member.id)
    const connections = [...new Set([member.connectionKey, ...(member.connections || [])].filter(Boolean))]
    const bindingKeys = connections.map(connection => `${connection}:${member.userOpenid}`)
    return {
      id: member.id,
      connectionKey: connections[0] || member.connectionKey,
      connections,
      scopeKey: member.scopeKey || 'global',
      bindingKey: bindingKeys[0] || '',
      bindingKeys,
      nickname: member.nickname,
      aliases: member.aliases,
      summary: member.summary,
      personality: member.personality,
      interactionStyle: member.interactionStyle,
      tags: member.tags,
      facts: member.facts,
      observedMessageCount: member.observedMessageCount,
      replyTriggeredCount: member.replyTriggeredCount,
      replyCompletedCount: member.replyCompletedCount,
      replyFailedCount: member.replyFailedCount,
      lastActivityAt: member.lastActivityAt,
      lastAnalyzedAt: member.lastAnalyzedAt,
      notes: (detail?.notes || []).slice(0, 10).map(note => ({ content: note.content, source: note.source, createdAt: note.createdAt })),
      recentMessages: (detail?.messages || []).slice(-5).map(message => ({ content: message.content, createdAt: message.createdAt })),
    }
  })
  return {
    updatedAt: new Date().toISOString(),
    stats,
    members,
  }
}

export function startMengliPush({ root, memoryStore, log }) {
  const endpoint = (process.env.MENGLI_INGEST_URL || DEFAULT_ENDPOINT).trim()
  const token = (process.env.MENGLI_INGEST_TOKEN || '').trim()
  if (!token) {
    log('梦璃站点推送未启用：未配置 MENGLI_INGEST_TOKEN')
    return () => {}
  }

  const eventsFile = join(root, 'runtime', 'events.jsonl')
  const stateFile = join(root, 'runtime', 'mengli-push-state.json')
  const settingsFile = join(root, 'runtime', 'bot-settings.json')
  const bindingsFile = join(root, 'runtime', 'mengli-bindings.json')
  let state = readState(stateFile)
  let stopped = false
  let running = false
  let timer = null
  let lastErrorLogAt = 0

  async function tick() {
    if (stopped || running) return
    running = true
    try {
      const batch = readNewEvents(eventsFile, state.offset)
      const now = Date.now()
      const includeMemory = now - state.lastMemoryAt >= MEMORY_INTERVAL_MS
      if (!batch.events.length && !includeMemory) return

      const bindings = readLocalBindings(bindingsFile)
      const payload = {
        token,
        logs: batch.events,
        settings: readLocalSettings(settingsFile),
        bindings,
        pushedAt: new Date().toISOString(),
      }
      if (includeMemory) payload.memory = memorySnapshot(memoryStore)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`)
      }
      let result = {}
      try {
        result = await response.json()
      } catch {
        result = {}
      }
      const data = result?.data ?? result
      applyRemoteSettings(settingsFile, data?.settings, log)
      state = {
        offset: batch.nextOffset,
        lastMemoryAt: includeMemory ? now : state.lastMemoryAt,
      }
      writeState(stateFile, state)
      log(`梦璃推送成功：日志 ${batch.events.length} 条${includeMemory ? `，群友 ${payload.memory.members.length} 位` : ''}${Object.keys(bindings).length ? `，绑定 ${Object.keys(bindings).length} 条` : ''}`)
    } catch (error) {
      const now = Date.now()
      if (now - lastErrorLogAt > 5 * 60 * 1000) {
        lastErrorLogAt = now
        log(`梦璃推送失败：${String(error.message || error).slice(0, 240)}`)
      }
    } finally {
      running = false
      if (!stopped) timer = setTimeout(tick, 15000)
    }
  }

  log(`梦璃站点推送已启动：${endpoint}`)
  timer = setTimeout(tick, 10000)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
