const STYLE = `
<style>
  .mengli-wrap { display: grid; gap: 16px; }
  .mengli-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .mengli-title { margin: 0; font-size: 24px; }
  .mengli-sub { margin: 4px 0 0; color: var(--muted, #667085); font-size: 13px; }
  .mengli-tabs { display: flex; gap: 8px; }
  .mengli-tab { border: 1px solid var(--line, #d0d5dd); background: transparent; color: inherit; border-radius: 999px; padding: 8px 14px; cursor: pointer; }
  .mengli-tab.active { background: #2563eb; border-color: #2563eb; color: #fff; }
  .mengli-panel { border: 1px solid var(--line, #d0d5dd); border-radius: 14px; background: var(--panel, #fff); overflow: hidden; }
  .mengli-toolbar { display: flex; gap: 8px; align-items: center; padding: 12px; border-bottom: 1px solid var(--line, #d0d5dd); flex-wrap: wrap; }
  .mengli-toolbar input { flex: 1; min-width: 180px; border: 1px solid var(--line, #d0d5dd); border-radius: 8px; padding: 8px 10px; background: transparent; color: inherit; }
  .mengli-muted { color: var(--muted, #667085); font-size: 12px; }
  .mengli-log { max-height: 68vh; overflow: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
  .mengli-row { display: grid; grid-template-columns: 148px 110px minmax(150px, 1fr) 2.2fr; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(127,127,127,.14); }
  .mengli-row.head { position: sticky; top: 0; background: var(--panel, #fff); font-weight: 700; z-index: 1; }
  .mengli-row > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mengli-log-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; padding: 12px; border-bottom: 1px solid rgba(127,127,127,.14); }
  .mengli-stat { border: 1px solid var(--line, #d0d5dd); border-radius: 10px; padding: 9px 11px; background: rgba(37,99,235,.035); }
  .mengli-stat strong { display: block; font-size: 20px; line-height: 1.2; }
  .mengli-stat span { color: var(--muted, #667085); font-size: 11px; }
  .mengli-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 12px 12px; }
  .mengli-chip { border: 1px solid var(--line, #d0d5dd); background: transparent; color: inherit; border-radius: 999px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
  .mengli-chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
  .mengli-events { max-height: 62vh; overflow: auto; padding: 0 8px 8px; }
  .mengli-event { display: grid; grid-template-columns: 72px 96px minmax(0, 1fr); gap: 10px; padding: 9px 8px; border-bottom: 1px solid rgba(127,127,127,.12); align-items: start; }
  .mengli-event:hover { background: rgba(37,99,235,.035); }
  .mengli-event-time { color: var(--muted, #667085); font-size: 12px; padding-top: 2px; }
  .mengli-badge { display: inline-block; border: 1px solid transparent; border-radius: 999px; padding: 2px 8px; font-size: 11px; white-space: nowrap; }
  .mengli-badge.is-inbound { color: #0f766e; border-color: rgba(15,118,110,.25); background: rgba(15,118,110,.08); }
  .mengli-badge.is-reply { color: #1d4ed8; border-color: rgba(29,78,216,.25); background: rgba(29,78,216,.08); }
  .mengli-badge.is-agent { color: #7c3aed; border-color: rgba(124,58,237,.25); background: rgba(124,58,237,.08); }
  .mengli-badge.is-media { color: #b45309; border-color: rgba(180,83,9,.25); background: rgba(180,83,9,.08); }
  .mengli-badge.is-error { color: #b42318; border-color: rgba(180,35,24,.25); background: rgba(180,35,24,.08); }
  .mengli-badge.is-command { color: #475467; border-color: rgba(71,84,103,.25); background: rgba(71,84,103,.08); }
  .mengli-badge.is-auto { color: #0e7490; border-color: rgba(14,116,144,.25); background: rgba(14,116,144,.08); }
  .mengli-event-body { min-width: 0; display: grid; gap: 3px; }
  .mengli-event-target { color: var(--muted, #667085); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mengli-event-text { font-family: inherit; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .mengli-memory { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 12px; }
  .mengli-card { border: 1px solid var(--line, #d0d5dd); border-radius: 12px; padding: 12px; display: grid; gap: 8px; background: var(--panel, #fff); }
  .mengli-card h3 { margin: 0; font-size: 16px; }
  .mengli-card p { margin: 0; font-size: 13px; line-height: 1.55; }
  .mengli-tag { display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 999px; background: rgba(37,99,235,.1); color: #2563eb; font-size: 11px; }
  .mengli-list { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.55; }
  .mengli-error { padding: 12px; color: #b42318; }
  .mengli-empty { padding: 24px; text-align: center; color: var(--muted, #667085); }
  .mengli-settings { padding: 14px; display: grid; gap: 4px; max-width: 780px; }
  .mengli-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 0; border-bottom: 1px solid rgba(127,127,127,.14); }
  .mengli-setting-row:last-of-type { border-bottom: 0; }
  .mengli-setting-row label { flex: 1; font-size: 14px; }
  .mengli-setting-row small { display: block; color: var(--muted, #667085); font-size: 12px; margin-top: 3px; }
  .mengli-setting-row input[type=number], .mengli-setting-row input[type=text] { width: 120px; border: 1px solid var(--line, #d0d5dd); border-radius: 8px; padding: 7px 9px; background: transparent; color: inherit; }
  .mengli-setting-row input[type=range] { width: 220px; }
  .mengli-setting-row input[type=checkbox] { width: 20px; height: 20px; accent-color: #2563eb; }
  .mengli-prob { min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
  .mengli-save { justify-self: start; border: 0; border-radius: 8px; padding: 10px 22px; background: #2563eb; color: #fff; cursor: pointer; font-weight: 700; margin-top: 10px; }
  .mengli-save:disabled { opacity: .5; cursor: wait; }
  @media (max-width: 780px) {
    .mengli-row { grid-template-columns: 92px 78px 1fr; }
    .mengli-row > div:nth-child(4) { display: none; }
  }
</style>
`

