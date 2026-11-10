import { api } from '../api.js';
import {
  bindTextureCards,
  mountTextureCards,
  openTextureDetail,
  textureCardHtml,
} from '../components/texture.js';
import { icon } from '../icons.js';
import * as ui from '../ui.js';
import { renderRoles } from './admin-roles.js';
import { renderUsers } from './admin-users.js';
import { renderApiKeys } from './admin-api-keys.js';
import { renderMinecraftServers } from './admin-minecraft-servers.js';
import { render as renderPluginPage } from './plugin.js';

const SIDEBAR_GROUPS_KEY = 'swust.admin.sidebar.groups';
let adminPluginCleanup = null;

function pluginTabOf(path) {
  const raw = String(path || '');
  const queryIndex = raw.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : '').get('tab') || 'logs';
}

function pluginNavKey(pluginId, path) {
  return `plugin:${pluginId}:${pluginTabOf(path)}`;
}

function toAdminPluginHref(path, pluginId) {
  if (!path) return `#/admin/plugin/${encodeURIComponent(pluginId)}`;
  if (path.startsWith('#/plugin/')) return path.replace(/^#\/plugin\//, '#/admin/plugin/');
  return path;
}

const SECTIONS = [
  { key: '', label: '概览', icon: 'layers', category: '工作台' },
  { key: 'users', label: '用户管理', icon: 'users', permission: 'system:user:view', category: '用户与权限' },
  { key: 'roles', label: '角色管理', icon: 'shield', permission: 'system:role:view', category: '用户与权限' },
  { key: 'players', label: '角色档案', icon: 'user', permission: 'skin:player:view', category: '皮肤站' },
  { key: 'textures', label: '材质管理', icon: 'image', permission: 'skin:texture:view', category: '皮肤站' },
  { key: 'minecraft-servers', label: 'MC 服务器', icon: 'server', permission: 'plugin:minecraft-server:use', category: '社团服务' },
  { key: 'plugins', label: '插件管理', icon: 'plugin', permission: 'skin:plugin:view', category: '插件与扩展' },
  { key: 'api-keys', label: 'API 密钥', icon: 'key', permission: 'system:user:view', category: '插件与扩展' },
  { key: 'settings', label: '站点设置', icon: 'settings', permission: 'system:setting:view', category: '系统' },
];

function can(user, code) {
  if (!user?.isAdmin) return false;
  return Boolean(user.wildcard || user.permissions?.includes('*') || user.permissions?.includes(code));
}

function displayName(user) {
  return user?.nickname || user?.username || '社员';
}

function statusLabel(status) {
  return status === 'ACTIVE' ? '正常' : status === 'DISABLED' ? '已停用' : status;
}

function pagerHtml(data) {
  if (!data || data.pages <= 1) return '';
  return `
    <nav class="pagination admin-pager" data-pager aria-label="分页">
      <button class="pager-btn" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>${icon('chevron')}</button>
      <span class="pager-label">第 ${data.page} / ${data.pages} 页 · 共 ${data.total} 条</span>
      <button class="pager-btn pager-next" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>${icon('chevron')}</button>
    </nav>
  `;
}

function bindPager(container, handler) {
  container.querySelectorAll('.pagination').forEach((pager) => {
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      handler(Number(button.dataset.page));
    });
  });
}

function statusPill(active, activeText = '正常', inactiveText = '已停用') {
  return `<span class="status-pill ${active ? 'online' : 'offline'}"><span class="status-dot"></span>${active ? activeText : inactiveText}</span>`;
}

function emptyTable(text) {
  return `<div class="empty-state compact"><span class="empty-icon">${icon('moon')}</span><p>${ui.escapeHtml(text)}</p></div>`;
}

