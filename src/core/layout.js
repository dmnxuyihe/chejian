import { escapeHtml } from './ui.js'

const icons = {
  dashboard:'▦', plan:'▤', schedule:'◫', gantt:'▥', people:'👥', station:'▣', alert:'!',
  resource:'◇', component:'⬡', task:'✓', tune:'↔', quality:'◆', tech:'⌘', worker:'●', list:'≡'
}

export function renderShell({ role, page, pageHtml, selectedWorkerName='' }) {
  let currentSection = ''
  const nav = role.nav.map(item => {
    const section = item.section && item.section !== currentSection ? `<div class="nav-group-title">${escapeHtml(item.section)}</div>` : ''
    currentSection = item.section || currentSection
    return `${section}
    <button class="nav-item ${item.id === page ? 'active':''}" data-nav="${item.id}" data-test="nav-${item.id}">
      <span class="nav-icon">${icons[item.icon] || '•'}</span><span>${escapeHtml(item.label)}</span>${item.status === 'planned' ? '<span class="nav-status">待</span>' : ''}
    </button>`
  }).join('')

  const meta = role.id === 'worker' && selectedWorkerName ? selectedWorkerName : role.label
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">智</div>
        <div><div class="brand-title">高级修智能排程</div><div class="brand-subtitle">SCHEDULING · V1</div></div>
      </div>
      <nav class="nav">
        ${nav}
        <div class="notice notice-info" style="margin:18px 6px 0">
          <span>i</span><div>第一阶段完成角色与导航接入；标记“待”的业务将在对应角色阶段开发。</div>
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