function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fmtTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function shortId(value) {
  const text = String(value || '')
  if (!text) return '—'
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text
}

function memoryScope(member) {
  const connections = Array.isArray(member.connections) && member.connections.length
    ? member.connections
    : [member.connectionKey].filter(Boolean)
  if (connections.length > 1) return `已合并 ${connections.length} 个群/私聊`
  return connections[0] || ''
}

function fmtClock(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function percent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `${Math.round(number * 100)}%`
}

function logView(event) {
  const name = event.event || event.type || 'event'
  const target = shortId(event.key || event.peerId || event.command || event.bot)
  const userId = event.userId ? shortId(event.userId) : ''
  let label = name
  let detail = ''
  let badge = 'is-inbound'
  const categories = [name]

  if (name === 'inbound') {
    const group = event.kind === 'group'
    label = group ? '群消息' : event.kind === 'c2c' ? '私聊' : '频道'
    categories.push(group ? 'group' : event.kind === 'c2c' ? 'c2c' : 'other', 'inbound')
    detail = `收到 ${event.chars || 0} 字${userId ? ` · 用户 ${userId}` : ''}${event.mediaOnly ? ' · 全量群消息' : ''}`
  } else if (name === 'command') {
    label = '指令'
    badge = 'is-command'
    categories.push('command', 'other')
    detail = `${event.command || ''} ${event.args || ''}`.trim() || '收到指令'
  } else if (name === 'auto_reply') {
    const skipped = event.phase === 'skipped'
    label = skipped ? '自动回复跳过' : '自动回复命中'
    badge = 'is-auto'
    categories.push('auto')
    detail = skipped
      ? `原因：${event.reason || '模型判断不回复'}`
      : `评分 ${event.score == null ? '—' : Number(event.score).toFixed(2)} · 概率 ${percent(event.probability)}${event.nameMention ? ' · 点名触发' : ''}`
  } else if (name === 'agent') {
    label = event.phase === 'start' ? 'Agent 开始' : 'Agent 完成'
    badge = 'is-agent'
    categories.push('agent')
    detail = event.phase === 'start'
      ? '等待模型…'
      : `耗时 ${event.durationMs || 0}ms · ${event.chars || 0} 字${event.noReply ? ' · 模型判断不回复' : ''}`
  } else if (name === 'reply') {
    label = '梦璃回复'
    badge = 'is-reply'
    categories.push('reply')
    detail = String(event.text || '').slice(0, 320)
  } else if (name === 'media') {
    label = event.phase === 'failed' ? '媒体失败' : `媒体${event.phase === 'sent' ? '发送' : event.phase === 'parsed' ? '下载' : '识别'}`
    badge = event.phase === 'failed' ? 'is-error' : 'is-media'
    categories.push('media', event.phase === 'failed' ? 'error' : 'other')
    detail = [
      event.platform,
      event.title,
      event.name,
      event.size ? `${(Number(event.size) / 1024).toFixed(0)} KB` : '',
      event.error,
    ].filter(Boolean).join(' · ')
  } else if (name === 'memory') {
    label = '记忆整理'
    badge = 'is-agent'
    categories.push('other')
    detail = event.summary || event.phase || ''
  } else if (name === 'connect') {
    label = '网关连接'
    categories.push('other')
    detail = `机器人 ${event.bot || '梦璃'} 已连接`
  } else if (name === 'error') {
    label = '错误'
    badge = 'is-error'
    categories.push('error')
    detail = String(event.message || event.error || '').slice(0, 320)
  } else {
    detail = JSON.stringify(event).slice(0, 260)
  }

  return {
    label,
    badge,
    categories: [...new Set(categories)].join(' '),
    target: target === '—' && userId ? `用户 ${userId}` : target,
    detail,
    search: JSON.stringify(event).toLowerCase(),
  }
}