function formatUptime(seconds) {
  const total = Number(seconds) || 0;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export async function render(root, ctx) {
  if (adminPluginCleanup) {
    adminPluginCleanup();
    adminPluginCleanup = null;
  }
  const parts = ctx.path.split('/').filter(Boolean);
  const pluginId = parts[1] === 'plugin' ? decodeURIComponent(parts[2] || '') : '';
  const section = pluginId ? 'plugin' : (parts[1] || '');
  const active = pluginId
    ? `plugin:${pluginId}:${ctx.query?.tab || 'logs'}`
    : SECTIONS.some((item) => item.key === section) ? section : '';
  const visibleSections = SECTIONS.filter(
    (item) => !item.permission || can(ctx.user, item.permission)
  );
  const activeSection = pluginId
    ? {
        key: active,
        label: '插件页面',
        permission: `plugin:${pluginId}:use`,
      }
    : SECTIONS.find((item) => item.key === active);
  const plugin = pluginId ? (ctx.plugins || []).find((item) => item.id === pluginId) : null;
  const activeLabel = pluginId
    ? (plugin?.adminNav || []).find((entry) => pluginNavKey(pluginId, entry.path) === active)?.title
      || plugin?.name
      || '插件页面'
    : activeSection?.label || '概览';
  const allowed = !activeSection?.permission || can(ctx.user, activeSection.permission);
  const roleLabel = (ctx.user.roleNames || []).join(' / ') || '管理员';
  const collapsedGroups = new Set();
  try {
    const storedGroups = JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) || '[]');
    if (Array.isArray(storedGroups)) {
      for (const category of storedGroups) collapsedGroups.add(String(category));
    }
  } catch {
    // 忽略损坏的本地状态
  }
  const navGroups = [];
  for (const item of visibleSections) {
    let group = navGroups.find((entry) => entry.category === item.category);
    if (!group) {
      group = { category: item.category, items: [] };
      navGroups.push(group);
    }
    group.items.push({
      href: `#/admin${item.key ? `/${item.key}` : ''}`,
      label: item.label,
      icon: item.icon,
      key: item.key,
    });
  }
  for (const plugin of ctx.plugins || []) {
    if (!can(ctx.user, plugin.permission)) continue;
    const entries = Array.isArray(plugin.adminNav) && plugin.adminNav.length
      ? plugin.adminNav
      : plugin.nav
        ? [{
            title: plugin.nav.title,
            category: '插件页面',
            icon: plugin.nav.icon,
            path: `#/plugin/${encodeURIComponent(plugin.id)}`,
          }]
        : [];
    for (const entry of entries) {
      const category = entry.category || '插件页面';
      let group = navGroups.find((item) => item.category === category);
      if (!group) {
        group = { category, items: [] };
        navGroups.push(group);
      }
      group.items.push({
        href: toAdminPluginHref(entry.path, plugin.id),
        label: entry.title || plugin.name,
        icon: entry.icon || 'plugin',
        key: pluginNavKey(plugin.id, entry.path),
      });
    }
  }

  const activeGroup = navGroups.find((group) => group.items.some((item) => item.key === active));
  if (activeGroup) collapsedGroups.delete(activeGroup.category);

  const existingShell = root.querySelector('.yd-admin');
  if (existingShell) {
    const main = existingShell.querySelector('[data-admin-main]');
    const activeNavItem = navGroups.flatMap((group) => group.items).find((item) => item.key === active);
    const activeHref = activeNavItem?.href || `#/admin${active ? `/${active}` : ''}`;
    existingShell.querySelectorAll('.yd-admin-menu a').forEach((link) => {
      link.classList.toggle('is-active', link.getAttribute('href') === activeHref);
    });
    const breadcrumb = existingShell.querySelector('.yd-admin-breadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = activeLabel;
    if (activeGroup) {
      existingShell.querySelectorAll('[data-group-toggle]').forEach((button) => {
        if (button.dataset.groupToggle !== activeGroup.category) return;
        const group = button.closest('.yd-admin-menu-group');
        if (!group) return;
        group.classList.remove('is-collapsed');
        const items = group.querySelector('.yd-admin-menu-items');
        if (items) items.style.height = '';
        button.setAttribute('aria-expanded', 'true');
      });
    }
    if (main) {
      main.classList.remove('admin-section-enter');
      await renderAdminSection(main, ctx, active, activeSection, allowed, pluginId);
      main.classList.add('admin-section-enter');
      if (
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
        typeof main.animate === 'function'
      ) {
        main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease' });
      }
    }
    return () => {
      if (adminPluginCleanup) {
        adminPluginCleanup();
        adminPluginCleanup = null;
      }
    };
  }

  root.innerHTML = `
    <section class="yd-admin">
      <aside class="yd-admin-sidebar">
        <a class="yd-admin-brand" href="#/">
          <img src="/assets/brand/badge.png" alt="" />
          <span>
            <strong>${ui.escapeHtml(ctx.settings.site_short_name || '星空社')}</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </a>
        <nav class="yd-admin-menu" aria-label="管理后台导航">
          ${navGroups
            .map(
              (group) => `
            <div class="yd-admin-menu-group${collapsedGroups.has(group.category) ? ' is-collapsed' : ''}">
              <button class="yd-admin-menu-label" type="button" data-group-toggle="${ui.escapeHtml(
                group.category
              )}" aria-expanded="${collapsedGroups.has(group.category) ? 'false' : 'true'}">
                <span>${ui.escapeHtml(group.category)}</span>
                ${icon('chevron', 'group-chevron')}
              </button>
              <div class="yd-admin-menu-items">
                <div class="yd-admin-menu-items-inner">
                  ${group.items
                    .map(
                      (item) => `
                    <a href="${item.href}" class="${item.key === active ? 'is-active' : ''}" title="${ui.escapeHtml(
                      item.label
                    )}">
                      ${icon(item.icon)}
                      <span>${ui.escapeHtml(item.label)}</span>
                    </a>
                  `
                    )
                    .join('')}
                </div>
              </div>
            </div>
          `
            )
            .join('')}
        </nav>
        <div class="yd-admin-side-foot">
          <a href="#/">${icon('arrow')}<span>返回站点</span></a>
          <span>SWUSTMC · v1.0.0</span>
        </div>
      </aside>
      <div class="yd-admin-workspace">
        <header class="yd-admin-topbar">
          <div class="yd-admin-breadcrumb">
            <span>管理后台</span>
            ${icon('chevron')}
            <strong>${ui.escapeHtml(activeLabel)}</strong>
          </div>
          <div class="yd-admin-top-actions">
            <a class="yd-admin-site-link" href="#/">${icon('external')}查看站点</a>
            <span class="yd-admin-user-chip">
              ${ui.avatarHtml(displayName(ctx.user), { size: 'sm', avatar: ctx.user.avatar })}
              <span><strong>${ui.escapeHtml(displayName(ctx.user))}</strong><small>${ui.escapeHtml(
                roleLabel
              )}</small></span>
            </span>
            <button class="btn btn-ghost btn-sm" data-admin-logout>${icon('logout')}退出</button>
          </div>
        </header>
        <main class="yd-admin-content" data-admin-main>
          ${allowed ? ui.loadingBlock('正在加载管理面板…') : ''}
        </main>
      </div>
    </section>
  `;

  root.querySelectorAll('[data-group-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.closest('.yd-admin-menu-group');
      if (!group) return;
      const items = group.querySelector('.yd-admin-menu-items');
      const expanding = group.classList.contains('is-collapsed');
      if (items) {
        clearTimeout(items._heightTimer);
        if (expanding) {
          group.classList.remove('is-collapsed');
          items.style.height = '0px';
          void items.offsetHeight;
          items.style.height = `${items.scrollHeight}px`;
          items._heightTimer = setTimeout(() => {
            items.style.height = '';
          }, 280);
        } else {
          items.style.height = `${items.scrollHeight}px`;
          void items.offsetHeight;
          group.classList.add('is-collapsed');
          items.style.height = '0px';
        }
      }
      const collapsed = group.classList.contains('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      const category = button.dataset.groupToggle;
      if (collapsed) collapsedGroups.add(category);
      else collapsedGroups.delete(category);
      try {
        localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify([...collapsedGroups]));
      } catch {
        // 忽略无法写入本地存储的情况
      }
    });
  });

  root.querySelector('[data-admin-logout]')?.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // 忽略退出请求错误
    }
    ctx.setAuth(null, null);
    ctx.navigate('/');
    ui.toast('已退出登录', 'info');
  });

  const main = root.querySelector('[data-admin-main]');
  await renderAdminSection(main, ctx, active, activeSection, allowed, pluginId);
  return () => {
    if (adminPluginCleanup) {
      adminPluginCleanup();
      adminPluginCleanup = null;
    }
  };
}

