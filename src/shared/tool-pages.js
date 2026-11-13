import {toolDateTime,toolDateInput} from './tool-dates.js'
import {escapeHtml as esc} from '../core/ui.js'
import {renderToolTableWorkspace,renderCompactToolLedger} from './tool-table.js'
import {renderToolDashboard,renderToolWarnings} from './tool-overview.js'

const action=(key,label,disabled=false)=>`<button type="button" class="btn ${key==='count-new'?'btn-primary':''}" data-tool-table-action="${key}" ${disabled?'disabled title="请先选择一张盘点单"':''}>${label}</button>`
const when=value=>esc(toolDateTime(value))
export function renderToolPage(ctx,v){
 if(v.pageMode==='dashboard')return renderToolDashboard(ctx)
 if(v.pageMode==='warnings')return renderToolWarnings(ctx,v)
 if(v.pageMode==='ledger')return renderCompactToolLedger(ctx,v)
 if(v.pageMode==='records')return '<div class="tool-workspace tool-subpage"><h1>业务记录</h1><section data-tool-records-page></section></div>'
 if(v.pageMode==='data')return '<div class="tool-workspace tool-subpage"><h1>工具资料</h1><section data-tool-data-page></section></div>'
 if(v.pageMode!=='inventory'||v.countId)return renderToolTableWorkspace(ctx,v)
 const m=ctx.state.toolManagement,counts=m.counts.slice().reverse()
 return `<div class="tool-workspace tool-subpage" data-tool-workspace><h1>工具盘点</h1><p class="pc-help">选择工具库开始清点，或选中已有盘点单继续清点、查看及导出结果。</p><div class="table-wrap tool-count-list"><table class="tool-master-table"><thead><tr><th>选择</th><th>盘点单号</th><th>工具库</th><th>状态</th><th>应有 / 实际数量</th><th>经办人</th><th>创建时间</th><th>完成时间</th></tr></thead><tbody>${counts.map(c=>`<tr><td><input type="radio" name="tool-count" data-tool-count-select value="${c.id}" aria-label="选择盘点单${c.id}" ${Number(v.inventorySelected)===c.id?'checked':''}></td><td>#${c.id}</td><td>${esc(m.warehouses.find(w=>w.id===c.warehouseId)?.name||'—')}</td><td>${c.status==='OPEN'?'盘点中':c.status==='CLOSED'?'清点完成':'已取消'}</td><td>${c.lines.reduce((n,l)=>n+l.expected,0)} / ${c.status==='CLOSED'?c.lines.reduce((n,l)=>n+l.counted,0):'待确认'}</td><td>${esc(c.confirmedBy||c.actor||'—')}</td><td>${when(c.at)}</td><td>${when(c.finishedAt)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">暂无盘点记录，点击下方“开始盘点”。</td></tr>'}</tbody></table></div><div class="tool-bottom-panel tool-count-list-actions"><p class="pc-help" data-count-open-hint>${v.inventorySelected?`已选择盘点单 #${v.inventorySelected}`:'先选择一张盘点单，再打开查看。'}</p><div class="tool-bottom-buttons">${action('count-new','开始盘点')}${action('count-open-selected','打开所选盘点',!counts.some(c=>c.id===Number(v.inventorySelected)))}</div></div></div>`
}