function renderLogs(state) {
  const logs = state.logs || []
  const count = name => logs.filter(event => event.event === name || event.type === name).length
  const inbound = logs.filter(event => event.event === 'inbound')
  const filters = [
    ['all', '全部'],
    ['group', '群聊'],
    ['c2c', '私聊'],
    ['media', '媒体'],
    ['reply', '回复'],
    ['agent', 'Agent'],
    ['auto', '自动回复'],
    ['error', '错误'],
    ['other', '其他'],
  ]
  return `
    <div class="mengli-panel">
      <div class="mengli-log-stats">
        ${[
          ['事件', logs.length],
          ['群消息', inbound.filter(event => event.kind === 'group').length],
          ['私聊', inbound.filter(event => event.kind === 'c2c').length],
          ['回复', count('reply')],
          ['媒体', count('media')],
          ['Agent', count('agent')],
          ['错误', count('error')],
        ].map(([label, value]) => `<div class="mengli-stat"><strong>${value}</strong><span>${label}</span></div>`).join('')}
      </div>
      <div class="mengli-toolbar">
        <input id="mengliLogSearch" type="search" placeholder="搜索事件、群、用户、回复内容…" value="${esc(state.logQuery)}" />
        <span class="mengli-muted">最近 ${logs.length} / ${state.logTotal} 条</span>
        <button class="mengli-tab" data-mengli-refresh>刷新</button>
      </div>
      <div class="mengli-chips">
        ${filters.map(([key, label]) => `<button class="mengli-chip ${state.logFilter === key ? 'active' : ''}" data-mengli-filter="${key}">${label}</button>`).join('')}
      </div>
      <div class="mengli-events">
        ${logs.length ? logs.map(event => {
          const view = logView(event)
          return `<div class="mengli-event" data-log-categories="${esc(view.categories)}" data-log-search="${esc(view.search)}">
            <div class="mengli-event-time">${esc(fmtClock(event.ts))}</div>
            <div><span class="mengli-badge ${view.badge}">${esc(view.label)}</span></div>
            <div class="mengli-event-body">
              <div class="mengli-event-target">${esc(view.target)}</div>
              ${view.detail ? `<div class="mengli-event-text">${esc(view.detail)}</div>` : ''}
            </div>
          </div>`
        }).join('') : '<div class="mengli-empty">还没有收到梦璃日志。桥接推送后这里会自动出现。</div>'}
      </div>
    </div>
  `
}