async function renderAdminSection(main, ctx, active, activeSection, allowed, pluginId = '') {
  if (!allowed) {
    main.innerHTML = `
      <section class="page-error">
        <span class="empty-icon">${icon('shield')}</span>
        <h1>没有访问权限</h1>
        <p>当前角色缺少 ${ui.escapeHtml(activeSection?.permission || '')} 权限。</p>
        <a class="btn btn-primary" href="#/admin">返回概览</a>
      </section>
    `;
    return;
  }

  if (pluginId) {
    adminPluginCleanup = await renderPluginPage(main, {
      ...ctx,
      path: `/plugin/${encodeURIComponent(pluginId)}`,
      adminEmbed: true,
    }) || null;
    return;
  }

  if (active === 'users') await renderUsers(main, ctx);
  else if (active === 'roles') await renderRoles(main, ctx);
  else if (active === 'players') await renderPlayers(main, ctx);
  else if (active === 'textures') await renderTextures(main, ctx);
  else if (active === 'minecraft-servers') await renderMinecraftServers(main, ctx);
  else if (active === 'plugins') await renderPlugins(main, ctx);
  else if (active === 'api-keys') await renderApiKeys(main, ctx);
  else if (active === 'settings') await renderSettings(main, ctx);
  else await renderOverview(main, ctx);
}

async function renderOverview(main, ctx) {
  main.innerHTML = ui.loadingBlock('正在汇总社团数据…');
  try {
    const data = await api.get('/admin/stats');
    const counts = data.counts;
    main.innerHTML = `
      <section class="admin-page-head">
        <div>
          <p class="eyebrow">OVERVIEW</p>
          <h2>社团数据概览</h2>
          <p>${ui.formatDate(new Date().toISOString(), { time: true })} · 实时统计</p>
        </div>
        <div class="admin-head-actions">
          <a class="btn btn-ghost" href="#/library">${icon('library')}查看前台</a>
          ${can(ctx.user, 'system:user:view') ? `<a class="btn btn-primary" href="#/admin/users">${icon('users')}管理用户</a>` : ''}
        </div>
      </section>
      <section class="stat-grid">
        <article class="stat-card"><span class="stat-icon">${icon('users')}</span><div><strong>${counts.users}</strong><span>注册用户</span></div><small>${counts.activeUsers ?? counts.users} 个正常账号</small></article>
        <article class="stat-card"><span class="stat-icon">${icon('image')}</span><div><strong>${counts.textures}</strong><span>公开材质</span></div><small>${counts.privateTextures} 件私有材质</small></article>
        <article class="stat-card"><span class="stat-icon">${icon('download')}</span><div><strong>${counts.downloads}</strong><span>累计下载</span></div><small>材质库整体热度</small></article>
        <article class="stat-card"><span class="stat-icon">${icon('plugin')}</span><div><strong>${counts.pluginsEnabled}/${counts.plugins}</strong><span>插件启用</span></div><small>可热加载的站点扩展</small></article>
      </section>
      <section class="admin-two-col">
        <div class="panel">
          <div class="panel-head"><div><p class="eyebrow">RECENT MEMBERS</p><h3>最近注册</h3></div><a class="text-link" href="#/admin/users">全部用户</a></div>
          <div class="mini-list">
            ${data.recentUsers
              .map(
                (user) => `
                <div class="mini-row">
                  ${ui.avatarHtml(displayName(user), { size: 'sm', avatar: user.avatar })}
                  <div><strong>${ui.escapeHtml(displayName(user))}</strong><span>${ui.escapeHtml(
                    user.roleNames?.join(' / ') || user.username
                  )}</span></div>
                  <span class="mini-meta">${ui.formatDate(user.createTime)}</span>
                </div>
              `
              )
              .join('') || '<p class="muted-text">暂无用户</p>'}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><p class="eyebrow">RUNTIME</p><h3>运行环境</h3></div><span class="type-pill muted">JAVA</span></div>
          <dl class="runtime-list">
            <div><dt>对外地址</dt><dd><code>${ui.escapeHtml(data.runtime.baseUrl)}</code></dd></div>
            <div><dt>运行时</dt><dd>${ui.escapeHtml(data.runtime.node)}</dd></div>
            <div><dt>已运行</dt><dd>${formatUptime(data.runtime.uptime)}</dd></div>
            <div><dt>认证端点</dt><dd><code>${ui.escapeHtml(data.runtime.baseUrl)}/api/yggdrasil</code></dd></div>
          </dl>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><p class="eyebrow">LATEST TEXTURES</p><h3>最新材质</h3></div><a class="text-link" href="#/admin/textures">材质管理</a></div>
        ${
          data.recentTextures.length
            ? `<div class="skin-grid admin-recent-grid">${data.recentTextures
                .map((texture) => textureCardHtml(texture, { compact: true }))
                .join('')}</div>`
            : emptyTable('暂无材质')
        }
      </section>
    `;
    bindTextureCards(main, (id) => openTextureDetail(ctx, id, { onChanged: () => ctx.navigate('/admin') }));
    await mountTextureCards(main);
  } catch (error) {
    main.innerHTML = ui.emptyState('概览加载失败', error.message, '<button class="btn btn-primary" data-retry>重试</button>');
    main.querySelector('[data-retry]')?.addEventListener('click', () => renderOverview(main, ctx));
  }
}

