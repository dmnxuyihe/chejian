import { escapeHtml } from './ui.js'

const icons = {
  dashboard:'▦', plan:'▤', schedule:'◫', gantt:'▥', people:'👥', station:'▣', alert:'!',
  resource:'◇', component:'⬡', task:'✓', tune:'↔', quality:'◆', tech:'⌘', worker:'●', list:'≡'
}

export function renderShell({ role, page, pageHtml, selectedWorkerName='' }) {
  const nav = role.nav.map(item => `
    <button class="nav-item ${item.id === page ? 'active':''}" data-nav="${item.id}" data-test="nav-${item.id}">
      <span class="nav-icon">${icons[item.icon] || '•'}</span><span>${escapeHtml(item.label)}</span>
    </button>`).join('')

  const meta = role.id === 'worker' && selectedWorkerName ? selectedWorkerName : role.label
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">智</div>
        <div><div class="brand-title">高级修智能排程</div><div class="brand-subtitle">SCHEDULING · V1</div></div>
      </div>
      <nav class="nav">
        <div class="nav-group-title">${escapeHtml(role.group || '功能')}</div>
        ${nav}
        <div class="notice notice-info" style="margin:18px 6px 0">
          <span>i</span><div>第一版以智能排程为核心，其他功能保持最小可用闭环。</div>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="role-chip">
          <div class="role-avatar">${escapeHtml(role.short)}</div>
          <div class="role-meta"><strong>${escapeHtml(meta)}</strong><span>${escapeHtml(role.label)}</span></div>
          <button class="btn btn-icon btn-sm" data-switch-role title="切换角色">↩</button>
        </div>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="crumb"><span>高级修车间</span><span>›</span><strong>${escapeHtml(role.nav.find(n=>n.id===page)?.label || role.label)}</strong></div>
        <div class="topbar-actions">
          <button class="btn btn-sm" data-switch-role>切换角色</button>
          <button class="btn btn-icon btn-sm" data-theme-toggle title="主题">◐</button>
        </div>
      </header>
      <main class="content" data-test="page-content">${pageHtml}</main>
    </div>
  </div>`
}
