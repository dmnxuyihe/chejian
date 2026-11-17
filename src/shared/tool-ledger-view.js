import {escapeHtml as esc} from '../core/ui.js'
import {toolDateTime} from './tool-dates.js'
import {reconcileToolSelection} from './tool-table-state.js'
import {recordKinds} from './tool-records.js'

const nextKeys=['return','transfer-finish','service-finish','disposal-review']
const maintenanceKeys=['edit','asset-config','delete','check-use']
export function renderLedgerView(ctx,v,{toolTableData,filterToolTable,toolActionOptions,tableColumns,headerFilter,selectionSummary,compactState}){
 v.scanMode=false;v.borrowType='';v.serviceQuery=''
 if(['送检 / 送修','待审核','停用'].includes(v.queryStatus))v.queryStatus=''
 if(v.queryDraft&&['送检 / 送修','待审核','停用'].includes(v.queryDraft.queryStatus))v.queryDraft.queryStatus=''
 v.columnFilters=Object.fromEntries(Object.entries(v.columnFilters||{}).filter(([key])=>tableColumns.slice(0,9).some(([id])=>id===key)))
 const all=toolTableData(ctx.state),legacy=all.filter(e=>e.type==='LEGACY'),managed=all.filter(e=>e.type!=='LEGACY')
 if(v.queryStatus==='待完善登记')v.ledgerScope='legacy'
 v.ledgerScope||='registered'
 const rows=filterToolTable(all,v),columns=tableColumns.slice(0,9)
 reconcileToolSelection(all,v)
 const selected=all.filter(e=>v.selectedKeys.includes(e.key)),options=toolActionOptions(ctx.state,selected),enabled=options.filter(o=>o.enabled)
 const next=enabled.filter(o=>nextKeys.includes(o.key)),business=enabled.filter(o=>!nextKeys.includes(o.key)&&!maintenanceKeys.includes(o.key)&&o.key!=='details'),maintenance=enabled.filter(o=>maintenanceKeys.includes(o.key)),blocked=options.filter(o=>!o.enabled)
 const button=(key,title,primary=false,disabled=false,reason='')=>`<button type="button" class="btn ${primary?'btn-primary':''} ${key==='delete'?'tool-delete-action':''}" ${primary&&selected.length?'data-tool-next-action':''} data-tool-table-action="${key}" ${disabled?`disabled title="${esc(reason)}"`:''}>${esc(title)}</button>`
 const group=(title,items,primary=false)=>items.length?`<div class="tool-command-group" ${title==='资料维护'?'data-command-group="maintenance"':''}><span>${title}</span><div class="tool-bottom-buttons">${items.map((o,i)=>button(o.key,o.key==='edit'?'修改资料':o.title,primary&&i===0)).join('')}</div></div>`:''
 const chips=Object.entries(v.columnFilters||{}).map(([key,values])=>`<button type="button" class="tool-filter-chip" data-tool-filter-remove="${esc(key)}">${esc(tableColumns.find(([id])=>id===key)?.[1]||key)}：${esc(values.join('、'))} ×</button>`).join('')
 const context=[v.exactAssetId?'指定工具：'+(all.find(e=>e.asset?.id===Number(v.exactAssetId))?.code||'已不存在'):'',Array.isArray(v.assetIds)?`指定 ${v.assetIds.length} 项工具`:'',v.toolId?'工具品种：'+(ctx.state.tools.find(t=>t.id===Number(v.toolId))?.name||v.toolId):'',v.availableOnly?'仅可领用':'',v.serviceOnly?'送检 / 送修':'',v.excludeKits?'不重复计套装':''].filter(Boolean).join(' · ')
 const receipt=v.lastReceipt?`<div class="tool-receipt" role="status"><span>${esc(v.lastReceipt.title)} · ${esc(v.lastReceipt.actor)} · ${toolDateTime(v.lastReceipt.at)}</span>${v.lastReceipt.groups?.length>1?v.lastReceipt.groups.map((g,i)=>`<button type="button" class="text-action" data-tool-receipt-group="${i}">查看${recordKinds[g.kind]}</button>`).join(''):'<button type="button" class="text-action" data-tool-table-action="receipt">查看本次记录</button>'}</div>`:''
 return `<div class="tool-workspace tool-table-workspace tool-compact-ledger tool-simple-ledger" data-tool-workspace>
 <h1>工具台账</h1>
 <form class="tool-query-bar tool-ledger-query" data-tool-query>
 <label class="tool-field"><span>名称 / 编号 / 条形码</span><input class="input" type="search" name="query" value="${esc(v.query||'')}" placeholder="查找工具"></label>
 <label class="tool-field"><span>工具库</span><select class="select" name="warehouse"><option value="">全部工具库</option>${ctx.state.toolManagement.warehouses.map(w=>`<option value="${w.id}" ${String(v.warehouse)===String(w.id)?'selected':''}>${esc(w.name)}</option>`).join('')}</select></label>
 <label class="tool-field"><span>当前状态</span><select class="select" name="queryStatus">${[['','全部状态'],['在库','在库'],['借出','借出'],['送检','送检'],['送修','送修'],['调拨中','调拨'],['已报废','报废'],['已遗失','遗失'],['待完善登记','待登']].map(([value,label])=>`<option value="${value}" ${v.queryStatus===value?'selected':''}>${label}</option>`).join('')}</select></label>
 <button class="btn btn-primary" type="submit">查询</button><button class="btn" type="button" data-tool-reset-query>重置</button></form>
 <section class="tool-ledger-list" aria-label="工具列表"><div class="tool-list-caption tool-ledger-scope" aria-label="登记范围">
 <div>${[['registered','已登记工具',managed.length],['legacy','待完善登记',legacy.length]].map(([key,title,n])=>`<button type="button" data-tool-ledger-scope="${key}" aria-pressed="${v.ledgerScope===key}" class="${v.ledgerScope===key?'active':''}">${title}<small>${n}</small></button>`).join('')}</div><span>当前 ${rows.length} 项</span></div>
 ${chips||context?`<div class="tool-filter-chips">${chips}${context?`<button type="button" class="tool-filter-chip" data-tool-context-clear>${esc(context)} ×</button>`:''}</div>`:''}
 <div class="tool-table-scroll" data-tool-results><table class="tool-master-table"><thead><tr><th class="tool-check-column"><input type="checkbox" data-tool-select-all aria-label="全选当前筛选结果" ${rows.length&&rows.every(e=>v.selectedKeys.includes(e.key))?'checked':''}></th>${columns.map(([key,label])=>headerFilter(key,label,all.filter(e=>v.ledgerScope==='legacy'?e.type==='LEGACY':e.type!=='LEGACY'),v)).join('')}</tr></thead><tbody>${rows.map(e=>`<tr data-tool-row="${e.key}" class="${v.selectedKeys.includes(e.key)?'is-selected':''} ${v.exactAssetId&&e.asset?.id===Number(v.exactAssetId)?'is-located':''}"><td class="tool-check-column"><input type="checkbox" data-tool-check="${e.key}" aria-label="选择${esc(e.code)}" ${v.selectedKeys.includes(e.key)?'checked':''}></td>${columns.map(([key])=>`<td class="${key==='state'?'tool-table-state':''}">${['title','code'].includes(key)?`<button type="button" class="tool-name-select" data-tool-detail="${e.key}" aria-label="查看${esc(e.values[key])}档案">${esc(e.values[key])}</button>`:key==='state'?`<span class="tool-state">${esc(compactState(e))}</span>`:esc(e.values[key])}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="10" class="empty">${v.ledgerScope==='legacy'&&!legacy.length?'没有待完善登记的库存':'没有符合查询条件的工具'}</td></tr>`}</tbody></table></div></section>
 <section class="tool-ledger-command ${selected.length?'has-selection':''}" data-tool-bottom aria-label="所选工具与操作">
 ${selected.length?`<div data-tool-selection-summary>${selectionSummary(all,v)}</div>`:''}
 <div class="tool-business-actions"><strong>工具管理</strong><div class="tool-bottom-buttons">${options.filter(o=>!maintenanceKeys.includes(o.key)&&o.key!=='details').map((o,i)=>button(o.key,o.title,i===0&&o.enabled,!o.enabled,o.reason)).join('')}</div></div>
 <div class="tool-command-utilities">${group('资料维护',maintenance)}<div class="tool-workspace-commands">${button('asset-new','新增工具',!selected.length)}${button('export',selected.length?'导出所选工具':'导出当前列表')}</div></div>
 </section><p class="pc-help" role="status" data-query-pending hidden>查询条件尚未应用，请点击查询。</p>${selected.length&&blocked.length?`<details class="tool-unavailable"><summary>查看不可办理原因（${blocked.length}项）</summary>${blocked.map(o=>`<p data-tool-operation-reason><b>${esc(o.title)}：</b>${esc(o.reason)}</p>`).join('')}</details>`:''}${receipt}</div>`
}