async function renderPlayers(main, ctx) {
  const state = { q: '', page: 1 };
  main.innerHTML = `
    <section class="admin-page-head">
      <div><p class="eyebrow">PLAYERS</p><h2>角色管理</h2><p>查看全部角色、所属社员与装备情况。</p></div>
    </section>
    <div class="toolbar"><label class="search-box">${icon('search')}<input type="search" placeholder="搜索角色名或社员" data-search /></label></div>
    <div class="panel table-panel" data-table>${ui.loadingBlock('正在加载角色…')}</div>
    <div data-pager-host></div>
  `;
  const tableHost = main.querySelector('[data-table]');
  const pagerHost = main.querySelector('[data-pager-host]');
  const search = main.querySelector('[data-search]');
  let rows = [];

  async function load() {
    tableHost.innerHTML = ui.loadingBlock('正在加载角色…');
    try {
      const data = await api.get('/admin/players', { q: state.q, page: state.page, perPage: 30 });
      rows = data.items;
      tableHost.innerHTML = `
        <table class="data-table player-table">
          <thead><tr><th>角色</th><th>所属社员</th><th>模型</th><th>外观</th><th>创建时间</th><th class="table-actions-col">操作</th></tr></thead>
          <tbody>
            ${data.items
              .map(
                (player) => `
              <tr>
                <td data-label="角色"><div class="name-cell"><strong>${ui.escapeHtml(player.name)}</strong><code>${player.uuid.slice(
                  0,
                  8
                )}…</code></div></td>
                <td data-label="所属社员">${ui.avatarHtml(player.owner?.username || '?', { size: 'xs' })} ${ui.escapeHtml(
                  player.owner?.username || '已注销'
                )}</td>
                <td data-label="模型"><span class="role-chip muted">${ui.modelLabel(player.model)}</span></td>
                <td data-label="外观">${player.skin ? ui.escapeHtml(player.skin.name) : '默认皮肤'}${
                  player.cape ? ` · ${ui.escapeHtml(player.cape.name)}` : ''
                }</td>
                <td data-label="创建时间">${ui.formatDate(player.createdAt)}</td>
                <td data-label="操作" class="table-actions">
                  <button class="btn btn-ghost btn-sm" data-action="rename-player" data-id="${player.id}">${icon('edit')}改名</button>
                  <button class="btn btn-ghost btn-sm" data-action="transfer-player" data-id="${player.id}">${icon('users')}转让</button>
                  <button class="btn btn-ghost btn-sm danger-text" data-action="delete-player" data-id="${player.id}">${icon('trash')}删除</button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        ${data.items.length ? '' : emptyTable('没有找到角色')}
      `;
      pagerHost.innerHTML = pagerHtml(data);
      bindPager(pagerHost, (page) => {
        state.page = page;
        load();
      });
    } catch (error) {
      tableHost.innerHTML = emptyTable(error.message);
    }
  }

  function openRename(player) {
    const content = document.createElement('div');
    content.innerHTML = `
      <form class="form-stack">
        <label class="field"><span>角色名</span><input name="name" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${ui.escapeHtml(
          player.name
        )}" /></label>
        <p class="field-hint">改名会保留角色 UUID。</p>
      </form>
    `;
    ui.openModal({
      title: '修改角色名',
      content,
      size: 'sm',
      actions: [
        { label: '取消', className: 'btn-ghost' },
        {
          label: '保存',
          className: 'btn-primary',
          onClick: async ({ close, button }) => {
            const form = content.querySelector('form');
            if (!form.reportValidity()) return false;
            ui.setButtonLoading(button, true, '保存中…');
            try {
              await api.patch(`/admin/players/${player.id}`, { name: form.elements.name.value.trim() });
              ui.setButtonLoading(button, false);
              ui.toast('角色名已更新', 'success');
              close();
              load();
            } catch (error) {
              ui.setButtonLoading(button, false);
              ui.toast(error.message, 'error');
              return false;
            }
            return true;
          },
        },
      ],
    });
  }

  async function openTransfer(player) {
    let users = [];
    try {
      const data = await api.get('/admin/users', { perPage: 60, page: 1 });
      users = data.items;
    } catch (error) {
      ui.toast(error.message, 'error');
      return;
    }
    const content = document.createElement('div');
    content.innerHTML = `
      <form class="form-stack">
        <p class="confirm-message">将角色 <strong>${ui.escapeHtml(player.name)}</strong> 转让给另一位社员。</p>
        <label class="field"><span>目标社员</span>
          <select name="userId">
            ${users
              .map(
                (user) =>
                  `<option value="${user.id}" ${user.id === player.owner?.id ? 'selected' : ''}>${ui.escapeHtml(
                    user.username
                  )}（${ui.escapeHtml(user.email)}）</option>`
              )
              .join('')}
          </select>
        </label>
      </form>
    `;
    ui.openModal({
      title: '转让角色',
      content,
      size: 'sm',
      actions: [
        { label: '取消', className: 'btn-ghost' },
        {
          label: '转让',
          className: 'btn-primary',
          onClick: async ({ close, button }) => {
            const userId = String(content.querySelector('select[name="userId"]').value || '');
            ui.setButtonLoading(button, true, '转让中…');
            try {
              await api.patch(`/admin/players/${player.id}`, { userId });
              ui.setButtonLoading(button, false);
              ui.toast('角色已转让', 'success');
              close();
              load();
            } catch (error) {
              ui.setButtonLoading(button, false);
              ui.toast(error.message, 'error');
              return false;
            }
            return true;
          },
        },
      ],
    });
  }

  search.addEventListener('input', ui.debounce(() => {
    state.q = search.value.trim();
    state.page = 1;
    load();
  }, 300));

  main.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const player = rows.find((item) => item.id === Number(button.dataset.id));
    if (!player) return;
    if (button.dataset.action === 'rename-player') openRename(player);
    else if (button.dataset.action === 'transfer-player') openTransfer(player);
    else if (button.dataset.action === 'delete-player') {
      const confirmed = await ui.confirmDialog({
        title: '删除角色',
        message: `确定删除角色「${player.name}」吗？此操作不可撤销。`,
        confirmText: '删除角色',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/admin/players/${player.id}`);
        ui.toast('角色已删除', 'success');
        load();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    }
  });

  await load();
}

