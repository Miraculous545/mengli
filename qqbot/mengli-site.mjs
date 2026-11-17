// 皮肤站梦璃插件的账号绑定/查询客户端。只读/绑定接口，不写站点核心数据。
const BASE = (process.env.SWUSTMC_BASE_URL || 'https://www.swustmc.com').replace(/\/+$/, '')
const TOKEN = (process.env.MENGLI_INGEST_TOKEN || '').trim()
const API_KEY = (process.env.SWUSTMC_API_KEY || '').trim()
const TIMEOUT_MS = 6000

export function mengliSiteConfigured() {
  return Boolean(TOKEN)
}

async function post(path, body, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!TOKEN) throw new Error('未配置 MENGLI_INGEST_TOKEN')
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({ ...body, token: TOKEN }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok || data?.ok === false) {
    const message = String(data?.error?.message || `皮肤站 HTTP ${response.status}`)
    if (/token/i.test(message)) {
      throw new Error('皮肤站梦璃插件 token 不一致或未配置，请让站点和机器人使用同一个 MENGLI_INGEST_TOKEN')
    }
    if (/没有权限使用该插件/.test(message)) {
      throw new Error(API_KEY
        ? '皮肤站 API key 缺少 plugin:mengli:use 权限，请给机器人使用的 API key 授权“使用 梦璃”'
        : '皮肤站未配置 SWUSTMC_API_KEY，且游客没有“使用 梦璃”权限；请配置 API key')
    }
    throw new Error(message)
  }
  return data?.data ?? data
}

export async function bindMengliAccount({ code, bindingKey, userId, nickname }) {
  return post('/api/plugins/mengli/bind', { code, bindingKey, userId, nickname })
}

export async function lookupMengliBinding(bindingKey, { userId = '' } = {}) {
  const data = await post('/api/plugins/mengli/lookup', { bindingKey, userId }, { timeoutMs: 9000 })
  return data?.bound ? data : null
}

export async function getMcOnlinePlayers() {
  return post('/api/plugins/mengli/mc-players', {})
}

export async function getMcPlaytime({ siteUserId, siteUsername, bindingKey }) {
  return post('/api/plugins/mengli/playtime', { siteUserId, siteUsername, bindingKey })
}
