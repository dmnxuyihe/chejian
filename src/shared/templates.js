import { escapeHtml } from '../core/ui.js'

export function pageHeader(title, desc, actions='') {
  return `<div class="page-header"><div><div class="page-kicker">高级修车间 · 第一版</div><h1>${escapeHtml(title)}</h1><p class="page-desc">${escapeHtml(desc)}</p></div><div class="page-actions">${actions}</div></div>`
}

export function statCard(label, value, help='', cls='') {
  return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value ${cls}">${value}</div><div class="stat-help">${escapeHtml(help)}</div></div>`
}

export function emptyState(title='暂无数据', desc='当前没有需要处理的内容。') {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(desc)}</span></div>`
}
