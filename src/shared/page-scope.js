import { escapeHtml as esc } from '../core/ui.js'
import { workspaceArt, artKind, contextIcon } from './workspace-art.js'

// Function names come from the role catalog, not invented execution statuses.
export function pageScope(section, labels, current) {
  return `<section class="card scope-panel" aria-label="${esc(section)}功能范围"><div class="scope-panel-heading"><span class="scope-section-icon">${contextIcon(section,20)}</span><div><h2>${esc(section)}</h2><p>本组功能范围 · 当前查看 ${esc(current)}</p></div></div><ol class="scope-map">${labels.map((label,index)=>`<li class="${label===current?'is-current':''}"><span class="scope-map-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div>${workspaceArt(artKind(label))}<span>${esc(label)}</span>${label===current?'<small>当前页面</small>':''}</div></li>`).join('')}</ol></section>`
}
