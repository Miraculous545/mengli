// 西南科技大学 Minecraft 星空社皮肤站只读客户端。
// API key 只从环境变量读取，不写入仓库；这里不提供任何写操作。
const BASE = (process.env.SWUSTMC_BASE_URL || 'https://www.swustmc.com').replace(/\/+$/, '')
const API_KEY = (process.env.SWUSTMC_API_KEY || '').trim()
const TIMEOUT_MS = 15000

function configured() {
  return Boolean(API_KEY)
}

function absoluteUrl(path) {
  if (!path) return ''
  try {
    return new URL(path, BASE).href
  } catch {
    return ''
  }
}

async function request(path) {
  if (!API_KEY) throw new Error('未配置 SWUSTMC_API_KEY')
  const response = await fetch(BASE + path, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'X-API-Key': API_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok || data?.ok === false) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new Error(`皮肤站 API：${message}`)
  }
  return data?.data ?? data
}

export function skinSiteConfigured() {
  return configured()
}

export async function getMcServerStatus() {
  const data = await request('/api/plugins/minecraft-server/status')
  return {
    checkedAt: data?.checkedAt || null,
    servers: (Array.isArray(data?.servers) ? data.servers : []).map(server => ({
      id: server.id,
      name: server.name || server.id || '未命名服务器',
      address: server.address || '',
      host: server.host || '',
      port: Number(server.port || 25565),
      online: Boolean(server.online),
      onlineCount: Number(server.onlineCount || 0),
      maxPlayers: Number(server.maxPlayers || 0),
      version: server.version || '',
      loader: server.loader || '',
      lastSeenAt: server.lastSeenAt || null,
      pingedAt: server.pingedAt || null,
    })),
  }
}

export async function searchSkinPlayers(query) {
  const keyword = String(query || '').trim()
  if (!keyword) return []
  const data = await request(`/api/admin/players?q=${encodeURIComponent(keyword)}&page=1&perPage=60`)
  return mapPlayers(data?.items)
}

const PLAYER_PAGE_SIZE = 60
const PLAYER_MAX_PAGES = 10

function dedupePlayers(players) {
  const seen = new Set()
  return players.filter(player => {
    const key = String(player.id || player.uuid || player.name || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchPlayersPage({ q = '', page = 1, perPage = PLAYER_PAGE_SIZE } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
  if (q) params.set('q', q)
  const data = await request(`/api/admin/players?${params}`)
  return {
    items: mapPlayers(data?.items),
    pages: Math.max(1, Number(data?.pages) || 1),
  }
}

async function fetchAllPlayers() {
  const players = []
  let pages = 1
  for (let page = 1; page <= Math.min(pages, PLAYER_MAX_PAGES); page += 1) {
    const data = await fetchPlayersPage({ page })
    players.push(...data.items)
    pages = data.pages
    if (data.items.length < PLAYER_PAGE_SIZE) break
  }
  return dedupePlayers(players)
}

export async function getSkinPlayersForUser({ siteUserId, siteUsername, siteNickname }) {
  const ownerId = String(siteUserId || '').trim()
  const keywords = [...new Set([siteUsername, siteNickname]
    .map(value => String(value || '').trim())
    .filter(Boolean))]
  const found = []
  for (const keyword of keywords) {
    const data = await fetchPlayersPage({ q: keyword })
    found.push(...data.items)
  }
  const players = dedupePlayers(found)
  if (!ownerId) return players
  const owned = players.filter(player => String(player.ownerId) === ownerId)
  if (owned.length) return owned
  // q 只匹配角色名和登录名；昵称改名或登录名与角色名不一致时，按 ownerId 全量兜底。
  return (await fetchAllPlayers()).filter(player => String(player.ownerId) === ownerId)
}

function mapPlayers(items) {
  return (Array.isArray(items) ? items : []).map(player => ({
    id: player.id,
    name: player.name || '',
    uuid: player.uuid || '',
    model: player.model || '',
    ownerId: player.owner?.id || '',
    owner: player.owner?.nickname || player.owner?.username || '',
    skinName: player.skin?.name || '',
    skinUrl: absoluteUrl(player.skin?.url),
    capeName: player.cape?.name || '',
    capeUrl: absoluteUrl(player.cape?.url),
  }))
}

// 插件管理接口需要网站登录态；API key 会返回 403。
export async function getMcAdminOverview(cookie = process.env.SWUSTMC_ADMIN_COOKIE || '') {
  const value = String(cookie || '').trim().replace(/^Cookie:\s*/i, '')
  if (!value) throw new Error('未配置 SWUSTMC_ADMIN_COOKIE')
  const response = await fetch(BASE + '/api/plugins/minecraft-server/admin/overview', {
    headers: {
      Accept: 'application/json',
      Cookie: value,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  if (!response.ok || data?.ok === false) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new Error(`皮肤站管理接口：${message}`)
  }
  return data?.data ?? data
}
