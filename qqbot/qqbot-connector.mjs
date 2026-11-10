#!/usr/bin/env node
// QQ 官方机器人常驻连接：access_token -> gateway -> identify/resume -> heartbeat。
// 只维护连接与状态，不自动回复、不处理消息内容。凭据只从环境变量读取，不落盘。
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const runtimeDir = join(root, 'runtime')
mkdirSync(runtimeDir, { recursive: true })

const APP_ID = (process.env.QQBOT_APPID || '').trim()
const APP_SECRET = (process.env.QQBOT_SECRET || '').trim()
if (!APP_ID || !APP_SECRET) {
  console.error('缺少环境变量 QQBOT_APPID / QQBOT_SECRET')
  process.exit(1)
}

const SANDBOX = /^(1|true|yes)$/i.test(process.env.QQBOT_SANDBOX || '')
const API_BASE = SANDBOX ? 'https://sandbox.api.bot.qq.com' : 'https://api.bot.qq.com'
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
// 群与单聊 + 互动事件 + 频道 @ 消息，与宿主默认 intents 一致
const DEFAULT_INTENTS = (1 << 25) | (1 << 26) | (1 << 30)
const INTENTS = Number.parseInt(process.env.QQBOT_INTENTS || '', 10) || DEFAULT_INTENTS

const PID_FILE = join(runtimeDir, 'connector.pid')
const STATUS_FILE = join(runtimeDir, 'status.json')
const LOG_FILE = join(runtimeDir, 'connector.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024

let logWrites = 0
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  try {
    if (++logWrites % 200 === 0 && existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      writeFileSync(LOG_FILE, '')
    }
    appendFileSync(LOG_FILE, line + '\n')
  } catch {
    // 日志失败不影响连接
  }
}

// 单实例：bridge/connector 二选一，避免同一机器人争抢网关
for (const name of ['connector.pid', 'bridge.pid']) {
  const file = join(runtimeDir, name)
  if (!existsSync(file)) continue
  const pid = Number(readFileSync(file, 'utf8').trim())
  if (!pid || pid === process.pid) continue
  try {
    process.kill(pid, 0)
    console.error(`已有网关进程在运行（${name}: pid=${pid}），先停止它再启动`)
    process.exit(2)
  } catch {
    // 陈旧 pid 文件，继续启动
  }
}
writeFileSync(PID_FILE, String(process.pid))

let ws = null
let heartbeatTimer = null
let token = null
let sessionId = null
let lastSeq = 0
let lastAck = 0
let connectedAt = null
let botInfo = null
let eventCount = 0
let lastEventType = null
let stopped = false
let backoff = 1000
let lastError = null

function writeStatus(extra = {}) {
  const status = {
    appId: APP_ID,
    sandbox: SANDBOX,
    pid: process.pid,
    connected: Boolean(ws && ws.readyState === 1 && sessionId),
    bot: botInfo ? { id: botInfo.id, username: botInfo.username } : null,
    sessionId,
    connectedAt,
    updatedAt: new Date().toISOString(),
    eventCount,
    lastEventType,
    lastError,
    ...extra,
  }
  try {
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2))
  } catch {
    // 状态文件失败不影响连接
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text.slice(0, 300) }
  }
  if (!response.ok) {
    const detail = data.message || data.msg || data.error || data.raw || ''
    throw new Error(`HTTP ${response.status} ${detail}`.trim())
  }
  return data
}

async function fetchToken() {
  const data = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: APP_ID, clientSecret: APP_SECRET }),
  })
  if (!data.access_token) throw new Error('token 响应缺少 access_token')
  return data.access_token
}

async function fetchGateway(accessToken) {
  const data = await fetchJson(`${API_BASE}/gateway/bot`, {
    headers: { Authorization: `QQBot ${accessToken}`, 'X-Union-Appid': APP_ID },
  })
  if (!data.url) throw new Error('gateway 响应缺少 url')
  return data.url
}

function send(payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload))
}

