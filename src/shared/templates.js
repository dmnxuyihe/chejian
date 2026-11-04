import { escapeHtml } from '../core/ui.js'
import { headerArt, workspaceArt, artKind, contextIcon } from './workspace-art.js'

export function pageHeader(title, desc, actions='') {
  return `<div class="page-header"><div class="page-heading">${headerArt(title)}<div class="page-heading-copy"><h1>${escapeHtml(title)}</h1>${desc?`<p class="page-desc">${escapeHtml(desc)}</p>`:''}</div></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`
}

export function statCard(label, value, help='', cls='') {
  return `<div class="stat-card"><div class="stat-card-heading"><div class="stat-label">${escapeHtml(label)}</div><span class="stat-card-icon">${contextIcon(label,19)}</span></div><div class="stat-value ${cls}">${value}</div><div class="stat-help">${escapeHtml(help)}</div></div>`
}

export function emptyState(title='暂无数据', desc='当前没有需要处理的内容。') {
  return `<div class="empty illustrated-empty">${workspaceArt(artKind(title+' '+desc))}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(desc)}</span></div>`
}
