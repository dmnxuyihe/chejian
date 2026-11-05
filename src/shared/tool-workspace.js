import {escapeHtml as esc,openModal} from '../core/ui.js'
import {pageHeader} from './templates.js'
import {assetStock,assetHeld,toolDueAt,toolAlerts,toolAvailableQuantity,toolLabels} from '../core/tool-management.js'

export const toolTabs={ledger:'工具台账',circulation:'借还与调拨',service:'检定与维修',alerts:'盘点与预警',devices:'智能设施'}
export const toolSections={circulation:{loans:'借用与归还',transfers:'工具调拨'},service:{inspection:'送检校验',repair:'维修记录',disposals:'遗失与报废审核'},alerts:{warnings:'待处理提醒',counts:'盘点任务'},devices:{facilities:'设施台账',events:'识别与领还事件'}}
const name=(rows,id)=>rows.find(row=>row.id===id)?.name||'—'
const date=value=>value?esc(String(value).replace('T',' ').slice(0,16)):'—'
const words={...toolLabels,ONLINE:'在线',OFFLINE:'未连接 / 离线',MAINTENANCE:'检修中'}
const stateText=(value,kind)=>value==='PENDING'&&kind==='transfers'?'待接收':value==='OPEN'&&kind==='loans'?'未归还':value==='OPEN'&&kind==='inspection'?'检定中':value==='OPEN'&&kind==='repair'?'维修中':words[value]||value||'—'
export const toolState=(value,kind)=>`<span class="tool-state is-${esc(value.toLowerCase())}">${esc(stateText(value,kind))}</span>`
export const toolButton=(action,id,text)=>`<button type="button" class="text-action" data-tool-action="${action}" data-id="${id}">${esc(text)}</button>`
const empty=(title,body='调整查询条件，或使用右上角操作开始办理。')=>`<div class="tool-empty"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`
const table=(heads,rows,emptyText='暂无记录')=>rows.length?`<div class="table-wrap tool-data-wrap"><table class="tool-data-table"><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,i)=>`<td data-label="${esc(heads[i])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(emptyText)
const title=(text,count)=>`<div class="tool-list-heading"><h2 tabindex="-1">${esc(text)}</h2><span class="count-label" role="status">${count} 条</span></div>`
const due=a=>{const value=toolDueAt(a);return value==='MISSING'?'未登记合格检定':value?value.slice(0,10):'无需定期检定'}
const dueValid=(a,at)=>{const d=toolDueAt(a);return !d||(d!=='MISSING'&&new Date(d)>new Date(at))}
const managedAvailable=(s,a)=>s.tools.find(t=>t.id===a.toolId)?.status==='AVAILABLE'&&dueValid(a,new Date())?assetStock(s.toolManagement,a):0
const hasQuery=(row,query)=>!query||row.toLocaleLowerCase().includes(query.toLocaleLowerCase())
const byWarehouse=(v,id)=>!v.warehouse||Number(v.warehouse)===id
const fact=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`
const facts=items=>`<dl class="tool-facts">${items.map(([k,v])=>fact(k,v)).join('')}</dl>`
const text=v=>esc(v||'—')
const assetName=(s,id)=>{const a=s.toolManagement.assets.find(a=>a.id===id);return a?`${name(s.tools,a.toolId)} · ${a.code}`:'—'}

export function toolInventorySummary(s,warehouse=''){
  const m=s.toolManagement,assets=m.assets.filter(a=>!warehouse||a.warehouseId===Number(warehouse))
  const legacy=s.tools.filter(t=>!m.assets.some(a=>a.toolId===t.id)).reduce((n,t)=>n+(Number(t.quantity)||0),0)
  return {legacy,managed:assets.reduce((n,a)=>n+a.quantity,0),available:assets.reduce((n,a)=>n+managedAvailable(s,a),0)}
}
export function toolDestination(view,tab,section,status=''){
  Object.assign(view,{tab,section:section||Object.keys(toolSections[tab]||{})[0]||'',status,query:''})
}
export function toolPrimary(s,v){
  const m=s.toolManagement,legacy=s.tools.some(t=>t.quantity>0&&!m.assets.some(a=>a.toolId===t.id))
  if(!m.warehouses.length)return ['warehouse','建立工具库']
  if(!m.assets.length&&v.tab!=='devices')return legacy?['adopt-new','接管原库存']:!s.tools.length?['tool-new','建立工具品种']:['asset-new','新增工具实物']
  if(v.tab==='ledger')return ['asset-new','新增实物']
  if(v.tab==='circulation')return v.section==='transfers'?['transfer-new','新建调拨']:['borrow-new','办理领用']
  if(v.tab==='service')return v.section==='disposals'?['disposal','新建遗失 / 报废申请']:['service-new',v.section==='repair'?'办理送修':'办理送检']
  if(v.tab==='alerts')return ['count-new','新建盘点']
  return ['device-new','添加设施']
}
function onboarding(s){
  const m=s.toolManagement;if(m.assets.length)return ''
  const step=m.warehouses.length?2:1,legacy=toolInventorySummary(s).legacy
  return `<section class="tool-onboarding" aria-label="首次使用引导"><ol><li class="${step===1?'is-current':'is-complete'}"><span>1</span>建立工具库</li><li class="${step===2?'is-current':''}"><span>2</span>接管库存或新增实物</li><li><span>3</span>开始领用与流转</li></ol><div><strong>${step===1?'先建立工具库，再登记工具实物':'工具库已就绪，下一步建立实物台账'}</strong><p>${legacy?`仍有 ${legacy} 件原字典库存尚未纳管，接管后不会重复增加库存。`:'登记工具品种与实物后，即可办理领用、检定和盘点。'}</p>${step===2?toolButton(legacy?'adopt-new':'tool-new',0,legacy?'接管原库存':'新增工具品种'):''}</div></section>`
}
function overview(s,v){
  const m=s.toolManagement,stock=toolInventorySummary(s,v.warehouse)
  const loans=m.loans.filter(r=>r.status==='OPEN'&&r.lines.some(l=>byWarehouse(v,l.warehouseId)))
  const services=m.services.filter(r=>r.status==='OPEN'&&byWarehouse(v,m.assets.find(a=>a.id===r.assetId)?.warehouseId))
  const disposals=m.disposals.filter(r=>r.status==='PENDING'&&byWarehouse(v,m.assets.find(a=>a.id===r.assetId)?.warehouseId))
  const alertRows=filteredAlerts(s,{...v,query:''})
  const jump=(key,label,n,unit)=>`<button type="button" data-tool-jump="${key}" class="tool-todo ${n?'has-items':''}"><span>${label}</span><strong>${n}<small>${unit}</small></strong><span aria-hidden="true">↗</span></button>`
  return `<div class="tool-stock-summary" aria-label="工具库存口径"><div><span>原字典库存 · 未纳管</span><strong>${stock.legacy}<small>件</small></strong><p>${v.warehouse?'全库未纳管总量，尚未分配工具库':'接管后转入实物台账'}</p></div><div><span>实物账面总量</span><strong>${stock.managed}<small>件</small></strong><p>含借出、送检送修和流转占用</p></div><div><span>实物可领用量</span><strong>${stock.available}<small>件</small></strong><p>已扣除占用、停用和检定失效</p></div></div><section class="tool-todos" aria-label="工具待办事项">${jump('loans','未归还借用',loans.length,'单')}${jump('services','检定 / 维修中',services.length,'单')}${jump('disposals','待审核申请',disposals.length,'单')}${jump('warnings','待处理提醒',alertRows.length,'项')}</section>`
}
function rowActions(a,s){return `<div class="tool-actions">${managedAvailable(s,a)>0?toolButton('borrow',a.id,'领用'):''}${toolButton('detail',a.id,'详情')}<details class="resource-row-menu"><summary>更多</summary><div>${[['transfer','调拨'],['service','送检 / 送修'],['disposal','遗失 / 报废申请'],['asset-config','标签与状态'],['check-use','作业工具核验']].map(([key,label])=>toolButton(key,a.id,label)).join('')}</div></details></div>`}
function ledger(s,v){
  const m=s.toolManagement,assets=m.assets.filter(a=>byWarehouse(v,a.warehouseId)&&(!v.status||a.status===v.status)&&hasQuery([a.code,a.tag,name(s.tools,a.toolId),name(m.warehouses,a.warehouseId)].join(' '),v.query))
  const rows=assets.map(a=>[`<strong>${text(name(s.tools,a.toolId))}</strong><small>${text(a.code)} · ${text(words[a.mode])}</small>`,text(name(m.warehouses,a.warehouseId)),`<strong>${managedAvailable(s,a)} 件可领用</strong><small>账面 ${a.quantity} 件</small>`,`${text(due(a))}${!dueValid(a,new Date())?'<small class="tool-warning">检定失效，暂不能领用</small>':''}`,toolState(a.status),rowActions(a,s)])
  return `${title('工具实物',assets.length)}${table(['工具 / 编号','工具库','库存','检定','状态','操作'],rows,m.assets.length?'没有匹配的工具':'尚未建立实物台账')}<details class="tool-section" ${!m.assets.length&&m.warehouses.length?'open':''}><summary>工具字典与库存接管</summary><div class="tool-section-actions">${toolButton('tool-new',0,'新增工具品种')}${toolButton('warehouse',0,'维护工具库')}${toolButton('category',0,'维护工具分类')}</div>${table(['品种 / 规格','可用量','低储阈值','状态','操作'],s.tools.filter(t=>hasQuery([t.code,t.name,t.specification].join(' '),v.query)).map(t=>[`<strong>${text(t.name)}</strong><small>${text(t.code)} · ${text(t.specification)}</small>`,`${toolAvailableQuantity(s,t.id)} 件${!m.assets.some(a=>a.toolId===t.id)?'<small>原字典库存 · 未纳管</small>':''}`,`${t.lowStock??'未设置'}${Object.entries(t.warehouseLowStock||{}).map(([id,n])=>`<small>${text(name(m.warehouses,Number(id)))}：${n}</small>`).join('')}`,toolState(t.status),`<div class="tool-actions">${toolButton('tool-edit',t.id,'编辑')}${toolButton('bind-task',t.id,'工序绑定')}${!m.assets.some(a=>a.toolId===t.id)&&t.quantity>0?toolButton('adopt',t.id,'接管库存'):''}</div>`]))}</details><details class="tool-section"><summary>工具套装（${m.kits.length}）</summary><div class="tool-section-actions">${toolButton('kit',0,'新增套装')}</div>${table(['编号 / 名称','组成','操作'],m.kits.map(k=>[`${text(k.name)}<small>${text(k.code)}</small>`,k.lines.map(l=>`${text(assetName(s,l.assetId))} × ${l.quantity}`).join('<br>'),`<div class="tool-actions">${toolButton('kit-borrow',k.id,'领用整套')}${toolButton('kit-edit',k.id,'编辑组成')}</div>`]))}</details><details class="tool-section"><summary>基础配置（${m.warehouses.length} 个工具库，${m.categories.length} 个分类）</summary>${table(['类型','编码 / 名称','操作'],[...m.warehouses.map(r=>['工具库',`${text(r.code)} · ${text(r.name)}`,toolButton('warehouse-edit',r.id,'编辑')]),...m.categories.map(r=>['分类',`${text(r.code)} · ${text(r.name)}`,toolButton('category-edit',r.id,'编辑')])])}</details>`
}
function circulation(s,v){
  const m=s.toolManagement
  if(v.section==='transfers'){
    const rows=m.transfers.filter(r=>(byWarehouse(v,r.fromWarehouseId)||byWarehouse(v,r.toWarehouseId))&&(!v.status||r.status===v.status)&&hasQuery(`${r.id} ${assetName(s,r.assetId)} ${name(m.warehouses,r.toWarehouseId)}`,v.query)).slice().reverse()
    return title('工具调拨',rows.length)+table(['单号 / 工具','调出 → 调入','数量','状态','操作'],rows.map(r=>[`${r.id} · ${text(assetName(s,r.assetId))}`,`${text(name(m.warehouses,r.fromWarehouseId))} → ${text(name(m.warehouses,r.toWarehouseId))}`,`${r.quantity} 件`,toolState(r.status,'transfers'),r.status==='PENDING'?toolButton('transfer-finish',r.id,'接收 / 取消'):'—']))
  }
  const rows=m.loans.filter(l=>l.lines.some(line=>byWarehouse(v,line.warehouseId))&&(!v.status||l.status===v.status)&&hasQuery(`${l.id} ${l.borrower} ${l.borrowType} ${l.lines.map(line=>assetName(s,line.assetId)).join(' ')}`,v.query)).slice().reverse()
  return title('借用与归还',rows.length)+table(['借用单 / 类型','领用人','工具 / 未还数量','预计归还','状态','操作'],rows.map(l=>[`${l.id} · ${text(l.borrowType)}`,text(l.borrower),l.lines.map(line=>`${text(assetName(s,line.assetId))}<small>未还 ${line.quantity-line.returned-(line.disposed||0)} / ${line.quantity} 件 · ${text(name(m.warehouses,line.warehouseId))}</small>`).join('<br>'),`${date(l.dueAt)}${l.status==='OPEN'&&new Date(l.dueAt)<new Date()?'<small class="tool-warning">已超期</small>':''}`,toolState(l.status,'loans'),`<div class="tool-actions">${toolButton('loan-detail',l.id,'流转详情')}${l.status==='OPEN'?toolButton('return',l.id,'办理归还'):''}</div>`]))
}
function service(s,v){
  const m=s.toolManagement
  if(v.section==='disposals'){
    const rows=m.disposals.filter(r=>byWarehouse(v,m.assets.find(a=>a.id===r.assetId)?.warehouseId)&&(!v.status||r.status===v.status)&&hasQuery(`${r.id} ${assetName(s,r.assetId)} ${r.actor} ${r.reason} ${r.opinion||''}`,v.query)).slice().reverse()
    return title('遗失与报废审核',rows.length)+table(['申请单 / 工具','类型 / 数量','申请人 / 时间','状态','操作'],rows.map(r=>[`${r.id} · ${text(assetName(s,r.assetId))}<small>${text(r.reason)}</small>`,`${text(words[r.kind])} · ${r.quantity} 件`,`${text(r.actor)}<small>${date(r.at)}</small>`,toolState(r.status),`<div class="tool-actions">${toolButton('disposal-detail',r.id,'查看详情')}${r.status==='PENDING'?toolButton('disposal-review',r.id,'审核'):''}</div>`]))
  }
  const rows=m.services.filter(r=>(v.section==='all-services'||r.kind===(v.section==='repair'?'REPAIR':'INSPECTION'))&&byWarehouse(v,m.assets.find(a=>a.id===r.assetId)?.warehouseId)&&(!v.status||r.status===v.status)&&hasQuery(`${r.id} ${assetName(s,r.assetId)} ${r.provider} ${r.reason} ${r.certificate||''}`,v.query)).slice().reverse()
  return title(v.section==='repair'?'维修记录':v.section==='all-services'?'检定 / 维修中':'送检校验',rows.length)+table(['单号 / 工具','类型 / 数量','单位 / 原因','办理时间','状态','操作'],rows.map(r=>[`${r.id} · ${text(assetName(s,r.assetId))}`,`${text(words[r.kind])} · ${r.quantity} 件`,`${text(r.provider)}<small>${text(r.reason)}</small>`,date(r.at),`${toolState(r.status,v.section)}<small>${text(r.certificate)}</small>`,`<div class="tool-actions">${toolButton('detail',r.assetId,'工具详情')}${r.status==='OPEN'?toolButton('service-finish',r.id,'登记结果'):''}</div>`]))
}
function filteredAlerts(s,v){const m=s.toolManagement;return toolAlerts(s).filter(r=>hasQuery(`${r.name} ${r.message}`,v.query||'')&&(!v.warehouse||r.warehouseId===Number(v.warehouse)||r.assetId&&byWarehouse(v,m.assets.find(a=>a.id===r.assetId)?.warehouseId)||r.loanId&&m.loans.find(l=>l.id===r.loanId)?.lines.some(l=>byWarehouse(v,l.warehouseId))||r.eventId&&byWarehouse(v,m.devices.find(d=>d.id===m.events.find(e=>e.id===r.eventId)?.deviceId)?.warehouseId)||r.toolId&&!r.warehouseId&&m.assets.some(a=>a.toolId===r.toolId&&byWarehouse(v,a.warehouseId))))}
function alerts(s,v){
  const m=s.toolManagement
  if(v.section==='counts'){const rows=m.counts.filter(r=>byWarehouse(v,r.warehouseId)&&hasQuery(`${r.id} ${name(m.warehouses,r.warehouseId)} ${r.actor} ${r.reason||''}`,v.query));return title('盘点任务',rows.length)+table(['单号 / 工具库','创建时间','盘点项数','状态','操作'],rows.slice().reverse().map(r=>[`${r.id} · ${text(name(m.warehouses,r.warehouseId))}`,date(r.at),`${r.lines.length} 项`,toolState(r.status),r.status==='OPEN'?`<div class="tool-actions">${toolButton('count-finish',r.id,'填写实盘')}${toolButton('count-cancel',r.id,'取消盘点')}</div>`:toolButton('count-detail',r.id,'差异明细')]))}
  const rows=filteredAlerts(s,v);return title('待处理提醒',rows.length)+table(['对象','提示','处理'],rows.map(r=>[text(r.name),text(r.message),r.assetId?`<div class="tool-actions">${toolButton('detail',r.assetId,'工具详情')}${r.type.startsWith('INSPECTION')?toolButton('service',r.assetId,'办理送检'):''}</div>`:r.loanId?toolButton('return',r.loanId,'办理归还'):r.eventId?toolButton('resolve',r.eventId,'记录处置'):toolButton('tool-edit',r.toolId,'调整阈值')]),'当前没有待处理提醒')
}
function devices(s,v){
  const m=s.toolManagement
  if(v.section==='events'){const rows=m.events.filter(e=>(!v.warehouse||byWarehouse(v,m.devices.find(d=>d.id===e.deviceId)?.warehouseId))&&hasQuery(`${e.deviceName||''} ${e.message} ${e.type}`,v.query)).slice().reverse().slice(0,100);return title('识别与领还事件 · 最近100条',rows.length)+table(['时间 / 设施','事件 / 来源','结果','内容','操作'],rows.map(e=>[`${date(e.at)}<small>${text(e.deviceName||'作业核验')}</small>`,`${text(words[e.type])}<small>${text(words[e.source])}</small>`,toolState(e.status),`${text(e.message)}${e.resolvedAt?`<small>已处置：${text(e.resolution)}</small>`:''}`,e.status==='ERROR'&&!e.resolvedAt?toolButton('resolve',e.id,'处置'):'—']))}
  const rows=m.devices.filter(d=>byWarehouse(v,d.warehouseId)&&hasQuery(`${d.name} ${d.code}`,v.query));return title('设施台账',rows.length)+table(['设施 / 编码','类型','工具库','连接状态','操作'],rows.map(d=>[`${text(d.name)}<small>${text(d.code)}</small>`,text(words[d.kind]),text(name(m.warehouses,d.warehouseId)),`${toolState(!d.enabled?'DISABLED':d.lastSeenAt&&Date.now()-new Date(d.lastSeenAt)<120000?'ONLINE':'OFFLINE')}<small>最近通信 ${date(d.lastSeenAt)}</small>`,`<div class="tool-actions">${toolButton('device-edit',d.id,'编辑')}<details class="resource-row-menu"><summary>联调</summary><div>${toolButton('device-event',d.id,'模拟事件')}</div></details></div>`]))+`<details class="tool-section"><summary>设备接入与联调说明</summary><p>模拟事件会办理工具库存业务，但不会将设备标记为在线。只有真实设备通信才更新连接状态。</p><p>网关：<code>POST /api/tools/device-events</code>；认证配置及字段说明见《工具管理_设备接入与验收》。设备令牌只在服务器配置。门禁通行事件记录已发生的结果，不远程解锁。</p></details>`
}
export function renderToolWorkspace(ctx,v){
  const s=ctx.state,m=s.toolManagement,primary=toolPrimary(s,v),sections=toolSections[v.tab],statuses=v.tab==='ledger'?['AVAILABLE','DISABLED','LOST','SCRAPPED']:v.tab==='circulation'?(v.section==='transfers'?['PENDING','RECEIVED','CANCELLED']:['OPEN','CLOSED']):v.tab==='service'?(v.section==='disposals'?['PENDING','APPROVED','REJECTED']:['OPEN','CLOSED']):[]
  const secondary=sections?`<nav class="tool-subtabs" aria-label="${toolTabs[v.tab]}分类">${Object.entries(sections).map(([id,label])=>`<button type="button" class="${v.section===id?'active':''}" data-tool-section="${id}" aria-pressed="${v.section===id}">${label}</button>`).join('')}${v.section==='all-services'?'<button class="active" type="button" data-tool-section="all-services" aria-pressed="true">全部检定 / 维修</button>':''}</nav>`:''
  return `<div class="tool-workspace pc-plan-page" data-tool-workspace>${pageHeader('工具管理','',`<button type="button" class="btn btn-primary" data-tool-primary data-tool-action="${primary[0]}">${esc(primary[1])}</button>`)}${onboarding(s)}<nav class="plan-view-tabs plan-switch-tabs tool-tabs" aria-label="工具管理功能">${Object.entries(toolTabs).map(([id,label])=>`<button type="button" class="${v.tab===id?'active':''}" data-tool-tab="${id}" aria-pressed="${v.tab===id}">${label}</button>`).join('')}</nav>${overview(s,v)}${secondary}<div class="tool-toolbar"><form data-tool-search role="search"><label class="tool-field"><span>搜索${v.tab==='ledger'?'工具或编号':'单据、工具或人员'}</span><input class="input" type="search" data-f="query" value="${esc(v.query)}" placeholder="输入关键词"></label><button class="btn" type="submit">查询</button></form><label class="tool-field"><span>工具库</span><select class="select" data-tool-warehouse><option value="">全部工具库</option>${m.warehouses.map(r=>`<option value="${r.id}" ${String(r.id)===v.warehouse?'selected':''}>${text(r.name)}</option>`).join('')}</select></label>${statuses.length?`<label class="tool-field"><span>状态</span><select class="select" data-tool-status><option value="">全部记录</option>${statuses.map(status=>`<option value="${status}" ${v.status===status?'selected':''}>${text(stateText(status,v.section))}</option>`).join('')}</select></label>`:''}<button type="button" class="text-action tool-export" data-tool-action="export">导出台账与记录</button></div><div class="tool-body" data-tool-results>${({ledger,circulation,service,alerts,devices})[v.tab](s,v)}</div></div>`
}
export function disposalContext(s,r){
  const m=s.toolManagement,a=m.assets.find(a=>a.id===r.assetId)
  return `<div class="tool-review-context">${facts([['申请单',`#${r.id}`],['工具',text(assetName(s,r.assetId))],['所属工具库',text(name(m.warehouses,a?.warehouseId))],['类型 / 数量',`${text(words[r.kind])} · ${r.quantity} 件`],['申请人 / 时间',`${text(r.actor)}<small>${date(r.at)}</small>`],['申请原因',text(r.reason)]])}<ol class="tool-flow"><li class="is-complete"><strong>已提交申请</strong><span>${date(r.at)}</span></li><li class="${r.status==='PENDING'?'is-current':'is-complete'}"><strong>${r.status==='PENDING'?'等待审核':r.status==='APPROVED'?'审核批准':'审核驳回'}</strong><span>${text(r.reviewer||'待指定审核人')}${r.reviewedAt?` · ${date(r.reviewedAt)}`:''}</span></li><li><strong>${r.status==='APPROVED'?'已处置库存':r.status==='REJECTED'?'保留原库存':'审核后处置库存'}</strong><span>${text(r.opinion||'审核结果及意见将在此保留')}</span></li></ol>${r.loanId?`<p class="pc-help">关联借用单 #${r.loanId}；批准后结清对应未还数量。</p>`:''}</div>`
}
export function openToolDetails(ctx,a,initial='summary'){
  const s=ctx.state,m=s.toolManagement,loans=m.loans.filter(l=>l.lines.some(r=>r.assetId===a.id)),services=m.services.filter(r=>r.assetId===a.id),disposals=m.disposals.filter(r=>r.assetId===a.id),transfers=m.transfers.filter(r=>r.assetId===a.id)
  const panes={summary:'工具概况',circulation:'流转历史',service:'检定与维修',approval:'审批记录'}
  const summary=()=>facts([['工具名称',text(name(s.tools,a.toolId))],['实物 / 批次编号',text(a.code)],['当前位置',text(name(m.warehouses,a.warehouseId))],['状态',toolState(a.status)],['账面 / 可领用',`${a.quantity} / ${managedAvailable(s,a)} 件`],['流转占用',`${assetHeld(m,a.id)} 件`],['标签',text(a.tag||'未绑定')],['检定有效期',text(due(a))]])+`<h4>当前借用</h4>${loans.filter(l=>l.status==='OPEN').map(l=>{const line=l.lines.find(r=>r.assetId===a.id),remaining=line.quantity-line.returned-(line.disposed||0);return remaining?`<div class="tool-current-loan"><strong>${text(l.borrower)}</strong><span>未还 ${remaining} 件 · 应于 ${date(l.dueAt)} 归还</span></div>`:''}).join('')||'<p class="pc-help">当前没有未归还借用。</p>'}`
  const render=key=>key==='summary'?summary():key==='circulation'?table(['业务','时间','人员 / 数量','状态 / 结果'],[...loans.flatMap(l=>[[`领用 #${l.id}`,date(l.at),`${text(l.borrower)} · ${l.lines.find(r=>r.assetId===a.id).quantity} 件`,toolState(l.status,'loans')],...l.returns.filter(r=>r.assetId===a.id).map(r=>[`归还 #${l.id}`,date(r.at),`${text(r.returner)} · ${r.quantity} 件`,'已归还'])]),...transfers.map(r=>[`调拨 #${r.id}`,date(r.at),`${text(name(m.warehouses,r.fromWarehouseId))} → ${text(name(m.warehouses,r.toWarehouseId))} · ${r.quantity} 件`,toolState(r.status,'transfers')])]):key==='service'?table(['业务 / 数量','单位 / 原因','办理 / 完成时间','结果'],services.map(r=>[`${text(words[r.kind])} #${r.id} · ${r.quantity} 件`,`${text(r.provider)}<small>${text(r.reason)}</small>`,`${date(r.at)}<small>${date(r.finishedAt)}</small>`,`${toolState(r.status)}<small>${text(r.certificate)}</small>`])):disposals.map(r=>`<section class="tool-approval-item"><h4>${text(words[r.kind])}申请 #${r.id} ${toolState(r.status)}</h4>${disposalContext(s,r)}</section>`).join('')||empty('暂无审批记录')
  const wrap=openModal({title:`${a.code} · ${name(s.tools,a.toolId)}`,wide:true,confirmText:'关闭',cancelText:'返回',body:`<nav class="tool-detail-tabs" aria-label="工具详情分类">${Object.entries(panes).map(([key,label])=>`<button type="button" data-tool-detail-tab="${key}" class="${initial===key?'active':''}" aria-pressed="${initial===key}">${label}</button>`).join('')}</nav><div data-tool-detail-content>${render(initial)}</div>`})
  wrap.querySelectorAll('[data-tool-detail-tab]').forEach(button=>button.addEventListener('click',()=>{wrap.querySelectorAll('[data-tool-detail-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});wrap.querySelector('[data-tool-detail-content]').innerHTML=render(button.dataset.toolDetailTab)}))
}
