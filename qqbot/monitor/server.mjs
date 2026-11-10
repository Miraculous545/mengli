#!/usr/bin/env node
// 梦璃 QQ 监控面板：本地 HTTP 服务 + SSE 实时事件流；设置通过 /api/settings 写入。
// 数据来源：runtime/events.jsonl（结构化事件）、runtime/bridge-status.json、runtime/agent-bridge.log。
import http from 'node:http'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../memory/store.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RUNTIME_DIR = join(ROOT, 'runtime')
const EVENTS_FILE = join(RUNTIME_DIR, 'events.jsonl')
const STATUS_FILE = join(RUNTIME_DIR, 'bridge-status.json')
const LOG_FILE = join(RUNTIME_DIR, 'agent-bridge.log')
const SETTINGS_FILE = join(RUNTIME_DIR, 'bot-settings.json')
const MEMORY_DB_FILE = join(RUNTIME_DIR, 'memory.db')
const HTML_FILE = join(ROOT, 'monitor', 'index.html')
const memoryStore = new MemoryStore(MEMORY_DB_FILE).init()

const PORT = Number(process.env.QQBOT_MONITOR_PORT || 8765)
const HOST = process.env.QQBOT_MONITOR_HOST || '127.0.0.1'
const TICK_MS = 700
const MAX_CLIENTS = 32

const clients = new Set()

function readText(path, fallback = '') {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return fallback
  }
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readText(path))
  } catch {
    return fallback
  }
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function readRange(path, start, end) {
  const length = Math.max(0, end - start)
  if (!length) return ''
  let fd = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, start)
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

function readEvents(limit = 500) {
  const text = readText(EVENTS_FILE)
  if (!text) return []
  const lines = text.split('\n').filter(Boolean)
  const selected = lines.slice(-Math.max(1, limit))
  const events = []
  for (const line of selected) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // 跳过损坏行
    }
  }
  return events
}

function readRawLines(limit = 300) {
  const text = readText(LOG_FILE)
  if (!text) return []
  return text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, limit))
}

function readStatus() {
  return readJson(STATUS_FILE, {})
}

const DEFAULT_SETTINGS = {
  mediaEnabled: true,
  autoReplyEnabled: false,
  autoReplyProbability: 0.1,
  autoReplyCooldownSeconds: 30,
  autoReplySmart: true,
  autoReplyUserCooldownSeconds: 60,
  memoryEnabled: true,
  memoryRetentionDays: 90,
  memoryRecentMessages: 6,
  memoryAutoProfile: false,
  memoryAutoProfileEvery: 20,
  mcPlayerLimit: 5,
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSettings(input) {
  const data = input && typeof input === 'object' ? input : {}
  return {
    mediaEnabled: typeof data.mediaEnabled === 'boolean' ? data.mediaEnabled : DEFAULT_SETTINGS.mediaEnabled,
    autoReplyEnabled: typeof data.autoReplyEnabled === 'boolean' ? data.autoReplyEnabled : DEFAULT_SETTINGS.autoReplyEnabled,
    autoReplyProbability: clampNumber(data.autoReplyProbability, 0, 1, DEFAULT_SETTINGS.autoReplyProbability),
    autoReplyCooldownSeconds: clampNumber(data.autoReplyCooldownSeconds, 0, 3600, DEFAULT_SETTINGS.autoReplyCooldownSeconds),
    autoReplySmart: typeof data.autoReplySmart === 'boolean' ? data.autoReplySmart : DEFAULT_SETTINGS.autoReplySmart,
    autoReplyUserCooldownSeconds: clampNumber(data.autoReplyUserCooldownSeconds, 0, 3600, DEFAULT_SETTINGS.autoReplyUserCooldownSeconds),
    memoryEnabled: typeof data.memoryEnabled === 'boolean' ? data.memoryEnabled : DEFAULT_SETTINGS.memoryEnabled,
    memoryRetentionDays: clampNumber(data.memoryRetentionDays, 0, 3650, DEFAULT_SETTINGS.memoryRetentionDays),
    memoryRecentMessages: clampNumber(data.memoryRecentMessages, 1, 20, DEFAULT_SETTINGS.memoryRecentMessages),
    memoryAutoProfile: typeof data.memoryAutoProfile === 'boolean' ? data.memoryAutoProfile : DEFAULT_SETTINGS.memoryAutoProfile,
    memoryAutoProfileEvery: clampNumber(data.memoryAutoProfileEvery, 5, 500, DEFAULT_SETTINGS.memoryAutoProfileEvery),
    mcPlayerLimit: clampNumber(data.mcPlayerLimit, 1, 20, DEFAULT_SETTINGS.mcPlayerLimit),
  }
}

function readSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      return normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')))
    }
  } catch {
    // ignore broken file
  }
  return { ...DEFAULT_SETTINGS }
}

function writeSettings(next) {
  const settings = normalizeSettings(next)
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  return settings
}

function buildGroups(events) {
  const groups = new Map()
  for (const event of events) {
    if (event.event !== 'inbound' || event.kind !== 'group' || !event.peerId) continue
    let group = groups.get(event.peerId)
    if (!group) {
      group = {
        peerId: event.peerId,
        count: 0,
        mediaOnly: 0,
        lastTs: null,
        lastUser: null,
      }
      groups.set(event.peerId, group)
    }
    group.count += 1
    if (event.mediaOnly) group.mediaOnly += 1
    group.lastTs = event.ts || group.lastTs
    group.lastUser = event.userId || group.lastUser
  }
  return [...groups.values()].sort((left, right) => String(right.lastTs || '').localeCompare(String(left.lastTs || '')))
}

function sendEvent(response, name, data) {
  try {
    response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    // 客户端已断开
  }
}

function broadcast(name, data) {
  for (const response of clients) sendEvent(response, name, data)
}