async function renderTextures(main, ctx) {
  const state = { q: '', type: 'all', page: 1 };
  main.innerHTML = `
    <section class="admin-page-head">
      <div><p class="eyebrow">TEXTURES</p><h2>材质管理</h2><p>审核公开状态、查看归属并清理不合适的材质。</p></div>
      <div class="admin-head-actions"><a class="btn btn-primary" href="#/upload">${icon('upload')}上传材质</a></div>
    </section>
    <div class="toolbar">
      <div class="filter-chips" data-type-filter>
        <button class="chip is-active" data-type="all">全部</button>
        <button class="chip" data-type="skin">皮肤</button>
        <button class="chip" data-type="cape">披风</button>
      </div>
      <label class="search-box">${icon('search')}<input type="search" placeholder="搜索材质或上传者" data-search /></label>
    </div>
    <div class="panel table-panel" data-table>${ui.loadingBlock('正在加载材质…')}</div>
    <div data-pager-host></div>
  `;
  const tableHost = main.querySelector('[data-table]');
  const pagerHost = main.querySelector('[data-pager-host]');
  const search = main.querySelector('[data-search]');
  const filter = main.querySelector('[data-type-filter]');
  let rows = [];

  async function load() {
    tableHost.innerHTML = ui.loadingBlock('正在加载材质…');
    try {
      const data = await api.get('/admin/textures', {
        q: state.q,
        type: state.type === 'all' ? '' : state.type,
        page: state.page,
        perPage: 30,
      });
      rows = data.items;
      tableHost.innerHTML = `
        <table class="data-table texture-table">
          <thead><tr><th>材质</th><th>类型</th><th>上传者</th><th>状态</th><th>下载</th><th>上传时间</th><th class="table-actions-col">操作</th></tr></thead>
          <tbody>
            ${data.items
              .map(
                (texture) => `
              <tr>
                <td data-label="材质">
                  <div class="texture-cell">
                    <canvas class="admin-thumb ${texture.type === 'cape' ? 'is-cape' : ''}"
                      data-skin-url="${ui.escapeHtml(texture.url)}"
                      data-skin-model="${ui.escapeHtml(texture.model)}"
                      data-skin-type="${texture.type}"></canvas>
                    <div><strong>${ui.escapeHtml(texture.name)}</strong><span>#${texture.id} · ${texture.width}×${
                      texture.height
                    }</span></div>
                  </div>
                </td>
                <td data-label="类型">${ui.typeLabel(texture.type)} · ${ui.modelLabel(texture.model)}</td>
                <td data-label="上传者">${ui.escapeHtml(texture.uploader?.username || '已注销')}</td>
                <td data-label="状态">${statusPill(texture.isPublic, '公开', '私有')}</td>
                <td data-label="下载">${texture.downloads}</td>
                <td data-label="上传时间">${ui.formatDate(texture.createdAt)}</td>
                <td data-label="操作" class="table-actions">
                  <button class="btn btn-ghost btn-sm" data-action="view-texture" data-id="${texture.id}">${icon('search')}查看</button>
                  <button class="btn btn-ghost btn-sm" data-action="toggle-texture" data-id="${texture.id}">${icon(
                    texture.isPublic ? 'close' : 'check'
                  )}${texture.isPublic ? '设为私有' : '设为公开'}</button>
                  <button class="btn btn-ghost btn-sm danger-text" data-action="delete-texture" data-id="${texture.id}">${icon(
                    'trash'
                  )}删除</button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        ${data.items.length ? '' : emptyTable('没有找到材质')}
      `;
      await mountTextureCards(tableHost);
      pagerHost.innerHTML = pagerHtml(data);
      bindPager(pagerHost, (page) => {
        state.page = page;
        load();
      });
    } catch (error) {
      tableHost.innerHTML = emptyTable(error.message);
    }
  }

  search.addEventListener('input', ui.debounce(() => {
    state.q = search.value.trim();
    state.page = 1;
    load();
  }, 300));

  filter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    state.type = button.dataset.type;
    state.page = 1;
    filter.querySelectorAll('[data-type]').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.type === state.type);
    });
    load();
  });

  main.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const texture = rows.find((item) => item.id === Number(button.dataset.id));
    if (!texture) return;
    if (button.dataset.action === 'view-texture') {
      openTextureDetail(ctx, texture.id, { onChanged: () => load() });
    } else if (button.dataset.action === 'toggle-texture') {
      try {
        await api.patch(`/admin/textures/${texture.id}`, { isPublic: !texture.isPublic });
        ui.toast(texture.isPublic ? '材质已设为私有' : '材质已设为公开', 'success');
        load();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    } else if (button.dataset.action === 'delete-texture') {
      const confirmed = await ui.confirmDialog({
        title: '删除材质',
        message: `确定删除材质「${texture.name}」吗？已装备它的角色会恢复默认外观。`,
        confirmText: '删除材质',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/admin/textures/${texture.id}`);
        ui.toast('材质已删除', 'success');
        load();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    }
  });

  await load();
}

