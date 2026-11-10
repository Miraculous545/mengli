#!/usr/bin/env node
// 用 YuDream 登录 token 从后台拉取 AI 群聊人设，写入 persona/mc-mengli.md。
// 用法：
//   setx YUDREAM_TOKEN "浏览器里的 Authorization 值"
//   node fetch-persona.mjs [--list]
// 可选：YUDREAM_BASE_URL、YUDREAM_CONNECTION_ID、YUDREAM_CHANNEL_ID。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const BASE = (process.env.YUDREAM_BASE_URL || 'https://www.swustmc.cn').replace(/\/+$/, '')
const TOKEN = (process.env.YUDREAM_TOKEN || '').trim()
const COOKIE = (process.env.YUDREAM_COOKIE || '').trim()
const ONLY_CONNECTION = (process.env.YUDREAM_CONNECTION_ID || '').trim()
const ONLY_CHANNEL = (process.env.YUDREAM_CHANNEL_ID || '').trim()
const OUT_FILE = process.env.QQBOT_PERSONA_FILE || join(ROOT, 'persona', 'mc-mengli.md')
const LIST_ONLY = process.argv.includes('--list')

if (!TOKEN && !COOKIE) {
  console.error('缺少 YUDREAM_TOKEN（或 YUDREAM_COOKIE）。')
  console.error('获取方式：浏览器登录站点后，DevTools → Network → 任一 /api 请求 → Request Headers → Authorization。')
  process.exit(1)
}

async function api(path) {
  const headers = { Accept: 'application/json' }
  if (TOKEN) headers.Authorization = TOKEN
  if (COOKIE) headers.Cookie = COOKIE
  const response = await fetch(BASE + path, { headers })
  const text = await response.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`HTTP ${response.status}：响应不是 JSON（${text.slice(0, 120)}）`)
  }
  if (!response.ok || (body.code !== undefined && body.code !== 200 && body.code !== 0)) {
    throw new Error(`HTTP ${response.status}：${body.message || body.msg || '请求失败'}`)
  }
  return body.data ?? body
}

function connectionName(option) {
  return option?.label || option?.name || option?.displayName || String(option?.value ?? option?.id ?? '')
}

function connectionId(option) {
  return String(option?.value ?? option?.id ?? option?.connectionId ?? '')
}

function safeName(value) {
  return String(value || 'unknown').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
}

const [policies, connections] = await Promise.all([
  api('/api/plugins/ai-chatbot/admin/policies'),
  api('/api/plugins/ai-chatbot/admin/options/connections').catch(() => []),
])

const names = new Map()
for (const connection of Array.isArray(connections) ? connections : []) {
  names.set(connectionId(connection), connectionName(connection))
}

const rows = (Array.isArray(policies) ? policies : [])
  .filter(policy => policy && typeof policy.persona === 'string' && policy.persona.trim())
  .filter(policy => !ONLY_CONNECTION || String(policy.connectionId) === ONLY_CONNECTION)
  .filter(policy => !ONLY_CHANNEL || String(policy.channelId) === ONLY_CHANNEL)

if (!rows.length) {
  console.error('没有找到配置了人设的群策略。')
  console.error('请确认「AI 群聊助手 → 群聊配置」里对应群的人设字段非空，或提供 YUDREAM_CONNECTION_ID / YUDREAM_CHANNEL_ID。')
  process.exit(1)
}

const scored = rows.map(policy => {
  const name = names.get(String(policy.connectionId)) || ''
  const score = (name.includes('梦璃') || /mengli/i.test(name) ? 100 : 0)
    + (policy.persona.includes('梦璃') ? 50 : 0)
    + (policy.enabled ? 5 : 0)
  return { policy, name, score }
}).sort((a, b) => b.score - a.score || b.policy.persona.length - a.policy.persona.length)

console.log(`找到 ${scored.length} 条带人设的群策略：`)
for (const row of scored) {
  console.log(`- 连接 ${row.name || row.policy.connectionId}（${row.policy.connectionId}） / 群 ${row.policy.channelId} / ${row.policy.persona.trim().length} 字${row.policy.enabled ? '' : '（未启用）'}`)
}

if (LIST_ONLY) process.exit(0)

const best = scored[0]
if (scored.length > 1 && best.score < 100) {
  const dir = join(ROOT, 'persona', 'candidates')
  mkdirSync(dir, { recursive: true })
  for (const row of scored) {
    const file = join(dir, `${safeName(row.name || row.policy.connectionId)}-${safeName(row.policy.channelId)}.md`)
    writeFileSync(file, `${row.policy.persona.trim()}\n`, 'utf8')
    console.log(`已写出候选：${file}`)
  }
  console.error('')
  console.error('有多个候选且无法按名称判断「MC梦璃」。请设置 YUDREAM_CONNECTION_ID 后重跑，或直接把正确的那份复制到 persona/mc-mengli.md。')
  process.exit(2)
}

const header = `<!-- 来源：${BASE}/api/plugins/ai-chatbot/admin/policies；连接 ${best.name || best.policy.connectionId}（${best.policy.connectionId}）；群 ${best.policy.channelId}；拉取于 ${new Date().toISOString()} -->\n`
mkdirSync(dirname(OUT_FILE), { recursive: true })
writeFileSync(OUT_FILE, header + best.policy.persona.trim() + '\n', 'utf8')
console.log('')
console.log(`已写入 ${OUT_FILE}（${best.policy.persona.trim().length} 字）。下一条 QQ 消息自动生效。`)