function json(response, status, data) {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readJsonBody(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', chunk => {
      body += chunk
      if (body.length > limit) {
        reject(new Error('请求体过大'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

let eventOffset = fileSize(EVENTS_FILE)
let rawOffset = fileSize(LOG_FILE)
let lastStatusText = readText(STATUS_FILE)

function tick() {
  const evSize = fileSize(EVENTS_FILE)
  if (evSize < eventOffset) {
    eventOffset = 0
    broadcast('events-reset', {})
  }
  if (evSize > eventOffset) {
    const chunk = readRange(EVENTS_FILE, eventOffset, evSize)
    eventOffset = evSize
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        broadcast('event', JSON.parse(trimmed))
      } catch {
        // 跳过损坏行
      }
    }
  }

  const logSize = fileSize(LOG_FILE)
  if (logSize < rawOffset) {
    rawOffset = 0
    broadcast('raw-reset', {})
  }
  if (logSize > rawOffset) {
    const chunk = readRange(LOG_FILE, rawOffset, logSize)
    rawOffset = logSize
    for (const line of chunk.split(/\r?\n/)) {
      if (line) broadcast('raw', { line })
    }
  }

  const statusText = readText(STATUS_FILE)
  if (statusText && statusText !== lastStatusText) {
    lastStatusText = statusText
    try {
      broadcast('status', JSON.parse(statusText))
    } catch {
      // 状态文件可能正在写入
    }
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = readText(HTML_FILE, '<h1>monitor/index.html 不存在</h1>')
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    })
    response.end(html)
    return
  }

  if (url.pathname === '/api/health') {
    json(response, 200, { ok: true, pid: process.pid, port: PORT, clients: clients.size })
    return
  }

  if (url.pathname === '/api/bootstrap') {
    const limit = Math.min(2000, Math.max(20, Number(url.searchParams.get('limit') || 500)))
    const events = readEvents(limit)
    json(response, 200, {
      status: readStatus(),
      settings: readSettings(),
      memoryStats: memoryStore.stats(),
      events,
      groups: buildGroups(events),
      raw: readRawLines(150),
      generatedAt: new Date().toISOString(),
    })
    return
  }

  if (url.pathname === '/api/settings' && request.method === 'POST') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
      if (body.length > 64 * 1024) request.destroy()
    })
    request.on('end', () => {
      try {
        const input = JSON.parse(body || '{}')
        const next = writeSettings({ ...readSettings(), ...input })
        json(response, 200, { ok: true, settings: next })
      } catch (error) {
        json(response, 400, { ok: false, error: error.message })
      }
    })
    return
  }

  if (url.pathname === '/api/settings') {
    json(response, 200, { settings: readSettings() })
    return
  }

  if (url.pathname === '/api/memory' && request.method === 'GET') {
    const query = url.searchParams.get('query') || ''
    const limit = Number(url.searchParams.get('limit') || 200)
    json(response, 200, { members: memoryStore.listMembers({ query, limit }), stats: memoryStore.stats() })
    return
  }

  if (url.pathname === '/api/memory/member' && request.method === 'GET') {
    const id = Number(url.searchParams.get('id') || 0)
    const detail = memoryStore.getMemberDetail(id)
    if (!detail) {
      json(response, 404, { error: '群友记忆不存在' })
      return
    }
    json(response, 200, detail)
    return
  }

  if (url.pathname === '/api/memory/member' && request.method === 'PUT') {
    readJsonBody(request).then(body => {
      const member = memoryStore.updateProfile(Number(body.id), body)
      json(response, 200, { ok: true, member })
    }).catch(error => json(response, 400, { error: error.message }))
    return
  }

  if (url.pathname === '/api/memory/member' && request.method === 'DELETE') {
    const id = Number(url.searchParams.get('id') || 0)
    json(response, 200, { ok: memoryStore.deleteMember(id) })
    return
  }

  if (url.pathname === '/api/memory/note' && request.method === 'POST') {
    readJsonBody(request).then(body => {
      const note = memoryStore.addNote(Number(body.memberId), body.content, body.source || 'manual')
      json(response, 200, { ok: true, note })
    }).catch(error => json(response, 400, { error: error.message }))
    return
  }

  if (url.pathname === '/api/memory/note' && request.method === 'DELETE') {
    const id = Number(url.searchParams.get('id') || 0)
    json(response, 200, { ok: memoryStore.deleteNote(id) })
    return
  }

  if (url.pathname === '/api/raw') {
    const limit = Math.min(2000, Math.max(20, Number(url.searchParams.get('limit') || 300)))
    json(response, 200, { lines: readRawLines(limit) })
    return
  }

  if (url.pathname === '/api/stream') {
    if (clients.size >= MAX_CLIENTS) {
      json(response, 503, { error: 'too many clients' })
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write('retry: 2000\n\n')
    clients.add(response)
    sendEvent(response, 'hello', { status: readStatus(), events: readEvents(300), groups: buildGroups(readEvents(500)) })
    const heartbeat = setInterval(() => {
      try {
        response.write(': ping\n\n')
      } catch {
        // ignore
      }
    }, 15000)
    request.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(response)
    })
    return
  }

  if (url.pathname === '/favicon.ico') {
    response.writeHead(204)
    response.end()
    return
  }

  json(response, 404, { error: 'not found' })
})

server.on('error', error => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用；设置 QQBOT_MONITOR_PORT 换一个端口，或先停止旧进程。`)
  } else {
    console.error('监控服务启动失败：', error)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`梦璃监控面板：http://${HOST}:${PORT}/`)
  console.log(`数据文件：${EVENTS_FILE}`)
})

setInterval(tick, TICK_MS)

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
process.on('SIGTERM', () => {
  server.close()
  process.exit(0)
})