async function renderPlugins(main, ctx) {
  main.innerHTML = `
    <section class="admin-page-head">
      <div><p class="eyebrow">PLUGINS</p><h2>插件管理</h2><p>热加载服务端扩展与前端页面。插件拥有服务端执行权限，请只安装可信来源。</p></div>
      <div class="admin-head-actions">
        <button class="btn btn-ghost" data-action="rescan">${icon('refresh')}重新扫描</button>
        <label class="btn btn-primary upload-button">${icon('upload')}安装 Java 插件 JAR / ZIP<input type="file" accept=".jar,.zip,application/java-archive,application/zip" hidden data-plugin-file /></label>
      </div>
    </section>
    <div class="plugin-admin-grid" data-plugin-list>${ui.loadingBlock('正在读取插件…')}</div>
    <div class="panel plugin-help">
      <div class="panel-head"><div><p class="eyebrow">DEVELOPER</p><h3>插件包结构</h3></div></div>
      <p>插件包根目录放置 <code>plugin.json</code>，<code>mainClass</code> 指向实现 <code>SkinPlugin</code> 的 Java 类，可选 <code>client.mjs</code> 提供前端页面模块。启停与重载即时生效。</p>
      <p class="field-hint">服务端插件以 JAR 形式运行在 Java 宿主内，可直接使用站点 API 与数据库；请只安装可信来源的插件。</p>
      <pre class="code-block small">{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "mainClass": "com.example.MyPlugin",
  "client": "client.mjs",
  "nav": { "title": "页面", "icon": "sparkles", "order": 50 }
}</pre>
    </div>
  `;

  const listHost = main.querySelector('[data-plugin-list]');
  const fileInput = main.querySelector('[data-plugin-file]');

  async function load() {
    listHost.innerHTML = ui.loadingBlock('正在读取插件…');
    try {
      const data = await api.get('/admin/plugins');
      listHost.innerHTML = `
        ${data.items
          .map(
            (plugin) => `
          <article class="plugin-card ${plugin.error ? 'has-error' : ''}">
            <div class="plugin-card-head">
              <div>
                <div class="plugin-card-title">
                  <h3>${ui.escapeHtml(plugin.name)}</h3>
                  <span class="role-chip muted">v${ui.escapeHtml(plugin.version)}</span>
                </div>
                <p>${ui.escapeHtml(plugin.description || '没有描述')}</p>
              </div>
              ${statusPill(plugin.enabled && plugin.loaded, plugin.loaded ? '运行中' : '已启用', '已停用')}
            </div>
            <div class="plugin-card-meta">
              <span>作者：${ui.escapeHtml(plugin.author || '未知')}</span>
              <span>${plugin.hasServer ? '服务端模块' : '纯前端'}</span>
              ${plugin.nav ? `<span>导航：${ui.escapeHtml(plugin.nav.title)}</span>` : ''}
            </div>
            ${
              plugin.routes.length
                ? `<div class="plugin-chips">${plugin.routes
                    .map((route) => `<code>${ui.escapeHtml(route)}</code>`)
                    .join('')}</div>`
                : ''
            }
            ${
              plugin.hooks.length
                ? `<div class="plugin-chips">${plugin.hooks
                    .map((hook) => `<code>on ${ui.escapeHtml(hook)}</code>`)
                    .join('')}</div>`
                : ''
            }
            ${plugin.error ? `<p class="plugin-error">${ui.escapeHtml(plugin.error)}</p>` : ''}
            <div class="plugin-card-actions">
              <button class="btn ${plugin.enabled ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="toggle-plugin" data-id="${plugin.id}" data-enabled="${plugin.enabled}">
                ${icon(plugin.enabled ? 'close' : 'check')}${plugin.enabled ? '停用' : '启用'}
              </button>
              ${
                plugin.enabled
                  ? `<button class="btn btn-ghost btn-sm" data-action="reload-plugin" data-id="${plugin.id}">${icon(
                      'refresh'
                    )}重载</button>`
                  : ''
              }
              ${
                plugin.clientUrl && plugin.nav && plugin.enabled
                  ? `<a class="btn btn-ghost btn-sm" href="#/plugin/${plugin.id}">${icon('external')}打开页面</a>`
                  : ''
              }
              <button class="btn btn-ghost btn-sm danger-text" data-action="delete-plugin" data-id="${plugin.id}">${icon(
                'trash'
              )}卸载</button>
            </div>
          </article>
        `
          )
          .join('')}
        ${data.items.length ? '' : emptyTable('还没有安装插件')}
        ${
          data.scanErrors?.length
            ? `<div class="scan-errors">
                <strong>扫描警告</strong>
                ${data.scanErrors
                  .map(
                    (error) =>
                      `<p><code>${ui.escapeHtml(error.directory)}</code> ${ui.escapeHtml(error.error)}</p>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      `;
    } catch (error) {
      listHost.innerHTML = emptyTable(error.message);
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!/\.(zip|jar)$/i.test(file.name)) {
      ui.toast('请选择 JAR 或 ZIP 插件包', 'error');
      fileInput.value = '';
      return;
    }
    ui.toast('正在安装插件…', 'info');
    try {
      const contentType = file.name.toLowerCase().endsWith('.jar')
        ? 'application/java-archive'
        : 'application/zip';
      await api.upload('/api/admin/plugins/install', file, contentType);
      ui.toast('插件已安装并启用', 'success');
      fileInput.value = '';
      await load();
      await ctx.refreshPlugins();
    } catch (error) {
      ui.toast(error.message, 'error');
      fileInput.value = '';
    }
  });

  main.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'rescan') {
      ui.toast('正在重新扫描插件目录…', 'info');
      try {
        await api.post('/admin/plugins/rescan');
        await load();
        await ctx.refreshPlugins();
        ui.toast('插件目录已重新扫描', 'success');
      } catch (error) {
        ui.toast(error.message, 'error');
      }
      return;
    }
    const id = button.dataset.id;
    if (action === 'toggle-plugin') {
      try {
        await api.post(`/admin/plugins/${id}/${button.dataset.enabled === 'true' ? 'disable' : 'enable'}`);
        ui.toast('插件状态已更新', 'success');
        await load();
        await ctx.refreshPlugins();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    } else if (action === 'reload-plugin') {
      try {
        await api.post(`/admin/plugins/${id}/reload`);
        ui.toast('插件已重载', 'success');
        await load();
        await ctx.refreshPlugins();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    } else if (action === 'delete-plugin') {
      const confirmed = await ui.confirmDialog({
        title: '卸载插件',
        message: '确定卸载这个插件吗？插件目录与配置数据会被删除，且不可撤销。',
        confirmText: '卸载',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/admin/plugins/${id}`);
        ui.toast('插件已卸载', 'success');
        await load();
        await ctx.refreshPlugins();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    }
  });

  await load();
}

async function renderSettings(main, ctx) {
  main.innerHTML = ui.loadingBlock('正在读取站点设置…');
  let data;
  try {
    data = await api.get('/admin/settings');
  } catch (error) {
    main.innerHTML = emptyTable(error.message);
    return;
  }
  const settings = data.settings;
  const yggdrasil = `${location.origin}/api/yggdrasil`;
  const bannerUrls = Array.isArray(data.public?.homeBannerUrls)
    ? data.public.homeBannerUrls
    : data.public?.homeBannerUrl
      ? [data.public.homeBannerUrl]
      : [];

  main.innerHTML = `
    <section class="admin-page-head">
      <div><p class="eyebrow">SETTINGS</p><h2>站点设置</h2><p>修改品牌文案、首页主图、注册开关与联机认证配置。</p></div>
    </section>
    <div class="admin-two-col settings-layout">
      <form class="panel form-stack" data-settings-form>
        <div class="panel-head"><div><p class="eyebrow">BRANDING</p><h3>品牌与文案</h3></div></div>
        <label class="field"><span>站点全名</span><input name="site_name" maxlength="80" value="${ui.escapeHtml(
          settings.site_name
        )}" required /></label>
        <div class="form-grid two">
          <label class="field"><span>简称</span><input name="site_short_name" maxlength="20" value="${ui.escapeHtml(
            settings.site_short_name
          )}" required /></label>
          <label class="field"><span>首页标语</span><input name="tagline" maxlength="60" value="${ui.escapeHtml(
            settings.tagline
          )}" /></label>
        </div>
        <label class="field"><span>站点公告</span><textarea name="announcement" rows="4" maxlength="500">${ui.escapeHtml(
          settings.announcement
        )}</textarea><small class="field-hint">显示在所有页面顶部的公告条，留空则不显示。</small></label>
        <label class="field"><span>页脚文案</span><input name="footer_text" maxlength="120" value="${ui.escapeHtml(
          settings.footer_text
        )}" /></label>
        <div class="form-grid two">
          <label class="field"><span>ICP 备案号</span><input name="icp_number" maxlength="40" value="${ui.escapeHtml(
            settings.icp_number || ''
          )}" placeholder="例如 苏ICP备2026085654号" /></label>
          <label class="field"><span>公安备案号</span><input name="police_number" maxlength="60" value="${ui.escapeHtml(
            settings.police_number || ''
          )}" placeholder="例如 川公网安备xxxxxxxx号" /></label>
        </div>
        <p class="field-hint">显示在页脚，留空则不显示；ICP 备案号会链接到工信部备案查询。</p>
        <div class="panel-head sub"><div><p class="eyebrow">HERO IMAGE</p><h3>首页主图</h3></div></div>
        <div class="banner-manager">
          <div class="banner-list">
            ${
              bannerUrls.length
                ? bannerUrls
                    .map(
                      (url, index) => `
              <div class="banner-thumb">
                <img src="${url}" alt="首页主图 ${index + 1}" />
                <span class="banner-index">#${index + 1}</span>
                <button class="banner-remove" type="button" title="移除这张" data-remove-banner="${url.split('/').pop()}">${icon(
                  'close'
                )}</button>
              </div>`
                    )
                    .join('')
                : `<div class="banner-thumb is-placeholder">
                    <img src="/assets/brand/badge.png" alt="徽章占位" />
                    <span class="banner-index">徽章占位</span>
                  </div>`
            }
          </div>
          <div class="banner-controls">
            <label class="btn btn-ghost upload-button">${icon('upload')}添加图片<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-banner-file /></label>
            ${
              bannerUrls.length
                ? `<button class="btn btn-ghost danger-text" type="button" data-action="clear-banners">${icon('trash')}清空全部</button>`
                : ''
            }
            <p class="field-hint">最多 8 张，推荐 4:3 或 16:10 横图，支持 PNG / JPG / WebP，单张最大 8MB。多张图片会在首页自动循环滚动播放。</p>
          </div>
        </div>
        <div class="panel-head sub"><div><p class="eyebrow">ACCESS</p><h3>访问与联机</h3></div></div>
        <label class="switch-field">
          <span><strong>开放注册</strong><small>关闭后新用户无法注册，已有用户不受影响。</small></span>
          <input type="checkbox" name="registration_open" ${settings.registration_open === '1' ? 'checked' : ''} />
        </label>
        <label class="switch-field">
          <span><strong>启用 Yggdrasil 联机认证</strong><small>关闭后 authlib-injector 无法通过本站认证。</small></span>
          <input type="checkbox" name="yggdrasil_enabled" ${settings.yggdrasil_enabled === '1' ? 'checked' : ''} />
        </label>
        <div class="form-error" data-settings-error hidden></div>
        <button class="btn btn-primary" type="submit">保存站点设置</button>
      </form>
      <div class="panel">
        <div class="panel-head"><div><p class="eyebrow">ENDPOINT</p><h3>联机认证端点</h3></div><span class="type-pill muted">YGGDRASIL</span></div>
        <div class="copy-field"><code>${ui.escapeHtml(yggdrasil)}</code><button class="btn btn-ghost btn-sm" data-action="copy-ygg">${icon(
          'copy'
        )}复制</button></div>
        <ul class="panel-list">
          <li>${icon('check')}认证请求使用用户名/邮箱与密码</li>
          <li>${icon('check')}材质属性由站点 RSA 私钥签名</li>
          <li>${icon('check')}修改设置后立即生效，无需重启</li>
        </ul>
        <div class="panel-divider"></div>
        <h4 class="panel-subtitle">用户数据导出</h4>
        <p class="panel-lead">导出 sysUser、sysRole、sysDept、sysPermission 集合，Long 类型 id 以 int64 字符串输出，密码为 BCrypt，便于迁移到其他用户中心。</p>
        <a class="btn btn-primary btn-block" href="/api/admin/export" download>${icon('download')}导出用户数据</a>
        <div class="panel-divider"></div>
        <h4 class="panel-subtitle">部署提醒</h4>
        <p class="panel-lead">对外地址由环境变量 <code>BASE_URL</code> 决定。部署到公网时请设置为启动器可访问的域名，并确保服务器能访问材质 URL。</p>
      </div>
    </div>
  `;

  main.querySelector('[data-action="copy-ygg"]')?.addEventListener('click', () => {
    ui.copyText(yggdrasil, '认证地址已复制');
  });

  const bannerInput = main.querySelector('[data-banner-file]');
  bannerInput?.addEventListener('change', async () => {
    const file = bannerInput.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      ui.toast('请选择 PNG、JPG 或 WebP 图片', 'error');
      bannerInput.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      ui.toast('图片不能超过 8MB', 'error');
      bannerInput.value = '';
      return;
    }
    ui.toast('正在上传首页主图…', 'info');
    try {
      await api.upload('/admin/settings/banner', file, file.type);
      ui.toast('首页主图已添加', 'success');
      await renderSettings(main, ctx);
      await ctx.refreshSite();
    } catch (error) {
      ui.toast(error.message, 'error');
      bannerInput.value = '';
    }
  });

  main.querySelectorAll('[data-remove-banner]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = await ui.confirmDialog({
        title: '移除这张主图',
        message: '移除后这张图片会从首页轮播中删除，确定继续吗？',
        confirmText: '移除',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.del(`/admin/settings/banner/${encodeURIComponent(button.dataset.removeBanner)}`);
        ui.toast('图片已移除', 'success');
        await renderSettings(main, ctx);
        await ctx.refreshSite();
      } catch (error) {
        ui.toast(error.message, 'error');
      }
    });
  });

  main.querySelector('[data-action="clear-banners"]')?.addEventListener('click', async () => {
    const confirmed = await ui.confirmDialog({
      title: '清空首页主图',
      message: '所有首页主图都会被删除，首页将重新显示社团徽章，确定继续吗？',
      confirmText: '清空',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.del('/admin/settings/banner');
      ui.toast('首页主图已清空', 'success');
      await renderSettings(main, ctx);
      await ctx.refreshSite();
    } catch (error) {
      ui.toast(error.message, 'error');
    }
  });

  const form = main.querySelector('[data-settings-form]');
  const errorBox = main.querySelector('[data-settings-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    ui.setButtonLoading(button, true, '保存中…');
    try {
      await api.put('/admin/settings', {
        site_name: form.elements.site_name.value.trim(),
        site_short_name: form.elements.site_short_name.value.trim(),
        tagline: form.elements.tagline.value.trim(),
        announcement: form.elements.announcement.value.trim(),
        footer_text: form.elements.footer_text.value.trim(),
        icp_number: form.elements.icp_number.value.trim(),
        police_number: form.elements.police_number.value.trim(),
        registration_open: form.elements.registration_open.checked,
        yggdrasil_enabled: form.elements.yggdrasil_enabled.checked,
      });
      ui.setButtonLoading(button, false);
      ui.toast('站点设置已保存', 'success');
      await ctx.refreshSite();
    } catch (error) {
      ui.setButtonLoading(button, false);
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    }
  });
}