function startHeartbeat(interval) {
  clearInterval(heartbeatTimer)
  const beat = () => {
    if (!ws || ws.readyState !== 1) return
    if (lastAck && Date.now() - lastAck > interval * 2) {
      log('心跳超时，主动重连')
      ws.close(4002, 'heartbeat timeout')
      return
    }
    send({ op: 1, d: lastSeq || null })
  }
  beat()
  heartbeatTimer = setInterval(beat, interval)
}

function onMessage(event) {
  let payload
  try {
    payload = JSON.parse(event.data)
  } catch {
    return
  }
  if (typeof payload.s === 'number') lastSeq = payload.s

  switch (payload.op) {
    case 10: {
      const interval = Math.max(5000, payload.d?.heartbeat_interval || 45000)
      log(`HELLO heartbeat_interval=${interval}ms`)
      startHeartbeat(interval)
      if (sessionId && lastSeq) {
        send({ op: 6, d: { token: `QQBot ${token}`, session_id: sessionId, seq: lastSeq } })
        log(`RESUME session=${sessionId} seq=${lastSeq}`)
      } else {
        send({ op: 2, d: { token: `QQBot ${token}`, intents: INTENTS, shard: [0, 1] } })
        log(`IDENTIFY intents=${INTENTS} shard=0/1`)
      }
      break
    }
    case 11:
      lastAck = Date.now()
      break
    case 7:
      log('网关要求重连')
      ws?.close(4000, 'reconnect requested')
      break
    case 9:
      log('会话失效，重新 IDENTIFY')
      sessionId = null
      lastSeq = 0
      ws?.close(4001, 'invalid session')
      break
    case 0:
      if (payload.t === 'READY') {
        sessionId = payload.d?.session_id || null
        botInfo = payload.d?.user || null
        connectedAt = new Date().toISOString()
        lastAck = Date.now()
        backoff = 1000
        lastError = null
        log(`READY bot=${botInfo?.username || '?'} id=${botInfo?.id || '?'} session=${sessionId}`)
        writeStatus()
      } else {
        eventCount += 1
        lastEventType = payload.t || 'UNKNOWN'
        log(`EVENT ${lastEventType} seq=${payload.s ?? '?'}`)
        writeStatus()
      }
      break
    default:
      break
  }
}

function scheduleReconnect() {
  if (stopped) return
  const delay = Math.round(Math.min(60000, backoff) * (0.75 + Math.random() * 0.5))
  backoff = Math.min(60000, backoff * 2)
  log(`${delay}ms 后重连`)
  setTimeout(connect, delay)
}

async function connect() {
  if (stopped) return
  try {
    token = await fetchToken()
    const gateway = await fetchGateway(token)
    log(`连接网关 ${gateway.split('?')[0]}`)
    ws = new WebSocket(gateway, {
      headers: { Authorization: `QQBot ${token}`, 'X-Union-Appid': APP_ID },
    })
    ws.onopen = () => log('WebSocket 已打开')
    ws.onmessage = onMessage
    ws.onerror = event => {
      lastError = event?.message || event?.type || 'WebSocket error'
      log(`WebSocket 错误：${lastError}`)
    }
    ws.onclose = event => {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
      log(`WebSocket 关闭 code=${event.code} reason=${event.reason || ''}`)
      ws = null
      writeStatus({ connected: false })
      if (!stopped) scheduleReconnect()
    }
  } catch (error) {
    lastError = error?.message || String(error)
    log(`连接失败：${lastError}`)
    writeStatus({ connected: false })
    scheduleReconnect()
  }
}

function shutdown(signal) {
  log(`收到 ${signal}，停止连接`)
  stopped = true
  clearInterval(heartbeatTimer)
  try {
    ws?.close(1000, 'shutdown')
  } catch {
    // 忽略
  }
  writeStatus({ connected: false })
  try {
    if (Number(readFileSync(PID_FILE, 'utf8').trim()) === process.pid) unlinkSync(PID_FILE)
  } catch {
    // 忽略
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', error => {
  lastError = error?.stack || String(error)
  log(`未捕获异常：${lastError}`)
})
process.on('unhandledRejection', error => {
  lastError = error?.stack || String(error)
  log(`未处理 Promise 异常：${lastError}`)
})

log(`启动 QQ 机器人连接 appId=${APP_ID} sandbox=${SANDBOX} intents=${INTENTS}`)
writeStatus()
connect()
