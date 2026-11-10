// 本地群友记忆库：SQLite（Node 内置 node:sqlite），字段对齐 YuDream ai-chatbot 的画像模型。
// 桥接和监控服务共用；数据库文件默认 runtime/memory.db。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_SUMMARY = 1000
const MAX_PERSONALITY = 1000
const MAX_INTERACTION = 1000
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50
const MAX_ALIASES = 20
const MAX_ALIAS_LENGTH = 50
const MAX_FACTS = 30
const MAX_FACT_VALUE = 500
const MAX_MESSAGE = 1000
const MAX_NOTE = 500
const MAX_KEEP_MESSAGES = 200
const NL = String.fromCharCode(10)
const FACT_KEYS = new Set(['preference', 'interest', 'identity', 'habit', 'topic', 'emotion', 'note'])
const FACT_LABELS = {
  preference: '偏好',
  interest: '兴趣',
  identity: '身份',
  habit: '习惯',
  topic: '话题',
  emotion: '情绪',
  note: '备注',
}

function clampText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function safeJson(value, fallback) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function normalizeTags(input) {
  const tags = []
  const seen = new Set()
  for (const item of Array.isArray(input) ? input : []) {
    const tag = clampText(item, MAX_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function normalizeAliases(input) {
  const aliases = []
  const seen = new Set()
  for (const item of Array.isArray(input) ? input : []) {
    const alias = clampText(item, MAX_ALIAS_LENGTH)
    if (!alias || seen.has(alias)) continue
    seen.add(alias)
    aliases.push(alias)
    if (aliases.length >= MAX_ALIASES) break
  }
  return aliases
}

function normalizeFacts(input) {
  const facts = []
  const seen = new Set()
  for (const item of Array.isArray(input) ? input : []) {
    if (!item || typeof item !== 'object') continue
    const key = FACT_KEYS.has(String(item.key || '').trim().toLowerCase())
      ? String(item.key).trim().toLowerCase()
      : 'note'
    const value = clampText(item.value, MAX_FACT_VALUE)
    if (!value || seen.has(key)) continue
    seen.add(key)
    const confidence = Number(item.confidence)
    facts.push({
      key,
      value,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.6,
      approved: item.approved === true,
      updatedAt: Number(item.updatedAt) || Date.now(),
    })
    if (facts.length >= MAX_FACTS) break
  }
  return facts
}

function memberFromRow(row, noteCount = undefined) {
  if (!row) return null
  return {
    id: Number(row.id),
    platform: row.platform || 'qq',
    connectionKey: row.connection_key,
    userOpenid: row.user_openid,
    displayName: row.display_name || '',
    groupNickname: row.nickname || '',
    nickname: row.display_name || row.nickname || '',
    avatar: row.avatar || '',
    enabled: Boolean(row.enabled),
    aliases: safeJson(row.aliases, []).map(item => String(item)).filter(Boolean).slice(0, MAX_ALIASES),
    summary: row.summary || '',
    personality: row.personality || '',
    interactionStyle: row.interaction_style || '',
    tags: safeJson(row.tags, []),
    facts: normalizeFacts(safeJson(row.facts, [])),
    observedMessageCount: Number(row.observed_message_count || 0),
    replyTriggeredCount: Number(row.reply_triggered_count || 0),
    replyCompletedCount: Number(row.reply_completed_count || 0),
    replyFailedCount: Number(row.reply_failed_count || 0),
    lastActivityAt: Number(row.last_activity_at || 0),
    lastAnalyzedAt: Number(row.last_analyzed_at || 0),
    lastAnalyzedCount: Number(row.last_analyzed_count || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    noteCount: noteCount === undefined ? undefined : Number(noteCount || 0),
  }
}

export class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath
    this.db = null
  }

  init() {
    mkdirSync(dirname(this.filePath), { recursive: true })
    this.db = new DatabaseSync(this.filePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 3000')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL DEFAULT 'qq',
        connection_key TEXT NOT NULL,
        user_openid TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        aliases TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        interaction_style TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        facts TEXT NOT NULL DEFAULT '[]',
        observed_message_count INTEGER NOT NULL DEFAULT 0,
        reply_triggered_count INTEGER NOT NULL DEFAULT 0,
        reply_completed_count INTEGER NOT NULL DEFAULT 0,
        reply_failed_count INTEGER NOT NULL DEFAULT 0,
        last_activity_at INTEGER NOT NULL DEFAULT 0,
        last_analyzed_at INTEGER NOT NULL DEFAULT 0,
        last_analyzed_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(platform, connection_key, user_openid)
      );
      CREATE INDEX IF NOT EXISTS idx_members_connection ON members(connection_key);
      CREATE INDEX IF NOT EXISTS idx_members_activity ON members(last_activity_at DESC);
      CREATE TABLE IF NOT EXISTS member_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_member ON member_messages(member_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_time ON member_messages(created_at);
      CREATE TABLE IF NOT EXISTS member_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_member ON member_notes(member_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS member_connections (
        member_id INTEGER NOT NULL,
        connection_key TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (member_id, connection_key)
      );
      CREATE INDEX IF NOT EXISTS idx_member_connections_key ON member_connections(connection_key);
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.migrateGlobalMembers()
    try {
      this.db.exec('ALTER TABLE members ADD COLUMN last_analyzed_count INTEGER NOT NULL DEFAULT 0')
    } catch {
      // 新库已包含该列，旧库补列后忽略重复错误
    }
    try {
      this.db.exec("ALTER TABLE members ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'")
    } catch {
      // 新库已包含该列
    }
    try {
      this.db.exec("ALTER TABLE members ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
    } catch {
      // 新库已包含该列
    }
    this.migrateGlobalMembers()
    return this
  }

  migrateGlobalMembers() {
    const version = this.db.prepare("SELECT value FROM memory_meta WHERE key = 'schema_version'").get()
    if (String(version?.value || '') === '2') return
    const rows = this.db.prepare('SELECT * FROM members ORDER BY user_openid ASC, observed_message_count DESC, id ASC').all()
    const groups = new Map()
    for (const row of rows) {
      const key = `${row.platform || 'qq'}:${row.user_openid}`
      const list = groups.get(key) || []
      list.push(row)
      groups.set(key, list)
    }
    this.db.exec('BEGIN')
    try {
      for (const group of groups.values()) {
        const compact = [...group].sort((left, right) => {
          const countDiff = Number(right.observed_message_count || 0) - Number(left.observed_message_count || 0)
          if (countDiff) return countDiff
          return Number(left.id) - Number(right.id)
        })
        const canonical = compact[0]
        const latest = [...group].sort((left, right) => {
          const activityDiff = Number(right.last_activity_at || 0) - Number(left.last_activity_at || 0)
          return activityDiff || Number(right.id) - Number(left.id)
        })[0]
        const nickname = String(latest?.nickname || canonical.nickname || '').trim()
        const aliases = normalizeAliases([
          ...group.flatMap(row => safeJson(row.aliases, [])),
          ...group.map(row => row.nickname),
        ]).filter(alias => alias !== nickname)
        const tags = normalizeTags(group.flatMap(row => safeJson(row.tags, [])))
        const factMap = new Map()
        for (const row of group) {
          for (const fact of normalizeFacts(safeJson(row.facts, []))) {
            const previous = factMap.get(fact.key)
            if (!previous
              || (fact.approved && !previous.approved)
              || fact.confidence > previous.confidence
              || fact.updatedAt > previous.updatedAt) {
              factMap.set(fact.key, fact)
            }
          }
        }
        const facts = normalizeFacts([...factMap.values()])
        const profile = field => canonical[field]
          || compact.find(row => String(row[field] || '').trim())?.[field]
          || ''
        const now = Date.now()
        this.db.prepare(`
          UPDATE members SET nickname = ?, avatar = ?, enabled = ?, aliases = ?, summary = ?,
            personality = ?, interaction_style = ?, tags = ?, facts = ?, observed_message_count = ?,
            reply_triggered_count = ?, reply_completed_count = ?, reply_failed_count = ?,
            last_activity_at = ?, last_analyzed_at = ?, last_analyzed_count = ?,
            created_at = ?, updated_at = ? WHERE id = ?
        `).run(
          nickname,
          latest?.avatar || canonical.avatar || '',
          group.some(row => row.enabled) ? 1 : 0,
          JSON.stringify(aliases),
          String(profile('summary')).slice(0, MAX_SUMMARY),
          String(profile('personality')).slice(0, MAX_PERSONALITY),
          String(profile('interaction_style')).slice(0, MAX_INTERACTION),
          JSON.stringify(tags),
          JSON.stringify(facts),
          group.reduce((sum, row) => sum + Number(row.observed_message_count || 0), 0),
          group.reduce((sum, row) => sum + Number(row.reply_triggered_count || 0), 0),
          group.reduce((sum, row) => sum + Number(row.reply_completed_count || 0), 0),
          group.reduce((sum, row) => sum + Number(row.reply_failed_count || 0), 0),
          Math.max(...group.map(row => Number(row.last_activity_at || 0))),
          Math.max(...group.map(row => Number(row.last_analyzed_at || 0))),
          Math.max(...group.map(row => Number(row.last_analyzed_count || 0))),
          Math.min(...group.map(row => Number(row.created_at || now))),
          Math.max(now, ...group.map(row => Number(row.updated_at || 0))),
          canonical.id,
        )
        for (const duplicate of group) {
          if (Number(duplicate.id) === Number(canonical.id)) continue
          this.db.prepare('UPDATE member_messages SET member_id = ? WHERE member_id = ?')
            .run(canonical.id, duplicate.id)
          this.db.prepare('UPDATE member_notes SET member_id = ? WHERE member_id = ?')
            .run(canonical.id, duplicate.id)
          this.db.prepare('DELETE FROM members WHERE id = ?').run(duplicate.id)
        }
        if (latest?.connection_key && latest.connection_key !== canonical.connection_key) {
          this.db.prepare('UPDATE members SET connection_key = ? WHERE id = ?')
            .run(latest.connection_key, canonical.id)
        }
        for (const row of group) {
          this.db.prepare(`
            INSERT OR REPLACE INTO member_connections (member_id, connection_key, nickname, last_seen_at)
            VALUES (?, ?, ?, ?)
          `).run(canonical.id, row.connection_key, row.nickname || '', Number(row.last_activity_at || 0))
        }
      }
      this.db.prepare("INSERT OR REPLACE INTO memory_meta (key, value) VALUES ('schema_version', '2')").run()
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      throw error
    }
  }

  close() {
    try {
      this.db?.close()
    } catch {
      // ignore
    }
    this.db = null
  }

  attachConnections(member) {
    if (!member) return null
    const rows = this.db.prepare(`
      SELECT connection_key, nickname FROM member_connections
      WHERE member_id = ? ORDER BY last_seen_at DESC, connection_key ASC
    `).all(member.id)
    member.connections = rows.map(row => row.connection_key).filter(Boolean)
    member.connectionNames = [...new Set(rows.map(row => row.nickname).filter(Boolean))]
    if (!member.connections.length && member.connectionKey) {
      member.connections = [member.connectionKey]
    }
    return member
  }

  recordConnection(memberId, connectionKey, nickname = '', lastSeenAt = Date.now()) {
    if (!connectionKey) return
    this.db.prepare(`
      INSERT OR REPLACE INTO member_connections (member_id, connection_key, nickname, last_seen_at)
      VALUES (?, ?, ?, ?)
    `).run(Number(memberId), String(connectionKey), clampText(nickname, 100), Number(lastSeenAt) || Date.now())
  }

  findMember(_connectionKey, userOpenid) {
    const row = this.db.prepare(
      'SELECT * FROM members WHERE platform = ? AND user_openid = ? ORDER BY last_activity_at DESC LIMIT 1',
    ).get('qq', userOpenid)
    return this.attachConnections(memberFromRow(row))
  }

  getMember(id) {
    const row = this.db.prepare('SELECT * FROM members WHERE id = ?').get(Number(id))
    return this.attachConnections(memberFromRow(row))
  }

  findOrCreateMember({ connectionKey, userId, nickname = '' }) {
    const existing = this.findMember(connectionKey, userId)
    const now = Date.now()
    const cleanNickname = clampText(nickname, 100)
    if (existing) {
      if (existing.displayName) {
        if (connectionKey && connectionKey !== existing.connectionKey) {
          this.db.prepare('UPDATE members SET connection_key = ?, updated_at = ? WHERE id = ?')
            .run(connectionKey, now, existing.id)
        }
        this.recordConnection(existing.id, connectionKey, cleanNickname, now)
        return this.getMember(existing.id)
      }
      if (cleanNickname && existing.nickname !== cleanNickname) {
        this.db.prepare(`
          UPDATE members SET nickname = ?, connection_key = ?, updated_at = ? WHERE id = ?
        `).run(cleanNickname, connectionKey || existing.connectionKey, now, existing.id)
      } else if (connectionKey && connectionKey !== existing.connectionKey) {
        this.db.prepare('UPDATE members SET connection_key = ?, updated_at = ? WHERE id = ?')
          .run(connectionKey, now, existing.id)
      }
      this.recordConnection(existing.id, connectionKey, cleanNickname, now)
      return this.getMember(existing.id)
    }
    const result = this.db.prepare(`
      INSERT INTO members (
        platform, connection_key, user_openid, nickname, last_activity_at, created_at, updated_at
      ) VALUES ('qq', ?, ?, ?, ?, ?, ?)
    `).run(connectionKey, userId, cleanNickname, now, now, now)
    const memberId = Number(result.lastInsertRowid)
    this.recordConnection(memberId, connectionKey, cleanNickname, now)
    return this.getMember(memberId)
  }

  recordInbound({ connectionKey, userId, nickname = '', content, retentionDays = 90 }) {
    const currentNickname = clampText(nickname, 100)
    const member = this.findOrCreateMember({ connectionKey, userId, nickname: currentNickname })
    const text = clampText(content, MAX_MESSAGE)
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      if (text) {
        this.db.prepare('INSERT INTO member_messages (member_id, content, created_at) VALUES (?, ?, ?)')
          .run(member.id, text, now)
      }
      this.db.prepare(`
        UPDATE members SET nickname = CASE WHEN ? <> '' THEN ? ELSE nickname END,
          observed_message_count = observed_message_count + 1,
          last_activity_at = ?, updated_at = ? WHERE id = ?
      `).run(currentNickname, currentNickname, now, now, member.id)
      if (text) {
        this.db.prepare(`
          DELETE FROM member_messages WHERE member_id = ? AND id NOT IN (
            SELECT id FROM member_messages WHERE member_id = ? ORDER BY id DESC LIMIT ?
          )
        `).run(member.id, member.id, MAX_KEEP_MESSAGES)
      }
      if (retentionDays > 0) {
        const cutoff = now - retentionDays * 86400000
        this.db.prepare('DELETE FROM member_messages WHERE created_at < ?').run(cutoff)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      throw error
    }
    return this.getMember(member.id)
  }

  recordReplyTriggered(memberId) {
    if (!memberId) return
    const now = Date.now()
    this.db.prepare(`
      UPDATE members SET reply_triggered_count = reply_triggered_count + 1, updated_at = ? WHERE id = ?
    `).run(now, Number(memberId))
  }

  recordReplyCompleted(memberId, success) {
    if (!memberId) return
    const now = Date.now()
    if (success) {
      this.db.prepare(`
        UPDATE members SET reply_completed_count = reply_completed_count + 1, updated_at = ? WHERE id = ?
      `).run(now, Number(memberId))
    } else {
      this.db.prepare(`
        UPDATE members SET reply_failed_count = reply_failed_count + 1, updated_at = ? WHERE id = ?
      `).run(now, Number(memberId))
    }
  }

  getMemory(connectionKey, userOpenid, { recentMessages = 6, notesLimit = 20 } = {}) {
    const member = this.findMember(connectionKey, userOpenid)
    if (!member) return null
    const messages = this.db.prepare(`
      SELECT id, content, created_at FROM member_messages
      WHERE member_id = ? ORDER BY id DESC LIMIT ?
    `).all(member.id, Math.max(1, Math.min(50, recentMessages)))
      .map(row => ({ id: Number(row.id), content: row.content, createdAt: Number(row.created_at) }))
      .reverse()
    const notes = this.db.prepare(`
      SELECT id, content, source, created_at FROM member_notes
      WHERE member_id = ? ORDER BY id DESC LIMIT ?
    `).all(member.id, Math.max(1, Math.min(100, notesLimit)))
      .map(row => ({
        id: Number(row.id),
        content: row.content,
        source: row.source,
        createdAt: Number(row.created_at),
      }))
    return { member, messages, notes }
  }

  formatMemorySection(memory, { recentMessages = 6 } = {}) {
    if (!memory?.member?.enabled) return ''
    const member = memory.member
    const name = member.nickname || member.aliases[0] || '这位群友'
    const lines = [
      `当前发言者就是这位群友：${name}${member.aliases.length ? `（别名：${member.aliases.join('、')}）` : ''}`,
      '请直接用 TA 的昵称称呼 TA，不要加 @ 前缀；不要说“不知道你是谁”或“只能临时记”。',
      '以下是你对 TA 的记忆（仅供对话参考，不要逐条复述，也不要暴露 openid）：',
    ]
    if (member.nickname) lines.push(`昵称：${member.nickname}`)
    if (member.summary) lines.push(`画像摘要：${member.summary}`)
    if (member.personality) lines.push(`人格特点：${member.personality}`)
    if (member.interactionStyle) lines.push(`互动风格：${member.interactionStyle}`)
    if (member.tags.length) lines.push(`标签：${member.tags.join('、')}`)
    const facts = member.facts
      .filter(fact => fact.approved || fact.confidence >= 0.5)
      .slice(0, 8)
      .map(fact => `${FACT_LABELS[fact.key] || fact.key}：${fact.value}`)
    if (facts.length) lines.push(`画像事实：${facts.join('；')}`)
    if (memory.notes.length) {
      lines.push('你之前记下的事：')
      for (const note of memory.notes.slice(0, 8)) lines.push(`- ${note.content}`)
    }
    if (memory.messages.length) {
      lines.push('最近发言：')
      for (const message of memory.messages.slice(-Math.max(1, Math.min(20, recentMessages)))) {
        lines.push(`- ${message.content}`)
      }
    }
    lines.push('如果用户问“我是谁/你认识我吗/说说我”，请先叫出 TA 的昵称，再用 1-2 句结合画像摘要、人格特点、互动风格和最近发言描述 TA 是什么样的人，并轻微模仿 TA 的语气；不要只复述一个聊天细节。')
    lines.push('如果画像为空，请根据最近发言概括 TA 的身份、关注点和说话风格，并自然融入回复；可以轻微参考 TA 的说话语气与用词，但保持梦璃的人设。')
    let section = lines.join('\n')
    if (section.length > 2400) section = section.slice(0, 2400) + '…'
    return section
  }

  formatMemberProfileSection(detail) {
    if (!detail?.member?.enabled) return ''
    const member = detail.member
    const name = member.nickname || member.aliases[0] || '这位群友'
    const lines = [`群友画像：${name}`]
    if (member.aliases.length) lines.push(`别名：${member.aliases.join('、')}`)
    if (member.summary) lines.push(`摘要：${member.summary}`)
    if (member.personality) lines.push(`人格：${member.personality}`)
    if (member.interactionStyle) lines.push(`互动风格：${member.interactionStyle}`)
    if (member.tags.length) lines.push(`标签：${member.tags.join('、')}`)
    const facts = member.facts
      .filter(fact => fact.approved || fact.confidence >= 0.5)
      .slice(0, 6)
      .map(fact => `${FACT_LABELS[fact.key] || fact.key}：${fact.value}`)
    if (facts.length) lines.push(`事实：${facts.join('；')}`)
    if (detail.notes.length) {
      lines.push('备注：')
      for (const note of detail.notes.slice(0, 5)) lines.push(`- ${note.content}`)
    }
    if (detail.messages.length) {
      lines.push('最近发言：')
      for (const message of detail.messages.slice(-3)) lines.push(`- ${message.content}`)
    }
    let section = lines.join(NL)
    if (section.length > 1500) section = section.slice(0, 1500) + '…'
    return section
  }

  findMentionedMembers(connectionKey, text, { excludeUserId = null, limit = 3 } = {}) {
    const messageText = String(text || '')
    if (!messageText) return []
    const rows = this.db.prepare(`
      SELECT DISTINCT m.* FROM members m
      JOIN member_connections c ON c.member_id = m.id
      WHERE m.platform = 'qq' AND c.connection_key = ? AND m.enabled = 1
      ORDER BY m.last_activity_at DESC LIMIT 300
    `).all(connectionKey)
    const matches = []
    for (const row of rows) {
      const member = this.attachConnections(memberFromRow(row))
      if (!member) continue
      if (excludeUserId && member.userOpenid === excludeUserId) continue
      const names = [member.nickname, member.groupNickname, ...(member.connectionNames || []), ...member.aliases]
        .filter(name => name && name.length >= 2)
      let best = 0
      let matchedName = ''
      for (const name of names) {
        if (messageText.toLowerCase().includes(name.toLowerCase()) && name.length > best) {
          best = name.length
          matchedName = name
        }
      }
      if (best > 0) matches.push({ member, score: best, matchedName })
    }
    matches.sort((left, right) => right.score - left.score)
    return matches
      .slice(0, Math.max(1, Math.min(5, limit)))
      .map(item => {
        const detail = this.getMemberDetail(item.member.id)
        return detail ? { ...detail, matchedName: item.matchedName } : null
      })
      .filter(Boolean)
  }

  addNote(memberId, content, source = 'manual') {
    const text = clampText(content, MAX_NOTE)
    if (!text) throw new Error('备注不能为空')
    const result = this.db.prepare(`
      INSERT INTO member_notes (member_id, content, source, created_at) VALUES (?, ?, ?, ?)
    `).run(Number(memberId), text, source, Date.now())
    const now = Date.now()
    this.db.prepare('UPDATE members SET last_activity_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, Number(memberId))
    return { id: Number(result.lastInsertRowid), content: text, source }
  }

  deleteNote(id) {
    const result = this.db.prepare('DELETE FROM member_notes WHERE id = ?').run(Number(id))
    return Number(result.changes) > 0
  }

  listMembers({ query = '', limit = 200 } = {}) {
    const keyword = String(query || '').trim()
    const max = Math.max(1, Math.min(500, Number(limit) || 200))
    const sql = `
      SELECT m.*, (SELECT COUNT(*) FROM member_notes n WHERE n.member_id = m.id) AS note_count
      FROM members m
      WHERE (? = '' OR m.nickname LIKE ? OR m.user_openid LIKE ? OR m.summary LIKE ? OR m.connection_key LIKE ?
        OR m.display_name LIKE ?
        OR EXISTS (SELECT 1 FROM member_connections c WHERE c.member_id = m.id AND (c.connection_key LIKE ? OR c.nickname LIKE ?)))
      ORDER BY m.last_activity_at DESC LIMIT ?
    `
    const like = `%${keyword}%`
    return this.db.prepare(sql).all(keyword, like, like, like, like, like, like, like, max)
      .map(row => this.attachConnections(memberFromRow(row, row.note_count)))
  }

  getMemberDetail(id) {
    const member = this.getMember(id)
    if (!member) return null
    const notes = this.db.prepare(`
      SELECT id, content, source, created_at FROM member_notes
      WHERE member_id = ? ORDER BY id DESC LIMIT 50
    `).all(member.id).map(row => ({
      id: Number(row.id),
      content: row.content,
      source: row.source,
      createdAt: Number(row.created_at),
    }))
    const messages = this.db.prepare(`
      SELECT id, content, created_at FROM member_messages
      WHERE member_id = ? ORDER BY id DESC LIMIT 30
    `).all(member.id).map(row => ({
      id: Number(row.id),
      content: row.content,
      createdAt: Number(row.created_at),
    })).reverse()
    return { member, notes, messages }
  }

  updateProfile(id, fields = {}) {
    const member = this.getMember(id)
    if (!member) throw new Error('群友记忆不存在')
    const summary = fields.summary === undefined ? member.summary : clampText(fields.summary, MAX_SUMMARY)
    const personality = fields.personality === undefined ? member.personality : clampText(fields.personality, MAX_PERSONALITY)
    const interactionStyle = fields.interactionStyle === undefined
      ? member.interactionStyle
      : clampText(fields.interactionStyle, MAX_INTERACTION)
    const tags = fields.tags === undefined ? member.tags : normalizeTags(fields.tags)
    const aliases = fields.aliases === undefined ? member.aliases : normalizeAliases(fields.aliases)
    const facts = fields.facts === undefined ? member.facts : normalizeFacts(fields.facts)
    const nickname = fields.nickname === undefined ? member.nickname : clampText(fields.nickname, 100)
    const displayName = fields.displayName === undefined ? member.displayName : clampText(fields.displayName, 100)
    const enabled = fields.enabled === undefined ? member.enabled : Boolean(fields.enabled)
    const now = Date.now()
    this.db.prepare(`
      UPDATE members SET nickname = ?, display_name = ?, enabled = ?, aliases = ?, summary = ?, personality = ?,
        interaction_style = ?, tags = ?, facts = ?, updated_at = ? WHERE id = ?
    `).run(nickname, displayName, enabled ? 1 : 0, JSON.stringify(aliases), summary, personality, interactionStyle,
      JSON.stringify(tags), JSON.stringify(facts), now, member.id)
    return this.getMember(member.id)
  }

  addAlias(memberId, alias) {
    const member = this.getMember(memberId)
    if (!member) throw new Error('群友记忆不存在')
    const value = clampText(alias, MAX_ALIAS_LENGTH)
    if (!value) throw new Error('别名不能为空')
    return this.updateProfile(memberId, { aliases: [...member.aliases, value] })
  }

  lockDisplayName(memberId, displayName) {
    const value = clampText(displayName, 100)
    if (!value) throw new Error('显示名不能为空')
    return this.updateProfile(memberId, { displayName: value, aliases: [] })
  }

  applyAnalysis(id, analysis = {}) {
    const member = this.getMember(id)
    if (!member) throw new Error('群友记忆不存在')
    const now = Date.now()
    this.db.prepare(`
      UPDATE members SET summary = ?, personality = ?, interaction_style = ?,
        tags = ?, facts = ?, last_analyzed_at = ?, last_analyzed_count = observed_message_count,
        updated_at = ? WHERE id = ?
    `).run(
      clampText(analysis.summary ?? member.summary, MAX_SUMMARY),
      clampText(analysis.personality ?? member.personality, MAX_PERSONALITY),
      clampText(analysis.interactionStyle ?? member.interactionStyle, MAX_INTERACTION),
      JSON.stringify(analysis.tags === undefined ? member.tags : normalizeTags(analysis.tags)),
      JSON.stringify(analysis.facts === undefined ? member.facts : normalizeFacts(analysis.facts)),
      now, now, member.id,
    )
    return this.getMember(member.id)
  }

  deleteMember(id) {
    const memberId = Number(id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM member_notes WHERE member_id = ?').run(memberId)
      this.db.prepare('DELETE FROM member_messages WHERE member_id = ?').run(memberId)
      this.db.prepare('DELETE FROM member_connections WHERE member_id = ?').run(memberId)
      const result = this.db.prepare('DELETE FROM members WHERE id = ?').run(memberId)
      this.db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      throw error
    }
  }

  deleteByConnectionUser(connectionKey, userOpenid) {
    const member = this.findMember(connectionKey, userOpenid)
    return member ? this.deleteMember(member.id) : false
  }

  clearAll() {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM member_notes')
      this.db.exec('DELETE FROM member_messages')
      this.db.exec('DELETE FROM member_connections')
      this.db.exec('DELETE FROM members')
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* ignore */ }
      throw error
    }
  }

  cleanup(retentionDays = 90) {
    if (!retentionDays || retentionDays <= 0) return 0
    const cutoff = Date.now() - retentionDays * 86400000
    const result = this.db.prepare('DELETE FROM member_messages WHERE created_at < ?').run(cutoff)
    return Number(result.changes || 0)
  }

  stats() {
    const members = this.db.prepare('SELECT COUNT(*) AS count FROM members').get()
    const messages = this.db.prepare('SELECT COUNT(*) AS count FROM member_messages').get()
    const notes = this.db.prepare('SELECT COUNT(*) AS count FROM member_notes').get()
    const analyzed = this.db.prepare('SELECT COUNT(*) AS count FROM members WHERE last_analyzed_at > 0').get()
    return {
      members: Number(members?.count || 0),
      messages: Number(messages?.count || 0),
      notes: Number(notes?.count || 0),
      analyzed: Number(analyzed?.count || 0),
    }
  }
}

export { FACT_LABELS }