function renderMemory(state) {
  const members = state.members || []
  const query = state.memoryQuery.trim().toLowerCase()
  const filtered = query
    ? members.filter(member => [member.nickname, member.summary, member.personality, ...(member.aliases || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(query))
    : members
  return `
    <div class="mengli-panel">
      <div class="mengli-toolbar">
        <input id="mengliMemorySearch" type="search" placeholder="搜索昵称、别名、摘要…" value="${esc(state.memoryQuery)}" />
        <span class="mengli-muted">${filtered.length} / ${members.length} 位群友</span>
        <button class="mengli-tab" data-mengli-refresh>刷新</button>
      </div>
      <div class="mengli-memory">
        ${filtered.length ? filtered.map(member => {
          const notes = member.notes || []
          const messages = member.recentMessages || []
          const searchText = [member.nickname, member.summary, member.personality, ...(member.aliases || [])]
            .filter(Boolean).join(' ').toLowerCase()
          return `<article class="mengli-card" data-mengli-search="${esc(searchText)}">
            <h3>${esc(member.nickname || '(未命名)')}</h3>
            <div class="mengli-muted">${esc(memoryScope(member))} · ${esc(member.observedMessageCount || 0)} 条发言 · 最近 ${esc(fmtTime(member.lastActivityAt))}</div>
            ${member.aliases?.length ? `<p><strong>别名：</strong>${member.aliases.map(a => `<span class="mengli-tag">${esc(a)}</span>`).join('')}</p>` : ''}
            ${member.summary ? `<p><strong>摘要：</strong>${esc(member.summary)}</p>` : ''}
            ${member.personality ? `<p><strong>人格：</strong>${esc(member.personality)}</p>` : ''}
            ${member.interactionStyle ? `<p><strong>互动风格：</strong>${esc(member.interactionStyle)}</p>` : ''}
            ${member.tags?.length ? `<p>${member.tags.map(tag => `<span class="mengli-tag">${esc(tag)}</span>`).join('')}</p>` : ''}
            ${notes.length ? `<div><div class="mengli-muted">备注</div><ul class="mengli-list">${notes.slice(0, 5).map(note => `<li>${esc(note.content)}</li>`).join('')}</ul></div>` : ''}
            ${messages.length ? `<div><div class="mengli-muted">最近发言</div><ul class="mengli-list">${messages.slice(-4).map(item => `<li>${esc(item.content)}</li>`).join('')}</ul></div>` : ''}
          </article>`
        }).join('') : '<div class="mengli-empty">还没有群友记忆。</div>'}
      </div>
    </div>
  `
}

function renderSettings(state) {
  const s = state.settings || {}
  const probability = Math.round((Number(s.autoReplyProbability) || 0) * 100)
  return `
    <div class="mengli-panel">
      <form class="mengli-settings" data-mengli-settings-form>
        <div class="mengli-setting-row">
          <label>媒体链接解析<small>识别到 B站 / 抖音 / 小红书等支持平台的链接时，自动解析并发送媒体。</small></label>
          <input type="checkbox" name="mediaEnabled" ${s.mediaEnabled !== false ? 'checked' : ''} />
        </div>
        <div class="mengli-setting-row">
          <label>服务器播报显示玩家数<small>/服务器 和进出播报最多显示几个在线玩家名，默认 5。</small></label>
          <input type="number" name="mcPlayerLimit" min="1" max="20" value="${esc(s.mcPlayerLimit ?? 5)}" />
        </div>
        <div class="mengli-setting-row">
          <label>群聊自动回复<small>只作用于没有 @ 机器人的群全量消息；@ 和私聊始终回复。</small></label>
          <input type="checkbox" name="autoReplyEnabled" ${s.autoReplyEnabled !== false ? 'checked' : ''} />
        </div>
        <div class="mengli-setting-row">
          <label>自动回复概率<small>基础概率；高相关会提升，普通闲聊按 20% 参与。</small></label>
          <span class="mengli-prob" data-mengli-prob>${probability}%</span>
          <input type="range" name="autoReplyProbability" min="0" max="100" step="1" value="${probability}" />
        </div>
        <div class="mengli-setting-row">
          <label>同群冷却（秒）<small>同一群自动回复后的最小间隔。</small></label>
          <input type="number" name="autoReplyCooldownSeconds" min="0" max="3600" value="${esc(s.autoReplyCooldownSeconds ?? 30)}" />
        </div>
        <div class="mengli-setting-row">
          <label>智能判断<small>点名、提问、MC/社团相关优先；灌水/重复/刷屏跳过；群越大越降频。</small></label>
          <input type="checkbox" name="autoReplySmart" ${s.autoReplySmart !== false ? 'checked' : ''} />
        </div>
        <div class="mengli-setting-row">
          <label>同一用户冷却（秒）<small>同一个人连续发言时的最小回复间隔。</small></label>
          <input type="number" name="autoReplyUserCooldownSeconds" min="0" max="3600" value="${esc(s.autoReplyUserCooldownSeconds ?? 60)}" />
        </div>
        <div class="mengli-setting-row">
          <label>群友记忆<small>按群友记住发言、备注和画像；数据仍只存本地 SQLite。</small></label>
          <input type="checkbox" name="memoryEnabled" ${s.memoryEnabled !== false ? 'checked' : ''} />
        </div>
        <div class="mengli-setting-row">
          <label>记忆保留天数<small>超期自动清理，0 表示不自动清理。</small></label>
          <input type="number" name="memoryRetentionDays" min="0" max="3650" value="${esc(s.memoryRetentionDays ?? 90)}" />
        </div>
        <div class="mengli-setting-row">
          <label>注入最近发言条数<small>每条消息带给模型的最近发言数量。</small></label>
          <input type="number" name="memoryRecentMessages" min="1" max="20" value="${esc(s.memoryRecentMessages ?? 6)}" />
        </div>
        <div class="mengli-setting-row">
          <label>自动画像<small>定期调用模型整理性格、兴趣和互动风格。</small></label>
          <input type="checkbox" name="memoryAutoProfile" ${s.memoryAutoProfile === true ? 'checked' : ''} />
        </div>
        <div class="mengli-setting-row">
          <label>自动画像间隔（条）<small>每累计多少条发言触发一次画像整理。</small></label>
          <input type="number" name="memoryAutoProfileEvery" min="5" max="500" value="${esc(s.memoryAutoProfileEvery ?? 20)}" />
        </div>
        <p class="mengli-muted">保存后，本地桥接会在下一次推送（约 15 秒内）同步这些设置。</p>
        <p class="mengli-error" data-mengli-settings-error hidden></p>
        <button class="mengli-save" type="submit">保存设置</button>
      </form>
    </div>
  `
}

function renderBind(state, ctx) {
  if (!ctx.user) {
    return '<div class="mengli-panel"><div class="mengli-empty">请先登录皮肤站，再绑定 QQ。</div></div>'
  }
  const status = state.bindStatus || {}
  const user = status.user || ctx.user
  const bindings = Array.isArray(status.bindings) ? status.bindings : []
  const code = state.bindCode
  return `
    <div class="mengli-panel">
      <form class="mengli-settings" data-mengli-bind-form>
        <div>
          <h3 style="margin:0 0 4px">绑定 QQ</h3>
          <p class="mengli-muted">生成绑定码后，在 QQ 里发给梦璃，就会把你当前站点账号和发码的群身份关联起来，不需要填写 QQ 号。每个群需要单独绑定一次。</p>
        </div>
        <div class="mengli-setting-row">
          <label>当前站点账号<small>${esc(user.nickname || user.username || '')} · @${esc(user.username || '')}</small></label>
        </div>
        <button class="mengli-save" type="submit">生成绑定码</button>
        ${code ? `<div style="margin-top:12px;padding:16px;border:1px dashed #2563eb;border-radius:12px;text-align:center">
          <div class="mengli-muted">把你的绑定码发给梦璃</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:8px;margin:8px 0">${esc(code.code)}</div>
          <div class="mengli-muted">在群里 @梦璃 发：<code>/绑定账号 ${esc(code.code)}</code>；私聊直接发。${code.expiresAt ? `<br>有效期至 ${esc(fmtTime(code.expiresAt))}` : ''}</div>
        </div>` : ''}
        <p class="mengli-error" data-mengli-bind-error ${state.bindError ? '' : 'hidden'}>${esc(state.bindError || '')}</p>
      </form>
      <div class="mengli-settings" style="border-top:1px solid rgba(127,127,127,.14)">
        <h3 style="margin:0">已绑定的群身份</h3>
        ${bindings.length ? bindings.map(binding => `<div class="mengli-setting-row">
          <label>${esc(binding.bindingKey || '')}<small>${binding.qq ? `QQ ${esc(binding.qq)} · ` : ''}绑定于 ${esc(fmtTime(binding.boundAt))}</small></label>
        </div>`).join('') : '<p class="mengli-muted">还没有绑定。生成绑定码后在 QQ 群里发给梦璃。</p>'}
      </div>
    </div>
  `
}

function renderMyMemory(state) {
  const data = state.myMemory || {}
  if (!data.bound) {
    return '<div class="mengli-panel"><div class="mengli-empty">你还没有绑定 QQ。先在「绑定QQ」生成绑定码，再在群里发给梦璃。</div></div>'
  }
  const members = Array.isArray(data.members) ? data.members : []
  if (!members.length) {
    return '<div class="mengli-panel"><div class="mengli-empty">已经绑定，梦璃还没有同步到你的记忆。聊几句后这里会自动出现。</div></div>'
  }
  return `<div class="mengli-panel">
    <div class="mengli-memory">
      ${members.map(member => {
        const notes = member.notes || []
        const messages = member.recentMessages || []
        return `<article class="mengli-card">
          <h3>${esc(member.nickname || '我')}</h3>
          <div class="mengli-muted">${esc(member.observedMessageCount || 0)} 条发言 · 最近 ${esc(fmtTime(member.lastActivityAt))}</div>
          ${member.aliases?.length ? `<p><strong>别名：</strong>${member.aliases.map(alias => `<span class="mengli-tag">${esc(alias)}</span>`).join('')}</p>` : ''}
          ${member.summary ? `<p><strong>摘要：</strong>${esc(member.summary)}</p>` : ''}
          ${member.personality ? `<p><strong>人格：</strong>${esc(member.personality)}</p>` : ''}
          ${member.interactionStyle ? `<p><strong>互动风格：</strong>${esc(member.interactionStyle)}</p>` : ''}
          ${member.tags?.length ? `<p>${member.tags.map(tag => `<span class="mengli-tag">${esc(tag)}</span>`).join('')}</p>` : ''}
          ${notes.length ? `<div><div class="mengli-muted">备注</div><ul class="mengli-list">${notes.slice(0, 5).map(note => `<li>${esc(note.content)}</li>`).join('')}</ul></div>` : ''}
          ${messages.length ? `<div><div class="mengli-muted">最近发言</div><ul class="mengli-list">${messages.slice(-4).map(item => `<li>${esc(item.content)}</li>`).join('')}</ul></div>` : ''}
        </article>`
      }).join('')}
    </div>
  </div>`
}

export async function mount(root, ctx) {
  const hashQuery = new URLSearchParams(String(location.hash).split('?')[1] || '')
  const isAdmin = Boolean(ctx.user?.isAdmin)
  const requestedTab = hashQuery.get('tab')
  const initialTab = requestedTab === 'bind'
    ? 'bind'
    : !isAdmin ? (requestedTab === 'my-memory' ? 'my-memory' : 'bind')
      : ['memory', 'settings'].includes(requestedTab) ? requestedTab : 'logs'
  const state = {
    tab: initialTab,
    isAdmin,
    logs: [],
    logTotal: 0,
    members: [],
    settings: {},
    settingsUpdatedAt: null,
    bindStatus: null,
    bindCode: null,
    bindError: '',
    myMemory: null,
    myMemoryError: '',
    logQuery: '',
    logFilter: 'all',
    memoryQuery: '',
    updatedAt: null,
    error: '',
    timer: null,
  }

  root.innerHTML = `${STYLE}<section class="mengli-wrap">
    <div class="mengli-head">
      <div><h2 class="mengli-title">梦璃</h2><p class="mengli-sub">${isAdmin ? 'QQ 群日志、群友记忆与机器人设置 · 管理员面板' : '绑定 QQ，查看梦璃记住的你'}</p></div>
      <div class="mengli-tabs">
        <button class="mengli-tab ${state.tab === 'bind' ? 'active' : ''}" data-mengli-tab="bind">绑定QQ</button>
        ${isAdmin ? `<button class="mengli-tab ${state.tab === 'logs' ? 'active' : ''}" data-mengli-tab="logs">日志</button>
        <button class="mengli-tab ${state.tab === 'memory' ? 'active' : ''}" data-mengli-tab="memory">群友记忆</button>
        <button class="mengli-tab ${state.tab === 'settings' ? 'active' : ''}" data-mengli-tab="settings">设置</button>`
          : `<button class="mengli-tab ${state.tab === 'my-memory' ? 'active' : ''}" data-mengli-tab="my-memory">我的记忆</button>`}
      </div>
    </div>
    <div data-mengli-body></div>
    <p class="mengli-muted" data-mengli-meta></p>
  </section>`

  const body = root.querySelector('[data-mengli-body]')
  const meta = root.querySelector('[data-mengli-meta]')

  root.querySelectorAll('[data-mengli-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.mengliTab
      if (!['bind', 'logs', 'memory', 'settings', 'my-memory'].includes(tab)) return
      if (tab !== 'bind' && tab !== 'my-memory' && !isAdmin) return
      if (tab === 'my-memory' && isAdmin) return
      state.tab = tab
      root.querySelectorAll('[data-mengli-tab]').forEach(item => item.classList.toggle('active', item === button))
      render()
    })
  })

  async function load() {
    const jobs = [loadBind()]
    if (isAdmin) jobs.push(loadAdmin())
    else jobs.push(loadMyMemory())
    await Promise.allSettled(jobs)
    render()
  }

  async function loadBind() {
    try {
      state.bindStatus = await ctx.api.get('/plugins/mengli/bind/status')
      state.bindError = ''
    } catch (error) {
      state.bindStatus = null
      state.bindError = error?.message || '读取绑定状态失败'
    }
  }

  async function loadMyMemory() {
    try {
      state.myMemory = await ctx.api.get('/plugins/mengli/my-memory')
      state.myMemoryError = ''
    } catch (error) {
      state.myMemory = null
      state.myMemoryError = error?.message || '读取我的记忆失败'
    }
  }

  async function loadAdmin() {
    try {
      const [logs, memory, settingsData] = await Promise.all([
        ctx.api.get('/plugins/mengli/logs?limit=300'),
        ctx.api.get('/plugins/mengli/memory'),
        ctx.api.get('/plugins/mengli/settings'),
      ])
      state.logs = Array.isArray(logs?.items) ? logs.items : []
      state.logTotal = Number(logs?.total || state.logs.length)
      state.members = Array.isArray(memory?.members) ? memory.members : []
      state.settings = settingsData?.settings || {}
      state.settingsUpdatedAt = settingsData?.updatedAt || null
      state.updatedAt = logs?.updatedAt || memory?.updatedAt || null
      state.error = ''
    } catch (error) {
      state.error = error?.message || '读取梦璃数据失败，请确认管理员登录。'
    }
  }

  function render() {
    body.innerHTML = state.tab === 'bind'
      ? renderBind(state, ctx)
      : state.tab === 'my-memory'
        ? state.myMemoryError
          ? `<div class="mengli-panel"><div class="mengli-error">${esc(state.myMemoryError)}</div></div>`
          : renderMyMemory(state)
        : state.error
          ? `<div class="mengli-panel"><div class="mengli-error">${esc(state.error)}</div></div>`
          : state.tab === 'memory' ? renderMemory(state)
            : state.tab === 'settings' ? renderSettings(state)
              : renderLogs(state)
    meta.textContent = state.updatedAt
      ? `最近推送：${fmtTime(state.updatedAt)}`
      : state.settingsUpdatedAt ? `设置更新：${fmtTime(state.settingsUpdatedAt)}`
        : state.myMemory?.updatedAt ? `记忆更新：${fmtTime(state.myMemory.updatedAt)}` : ''
    const applyLogFilter = () => {
      const query = state.logQuery.trim().toLowerCase()
      body.querySelectorAll('.mengli-event').forEach(item => {
        const categories = String(item.dataset.logCategories || '').split(/\s+/)
        const typeOk = state.logFilter === 'all' || categories.includes(state.logFilter)
        const queryOk = !query || String(item.dataset.logSearch || '').includes(query)
        item.hidden = !(typeOk && queryOk)
      })
      body.querySelectorAll('[data-mengli-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.mengliFilter === state.logFilter)
      })
    }
    const logSearch = body.querySelector('#mengliLogSearch')
    if (logSearch) {
      logSearch.addEventListener('input', () => {
        state.logQuery = logSearch.value
        applyLogFilter()
      })
    }
    body.querySelectorAll('[data-mengli-filter]').forEach(button => {
      button.addEventListener('click', () => {
        state.logFilter = button.dataset.mengliFilter || 'all'
        applyLogFilter()
      })
    })
    applyLogFilter()
    const memorySearch = body.querySelector('#mengliMemorySearch')
    if (memorySearch) {
      const applyFilter = () => {
        state.memoryQuery = memorySearch.value
        const query = state.memoryQuery.trim().toLowerCase()
        body.querySelectorAll('[data-mengli-search]').forEach(card => {
          card.hidden = Boolean(query) && !card.dataset.mengliSearch.includes(query)
        })
      }
      memorySearch.addEventListener('input', applyFilter)
      applyFilter()
    }
    const bindForm = body.querySelector('[data-mengli-bind-form]')
    if (bindForm) {
      bindForm.addEventListener('submit', async event => {
        event.preventDefault()
        const errorEl = bindForm.querySelector('[data-mengli-bind-error]')
        const button = bindForm.querySelector('.mengli-save')
        if (button) button.disabled = true
        if (errorEl) errorEl.hidden = true
        try {
          state.bindCode = await ctx.api.post('/plugins/mengli/bind/code', {})
          state.bindError = ''
          ctx.toast?.('绑定码已生成', 'success')
          render()
        } catch (error) {
          state.bindError = error?.message || '生成绑定码失败'
          render()
        } finally {
          if (button) button.disabled = false
        }
      })
    }
    const settingsForm = body.querySelector('[data-mengli-settings-form]')
    if (settingsForm) {      const probability = settingsForm.querySelector('input[name="autoReplyProbability"]')
      const probabilityLabel = settingsForm.querySelector('[data-mengli-prob]')
      if (probability && probabilityLabel) {
        probability.addEventListener('input', () => { probabilityLabel.textContent = `${probability.value}%` })
      }
      settingsForm.addEventListener('submit', async event => {
        event.preventDefault()
        const errorEl = settingsForm.querySelector('[data-mengli-settings-error]')
        const button = settingsForm.querySelector('.mengli-save')
        if (errorEl) errorEl.hidden = true
        if (button) button.disabled = true
        const value = name => settingsForm.querySelector(`[name="${name}"]`)?.value || ''
        const checked = name => Boolean(settingsForm.querySelector(`[name="${name}"]`)?.checked)
        const payload = {
          mediaEnabled: checked('mediaEnabled'),
          mcPlayerLimit: Number(value('mcPlayerLimit')) || 5,
          autoReplyEnabled: checked('autoReplyEnabled'),
          autoReplyProbability: Number(value('autoReplyProbability')) / 100,
          autoReplyCooldownSeconds: Number(value('autoReplyCooldownSeconds')) || 0,
          autoReplySmart: checked('autoReplySmart'),
          autoReplyUserCooldownSeconds: Number(value('autoReplyUserCooldownSeconds')) || 0,
          memoryEnabled: checked('memoryEnabled'),
          memoryRetentionDays: Number(value('memoryRetentionDays')) || 0,
          memoryRecentMessages: Number(value('memoryRecentMessages')) || 6,
          memoryAutoProfile: checked('memoryAutoProfile'),
          memoryAutoProfileEvery: Number(value('memoryAutoProfileEvery')) || 20,
        }
        try {
          const result = await ctx.api.post('/plugins/mengli/settings', payload)
          state.settings = result?.settings || payload
          state.settingsUpdatedAt = result?.updatedAt || new Date().toISOString()
          ctx.toast?.('梦璃设置已保存，桥接会在下一次推送时同步。', 'success')
          render()
        } catch (error) {
          if (errorEl) {
            errorEl.hidden = false
            errorEl.textContent = error?.message || '保存失败'
          }
          ctx.toast?.(error?.message || '保存失败', 'error')
        } finally {
          if (button) button.disabled = false
        }
      })
    }
    body.querySelectorAll('[data-mengli-refresh]').forEach(button => button.addEventListener('click', () => void load()))
  }

  await load()
  state.timer = setInterval(() => void load(), 15000)
  return () => {
    if (state.timer) clearInterval(state.timer)
    state.timer = null
  }
}
