import { api } from '../api.js';
import { icon } from '../icons.js';
import { drawCapePreview, drawSkinCard } from '../skin2d.js';
import * as ui from '../ui.js';

export async function render(root, ctx) {
  const pluginId = ctx.path.replace(/^\/plugin\//, '').split('/')[0];
  let plugin = ctx.plugins.find((item) => item.id === pluginId);

  if (!plugin) {
    await ctx.refreshPlugins();
    plugin = ctx.state.plugins.find((item) => item.id === pluginId);
  }

  if (!plugin) {
    root.innerHTML = `
      <section class="notfound">
        <span class="notfound-code">404</span>
        <h1>插件不在这里</h1>
        <p>它可能被卸载、停用，或者还在星尘里旅行。</p>
        <a class="btn btn-primary" href="#/">回到首页</a>
      </section>
    `;
    return;
  }

  const embedded = Boolean(ctx.adminEmbed);
  document.title = `${plugin.name} · ${embedded ? '管理后台' : ctx.settings.site_short_name || '星空社'}`;

  root.innerHTML = `
    <div class="plugin-host">
      ${embedded ? '' : `<nav class="plugin-breadcrumb" aria-label="面包屑">
        <a href="#/">首页</a>
        ${icon('chevron')}
        <span>${ui.escapeHtml(plugin.name)}</span>
        <span class="plugin-version">v${ui.escapeHtml(plugin.version)}</span>
      </nav>`}
      <div data-plugin-root>${ui.loadingBlock(`正在加载插件 ${plugin.name}…`)}</div>
    </div>
  `;

  const host = root.querySelector('[data-plugin-root]');

  if (!plugin.clientUrl) {
    host.innerHTML = `
      <section class="plugin-info panel">
        <div class="panel-head">
          <div><p class="eyebrow">PLUGIN</p><h2>${ui.escapeHtml(plugin.name)}</h2></div>
          <span class="type-pill muted">无前端页面</span>
        </div>
        <p class="panel-lead">${ui.escapeHtml(plugin.description || '这个插件没有提供可访问的页面。')}</p>
        <dl class="detail-meta">
          <div><dt>版本</dt><dd>${ui.escapeHtml(plugin.version)}</dd></div>
          <div><dt>作者</dt><dd>${ui.escapeHtml(plugin.author || '未知')}</dd></div>
        </dl>
      </section>
    `;
    return;
  }

  try {
    const url = `${plugin.clientUrl}?v=${encodeURIComponent(plugin.version)}`;
    const module = await import(url);
    if (typeof module.mount !== 'function') {
      throw new Error('插件前端模块必须导出 mount(root, ctx)');
    }
    host.innerHTML = '';
    const pluginCtx = {
      api,
      user: ctx.user,
      settings: ctx.settings,
      plugin,
      navigate: ctx.navigate,
      toast: ui.toast,
      confirm: ui.confirmDialog,
      escapeHtml: ui.escapeHtml,
      formatDate: ui.formatDate,
      timeAgo: ui.timeAgo,
      icon,
      ui,
      skinPreview: { drawSkinCard, drawCapePreview },
    };
    const cleanup = await module.mount(host, pluginCtx);
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  } catch (error) {
    console.error(error);
    host.innerHTML = `
      <section class="page-error">
        <span class="empty-icon">${icon('plugin')}</span>
        <h1>插件页面加载失败</h1>
        <p>${ui.escapeHtml(error.message || '未知错误')}</p>
        <button class="btn btn-primary" data-action="retry">重新加载</button>
      </section>
    `;
    host.querySelector('[data-action="retry"]')?.addEventListener('click', () => render(root, ctx));
  }
}
