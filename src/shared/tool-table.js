import {escapeHtml as esc} from '../core/ui.js'
import {toolAlerts,assetBusinessHistory,countLossRemaining} from '../core/tool-management.js'
import {toolLedgerEntries,ledgerTypes,assetBalance,returnableQuantity} from './tool-ledger.js'
import {countDrafts} from './tool-table-state.js'
import {recordKinds} from './tool-records.js'

const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const dt=v=>v?String(v).replace('T',' ').slice(0,16):'未登记'
const action=(key,label,disabled=false)=>`<button type="button" class="btn" data-tool-table-action="${key}" ${disabled?'disabled':''}>${label}</button>`
const operationGroup=(id,title,buttons)=>buttons?`<section class="tool-operation-group" data-tool-operation-group="${id}" aria-label="${title}"><h3>${title}</h3><div class="tool-bottom-buttons">${buttons}</div>${id==='selection'?'<p class="tool-action-scroll-hint">左右滑动可查看全部办理动作</p>':''}</section>`:''
const coreActions=[['borrow','借出'],['return','归还'],['transfer','调拨'],['inspection','送检'],['repair','送修'],['lost','遗失申请'],['scrap','报废申请']]
const followupActions=['disposal-review','service-finish','transfer-finish','return']
const stateMarkup=e=>(e.balance?.states||[e.values.state]).map(value=>{
 const tone=/已报废|已遗失|盘亏|到期|未登记合格/.test(value)?'error':/待审核|调拨中|送检|送修|借出/.test(value)?'pending':/停用|暂停|无库存|待完善/.test(value)?'disabled':'available'
 return `<span class="tool-state is-${tone}">${esc(value)}</span>`
}).join('')
export function toolActionOptions(s,selected){
 const enabled=selectedToolActions(s,selected),keys=new Set(enabled.map(([key])=>key))
 const next=enabled.filter(([key])=>followupActions.includes(key)&&key!=='return')
 const actions=!selected.length?coreActions:selected.every(e=>e.type==='LEGACY')?[...enabled,...coreActions]:[...next,...coreActions,...enabled.filter(([key])=>!coreActions.some(([k])=>k===key)&&!next.some(([k])=>k===key))]
 return actions.map(([key,title])=>{
  const unavailable=selected.filter(e=>!selectedToolActions(s,[e]).some(([k])=>k===key))
  const messages={borrow:'没有可领用数量或受检定/停用限制',return:'没有可归还的未还数量',transfer:'无可调拨数量，或属于套装成员',inspection:'没有可送检的在库数量',repair:'没有可送修的在库数量',lost:'在库或未还数量不足，或已提交申请',scrap:'没有可报废的在库数量'}
  const reason=keys.has(key)?'':!selected.length?'请先勾选左侧工具':unavailable.map(e=>`${e.code}：${e.type==='LEGACY'?'请先完善登记':e.kit&&key!=='borrow'&&key!=='return'?'请选择套装的具体成员':key==='transfer'&&s.toolManagement.kits.some(k=>k.lines.some(l=>l.assetId===e.id))?'属于套装成员，请先在工具资料中调整套装组成，再办理调拨':`${messages[key]||'当前状态不适用'}（${e.values?.state||'—'}）`}`).join('；')||'所选项不满足同一批办理条件'
  return {key,title,enabled:keys.has(key),reason}
 })
}
export function selectedToolActions(s,selected){
 if(!selected.length)return []
 const m=s.toolManagement,allAssets=selected.every(e=>e.asset),allManaged=selected.every(e=>e.type!=='LEGACY')
 const selectedIds=new Set(selected.flatMap(e=>e.asset?[e.id]:e.kit?.lines.map(l=>l.assetId)||[])),result=[]
 const add=(condition,key,title)=>{if(condition)result.push([key,title])}
 const free=allAssets&&selected.every(e=>(e.balance.physicalAvailable??e.balance.stock)>0)
 const returnable=allManaged&&m.loans.some(l=>l.status==='OPEN'&&l.lines.some(line=>selectedIds.has(line.assetId)&&returnableQuantity(m,l,line)>0))
 add(allManaged&&selected.every(e=>e.asset?e.balance.available>0:e.available>0),'borrow','借出')
 add(returnable,'return','归还')
 add(free&&selected.every(e=>e.balance.available>0&&!m.kits.some(k=>k.lines.some(l=>l.assetId===e.id))),'transfer','调拨')
 add(allManaged&&m.transfers.some(r=>selectedIds.has(r.assetId)&&r.status==='PENDING'),'transfer-finish','接收调拨')
 add(free,'inspection','送检');add(free,'repair','送修')
 add(allManaged&&m.services.some(r=>selectedIds.has(r.assetId)&&r.status==='OPEN'),'service-finish','登记检修结果')
 add(allAssets&&selected.every(e=>(e.balance.physicalAvailable??e.balance.stock)>0||e.balance.loans.some(l=>l.lines.some(line=>line.assetId===e.id&&returnableQuantity(m,l,line)>0))),'lost','遗失申请')
 add(free,'scrap','报废申请')
 add(allManaged&&m.disposals.some(r=>selectedIds.has(r.assetId)&&r.status==='PENDING'),'disposal-review','审核申请')
 add(selected.every(e=>e.type==='LEGACY'),'adopt','完善登记')
 add(selected.length===1||allAssets,'edit','修改')
 add(selected.length===1,'details','详情与记录')
 const deletable=selected.every(e=>e.kit?!m.loans.some(l=>l.kitId===e.id):e.asset&&!e.asset.parentAssetId&&!e.asset.sourceRecordIds&&!m.kits.some(k=>k.lines.some(l=>l.assetId===e.id))&&!m.loans.some(l=>l.lines.some(r=>r.assetId===e.id))&&!['services','transfers','disposals','counts','events'].some(key=>m[key].some(r=>r.assetId===e.id||r.resultingAssetId===e.id||r.lines?.some(l=>l.assetId===e.id))))
 add(deletable,'delete','删除')
 return result
}
export const tableColumns=[['title','工具名称'],['code','编号'],['type','台账类型'],['warehouse','工具库'],['tag','条形码 / RFID'],['quantity','账面数量'],['available','可领用数量'],['state','当前状态'],['receivedAt','入库时间'],['lastRepairAt','最后检修时间'],['inspectionAt','最近检定时间'],['due','检定有效期'],['provider','送检 / 送修单位'],['warning','预警信息']]
export function toolTableData(s){
  return toolLedgerEntries(s).entries.map(e=>{
    const a=e.asset,m=s.toolManagement,b=e.balance
    const audits=a?m.audit.filter(r=>['ASSET_CREATE','ADOPT_LEGACY'].includes(r.action)&&(()=>{try{const p=JSON.parse(r.detail);return Number(p.toolId)===a.toolId&&p.code===a.code}catch{return false}})()):[]
    const services=a?assetBusinessHistory(m,a.id,'services'):[]
    const lastRepair=a?.lastRepairAt||services.filter(r=>r.kind==='REPAIR'&&r.finishedAt).at(-1)?.finishedAt
    const active=services.filter(r=>r.status==='OPEN')
    const state=e.type==='LEGACY'?'待完善登记':e.kit?`${e.available} 套可借出 · ${e.loans.length} 单未还`:b.states.join(' · ')
    return {...e,serviceSearch:services.map(r=>`${r.kind==='INSPECTION'?'送检':'送修'} ${r.status==='OPEN'?'办理中':'已完成'} ${r.provider} ${r.certificate||''}`).join(' '),values:{title:e.title,code:e.code,type:ledgerTypes[e.type],warehouse:name(m.warehouses,e.warehouseId),tag:a?.tag||'未绑定',quantity:String(a?.quantity??e.tool?.quantity??e.members?.length??0),available:e.type==='LEGACY'?'待登记':String(b?.available??e.available??0),state,receivedAt:dt(a?.receivedAt||audits[0]?.at),lastRepairAt:dt(lastRepair),inspectionAt:dt(a?.lastInspectionAt),due:b?.due==='MISSING'?'未登记':b?.due?b.due.slice(0,10):a?'无需定检':'—',provider:active.map(r=>r.provider).join('、')||services.at(-1)?.provider||'—',warning:e.warnings.join('；')||'—'}}
  })
}
export function filterToolTable(rows,v){
  const q=(v.query||'').toLocaleLowerCase()
  const result=rows.filter(e=>(!q||Object.values(e.values).join(' ').toLocaleLowerCase().includes(q))&&(!v.warehouse||String(e.warehouseId)===String(v.warehouse))&&(!v.queryStatus||(v.queryStatus==='送检 / 送修'?e.balance?.inspection>0||e.balance?.repair>0:e.values.state.includes(v.queryStatus)))&&(!v.borrowType||(e.balance?.loans||e.loans||[]).some(l=>l.borrowType===v.borrowType))&&(!v.serviceQuery||e.values.provider.includes(v.serviceQuery)||sawService(e,v.serviceQuery))&&Object.entries(v.columnFilters||{}).every(([key,values])=>!Array.isArray(values)||values.includes(e.values[key])))
  if(tableColumns.some(([key])=>key===v.sortKey))result.sort((a,b)=>a.values[v.sortKey].localeCompare(b.values[v.sortKey],'zh-CN',{numeric:true})*(v.sortDirection==='desc'?-1:1))
  return result
}
const sawService=(e,q)=>e.serviceSearch?.includes(q)
function headerFilter(key,label,all,v){
  const values=[...new Set(all.map(e=>e.values[key]))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}))
  const selected=v.columnFilters?.[key]
  return `<th scope="col" aria-sort="${v.sortKey===key?v.sortDirection==='desc'?'descending':'ascending':'none'}"><div class="tool-column-controls"><button type="button" data-tool-sort="${key}" aria-label="按${label}排序">${label}<span aria-hidden="true">${v.sortKey===key?v.sortDirection==='desc'?' ↓':' ↑':''}</span></button><button type="button" class="tool-column-trigger ${selected?'is-filtered':''}" data-tool-filter-open="${key}" aria-label="筛选${label}" aria-expanded="false">${selected?'●':'▾'}</button></div></th>`
}
function selectionSummary(rows,v){
  const selected=rows.filter(e=>v.selectedKeys.includes(e.key))
  const hidden=selected.filter(e=>!filterToolTable([e],v).length).length
  if(!selected.length)return '<p class="tool-selected-empty" id="tool-selection-help">先勾选列表左侧的工具，再点击下方借出、归还、调拨、送检或送修。可多选。</p>'
  return `<div class="tool-selection-heading"><div><strong>已选 ${selected.length} 项</strong>${hidden?`<small class="tool-selection-hidden" data-tool-hidden-selection>其中 ${hidden} 项不在当前筛选结果内，仍将一起办理</small>`:''}</div><button class="text-action" data-tool-clear-selection>清空选择</button></div><ul class="tool-selection-chips" aria-label="当前选中的工具">${selected.map(e=>`<li><span><strong>${esc(e.title)}</strong> · ${esc(e.code)}<small>${esc(e.values.state)}</small></span><button type="button" data-tool-remove-selection="${e.key}" aria-label="取消选择${esc(e.code)}">×</button></li>`).join('')}</ul>`
}
export function renderToolTableWorkspace(ctx,v){
  const s=ctx.state,m=s.toolManagement,all=toolTableData(s),rows=filterToolTable(all,v)
  v.selectedKeys=(v.selectedKeys||[]).filter(key=>all.some(e=>e.key===key))
  const selected=all.filter(e=>v.selectedKeys.includes(e.key)),noSelection=!selected.length
  const options=toolActionOptions(s,selected)
  const nextAction=followupActions.find(key=>options.some(o=>o.key===key&&o.enabled))||options.find(o=>o.enabled&&['adopt','borrow'].includes(o.key))?.key
  const selectedOperations=operationGroup('selection','办理所选工具',options.map(({key,title,enabled,reason})=>`<button type="button" class="btn ${key===nextAction?'btn-primary':''}" ${key===nextAction?'data-tool-next-action':''} data-tool-table-action="${key}" ${!enabled?`disabled title="${esc(reason)}" aria-describedby="${noSelection?'tool-selection-help':`tool-reason-${key}`}"`:''}>${title}</button>`).join(''))
  const reasons=noSelection?'':options.filter(o=>!o.enabled).map(o=>`<span id="tool-reason-${o.key}" data-tool-operation-reason><b>${o.title}不可办理：</b>${esc(o.reason)}</span>`).join('')
  const operations=operationGroup('workspace','工具管理',action('asset-new','新增工具')+action('export',noSelection?'导出筛选结果':'导出所选工具'))
  const balances=m.assets.map(a=>assetBalance(s,a))
  const legacyQuantity=all.filter(e=>e.type==='LEGACY').reduce((n,e)=>n+Number(e.tool.quantity),0)
  const stats=[['工具总量',m.assets.reduce((n,a)=>n+a.quantity,0)+legacyQuantity,'件',''],['在库',balances.reduce((n,b)=>n+b.stock,0),'件',''],['借出',balances.reduce((n,b)=>n+b.borrowed,0),'件','borrowed'],['送检 / 送修',balances.reduce((n,b)=>n+b.inspection+b.repair,0),'件','service'],['待审核申请',m.disposals.filter(r=>r.status==='PENDING').length,'单','pending'],['待完善登记',legacyQuantity,'件','legacy'],['预警',toolAlerts(s).length,'项','warning']]
  const count=v.countId?m.counts.find(c=>c.id===v.countId):null
  if(count)countDrafts(v,count)
  const countRows=count?count.lines.map(line=>{const e=all.find(e=>e.asset?.id===line.assetId);return {line,e}}):[]
  const checkedCount=count?countRows.filter(({line})=>v.countDraft?.[line.assetId]?.present).length:0
  const countHelp=count?.status==='OPEN'?`应有 ${count.lines.reduce((n,l)=>n+l.expected,0)} 件；已核对 ${countRows.filter(({line})=>v.countDraft?.[line.assetId]?v.countDraft[line.assetId].verified:line.counted!=null).length} / ${count.lines.length} 项。勾选表示实际找到；需要确认未找到时，在状态列明确标记。${v.countSavePending?'正在保存进度…':'进度会自动保存。'}`:count?.status==='CLOSED'?`应有 ${count.lines.reduce((n,l)=>n+l.expected,0)} 件；实盘 ${count.lines.reduce((n,l)=>n+l.counted,0)} 件。此记录已确认，不能修改。`:'本次盘点已取消，未确认实际数量，未调整库存。'
  const body=count?`<section class="tool-count-banner"><div><strong>盘点 ${name(m.warehouses,count.warehouseId)} · 单号 #${count.id}</strong><p>${esc(countHelp)}</p><p role="status" aria-live="polite" data-count-save-status></p></div><span>${count.status==='CLOSED'?'已完成':count.status==='CANCELLED'?'已取消':'盘点中'}</span></section><div class="tool-table-scroll"><table class="tool-master-table"><thead><tr><th class="tool-check-column">实际找到</th><th>工具名称</th><th>编号</th><th>条形码 / RFID</th><th>应有数量</th><th>实际数量</th><th>核对状态</th></tr></thead><tbody>${countRows.map(({line,e})=>{const draft=v.countDraft?.[line.assetId]||{verified:line.counted!==null,present:Number(line.counted)>0,counted:line.counted??0};const status=count.status==='CLOSED'?(line.counted===line.expected?'账实一致':`差异 ${line.counted-line.expected}`):count.status==='CANCELLED'?'已取消，未确认实盘':draft.verified?(draft.present?'已找到':'已核对未找到'):'未核对';return `<tr class="${draft.present?'is-selected':''}"><td class="tool-check-column"><input type="checkbox" data-count-present="${line.assetId}" aria-label="${esc(e?.code)}实际找到" ${draft.present?'checked':''} ${count.status!=='OPEN'?'disabled':''}></td><td>${esc(e?.title||'—')}</td><td>${esc(e?.code||'—')}</td><td>${esc(e?.values.tag||'—')}</td><td>${line.expected}</td><td><input class="input" type="number" min="0" step="1" ${e?.asset?.mode==='NUMBERED'?'max="1"':''} data-count-actual="${line.assetId}" aria-label="${esc(e?.code)}实际数量" value="${count.status==='CANCELLED'?'':count.status==='CLOSED'?line.counted:draft.counted??''}" ${!draft.verified||count.status!=='OPEN'?'disabled':''}></td><td><select class="select tool-count-status" data-count-verified="${line.assetId}" aria-label="${esc(e?.code)}核对状态" ${count.status!=='OPEN'?'disabled':''}><option value="UNVERIFIED" ${!draft.verified?'selected':''}>未核对</option><option value="FOUND" ${draft.verified&&draft.present?'selected':''}>已找到</option><option value="MISSING" ${draft.verified&&!draft.present?'selected':''}>已核对未找到</option></select><span class="tool-count-status-text">${esc(status)}</span></td></tr>`}).join('')}</tbody></table></div>`:`<div class="tool-table-heading"><h2>工具台账 <small>${rows.length} 项</small></h2><p>勾选左侧工具，在下方办理；横向滚动可查看完整资料，点击名称查看档案。</p></div><div class="tool-table-scroll" data-tool-results><table class="tool-master-table"><thead><tr><th class="tool-check-column"><input type="checkbox" data-tool-select-all aria-label="全选当前筛选结果" ${rows.length&&rows.every(e=>v.selectedKeys.includes(e.key))?'checked':''}></th>${tableColumns.map(([key,label])=>headerFilter(key,label,all,v)).join('')}</tr></thead><tbody>${rows.map(e=>`<tr data-tool-row="${e.key}" class="${v.selectedKeys.includes(e.key)?'is-selected':''}"><td class="tool-check-column"><input type="checkbox" data-tool-check="${e.key}" aria-label="选择${esc(e.code)}" ${v.selectedKeys.includes(e.key)?'checked':''}></td>${tableColumns.map(([key])=>`<td ${key==='state'?'class="tool-table-state"':''}>${key==='title'?`<button type="button" class="tool-name-select" data-tool-detail="${e.key}" aria-label="查看${esc(e.values[key])}详情">${esc(e.values[key])}</button>`:key==='state'?stateMarkup(e):esc(e.values[key])}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${tableColumns.length+1}" class="empty">没有符合查询条件的工具</td></tr>`}</tbody></table></div>`
  const queryForm=count?'':`<form class="tool-query-bar" data-tool-query><label class="tool-field"><span>名称 / 编号 / 条形码</span><input class="input" type="search" name="query" value="${esc(v.query||'')}" placeholder="输入查询内容"><span class="tool-scan-toggle"><input type="checkbox" data-tool-scan-mode ${v.scanMode?'checked':''}> 连续扫码选择</span></label><label class="tool-field"><span>工具库</span><select class="select" name="warehouse"><option value="">全部工具库</option>${m.warehouses.map(w=>`<option value="${w.id}" ${String(v.warehouse)===String(w.id)?'selected':''}>${esc(w.name)}</option>`).join('')}</select></label><label class="tool-field"><span>状态</span><select class="select" name="queryStatus"><option value="">全部状态</option>${['在库','借出','送检','送修','送检 / 送修','调拨中','待审核','停用','已报废','已遗失','待完善登记'].map(label=>`<option ${v.queryStatus===label?'selected':''}>${label}</option>`).join('')}</select></label><label class="tool-field"><span>借用类型（未归还）</span><select class="select" name="borrowType"><option value="">全部类型</option>${[...new Set(m.loans.filter(l=>l.status==='OPEN').map(l=>l.borrowType))].map(t=>`<option value="${esc(t)}" ${v.borrowType===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label><label class="tool-field"><span>查询送检 / 送修</span><input class="input" name="serviceQuery" value="${esc(v.serviceQuery||'')}" placeholder="单位或送检、送修"></label><button class="btn btn-primary" type="submit">查询</button><button type="button" class="btn" data-tool-reset-query>重置条件</button></form>`
  return `<div class="tool-workspace tool-table-workspace pc-plan-page" data-tool-workspace><h1>${v.pageMode==='inventory'?'盘点':'工具台账'}</h1><section class="tool-global-stats" aria-label="全部工具状态统计">${stats.map(([label,n,unit,key])=>`<div>${key?`<button type="button" class="tool-stat-button" data-tool-stat="${key}" aria-label="查看${label}清单">`:''}<span>${label}</span><strong>${n}<small>${unit}</small></strong>${key?'</button>':''}</div>`).join('')}</section>${count?'':queryForm}${v.scanMode?`<p class="pc-help" role="status" data-tool-scan-status>${esc(v.scanMessage||'扫码后按回车，连续加入所选清单；数量在办理时确认。')}</p>`:''}${v.lastReceipt?`<div class="tool-receipt" role="status" data-tool-receipt><span>${esc(v.lastReceipt.title)} · ${esc(v.lastReceipt.actor)} · ${dt(v.lastReceipt.at)}${v.lastReceipt.ids.length?' · 单号 '+v.lastReceipt.ids.map(id=>'#'+id).join('、'):''}</span>${v.lastReceipt.groups?.length>1?v.lastReceipt.groups.map((g,i)=>`<button type="button" class="text-action" data-tool-receipt-group="${i}">查看${recordKinds[g.kind]}（${g.ids.map(id=>'#'+id).join('、')}）</button>`).join(''):'<button type="button" class="text-action" data-tool-table-action="receipt">查看本次记录</button>'}</div>`:''}${!count&&Object.keys(v.columnFilters||{}).length?`<p class="tool-applied-filters">表头筛选：${Object.entries(v.columnFilters).map(([key,values])=>`${esc(tableColumns.find(c=>c[0]===key)?.[1]||key)}（${values.length}个值）`).join(' · ')} <button class="text-action" data-tool-clear-filters>清除表头筛选</button></p>`:''}${body}${!count?`<div class="tool-bottom-panel tool-workspace-actions">${operations}</div>`:''}<section class="tool-bottom-panel ${selected.length&&!count?'has-selection':''}" aria-label="所选工具与操作" data-tool-bottom>${count?`<div class="tool-bottom-count"><strong>盘点结果</strong><p>${count.status==='OPEN'?'完成现场核对后确认，系统保存实际数量、差异与经办人。':count.status==='CANCELLED'?'本次盘点已取消，未调整库存；可导出取消记录。':'本次盘点已完成，可以导出结果。'}</p><div class="tool-bottom-buttons">${count.status==='OPEN'?action('count-confirm','确认清点完成')+action('count-cancel-current','取消本次盘点'):''}${count.status==='OPEN'?action('count-retry','重试保存')+action('count-reload','读取数据库进度'):''}${count.status==='CLOSED'&&count.lines.some(l=>countLossRemaining(m,count,l)>0)?action('count-loss','从差异申请遗失'):''}${action('count-export','导出盘点状态')}${action('count-exit',v.pageMode==='inventory'?'返回盘点列表':'返回工具台账')}</div></div>`:`<div data-tool-selection-summary>${selectionSummary(all,v)}</div>${selectedOperations}${reasons?`<div class="tool-operation-reasons" aria-label="不可办理原因">${reasons}</div>`:''}`}</section></div>`
}
