import {recordQueryActions,businessQueryMarkup} from './tool-record-query.js'
import {toolDateTime,toolDateInput} from './tool-dates.js'
// Business content retained from the morning workspace (613605e).
// Records share the tool-management entry; actions stay below the selected record.
import {escapeHtml as esc,openModal,openModalChild} from '../core/ui.js'
import {toolAlerts,toolLabels} from '../core/tool-management.js'

const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const date=toolDateTime
const label=v=>({LOW_STOCK:'库存低储',WAREHOUSE_LOW_STOCK:'分库低储',INSPECTION_MISSING:'检定缺失',INSPECTION_DUE:'检定到期',OVERDUE:'借用超期',DEVICE_ERROR:'设备异常'})[v]||toolLabels[v]||v||'—'
const asset=(s,id)=>{const a=s.toolManagement.assets.find(r=>r.id===id);return a?`${name(s.tools,a.toolId)} · ${a.code}`:'—'}
export const recordKinds={loans:'借还记录',transfers:'调拨记录',inspection:'送检记录',repair:'送修记录',disposals:'遗失报废审核',warnings:'综合预警',events:'设施事件',audit:'业务审计'}
const actionNames={ASSET_DELETE:'删除工具实物',KIT_DELETE:'删除套装',TOOL_DELETE:'删除工具品种',CATEGORY_DELETE:'删除工具分类',DEVICE_DELETE:'删除设施',REQUIREMENT_DELETE:'删除工序绑定',ASSET_CREATE:'新增实物',ASSET_EDIT:'修改实物',ASSET_CONFIG:'标签与状态',ADOPT_LEGACY:'完善登记',TOOL_SAVE:'维护工具字典',CATEGORY_SAVE:'维护分类',KIT_SAVE:'维护套装',BORROW:'借出',RETURN:'归还',KIT_RETURN:'套装归还',TRANSFER:'调拨',TRANSFER_FINISH:'处理调拨',SERVICE_SEND:'送检送修',SERVICE_FINISH:'登记结果',DISPOSAL_REQUEST:'遗失报废申请',DISPOSAL_REVIEW:'审核申请',COUNT_CREATE:'开始盘点',COUNT_FINISH:'确认盘点',COUNT_CANCEL:'取消盘点',DEVICE_SAVE:'维护设施',DEVICE_EVENT:'设施事件',EVENT_RESOLVE:'异常处置',CHECK_USE:'工具核验',REQUIREMENT_SAVE:'工序绑定',BATCH:'批量办理'}
const auditPayload=r=>{try{return JSON.parse(r.detail)||{}}catch{return {}}}
const auditIdentity=o=>[o.name,o.code,o.warehouseName,o.quantity!=null?`${o.quantity} 件`:''].filter(Boolean).join(' · ')
function auditSummary(s,r){
 const p=auditPayload(r),identities=(r.objects||[]).flatMap(o=>{
  const original=o.after||o.before,current=original?.kind==='asset'?s.toolManagement.assets.find(a=>a.id===original.id&&a.createdAt===original.createdAt):null
  return [o.before&&auditIdentity(o.before),o.after&&auditIdentity(o.after),current&&current.code!==original.code?`现编号 ${current.code}`:'']
 })
 const fallback=!identities.length&&p.assetId?`历史记录未保存工具快照（内部编号 #${p.assetId}）${asset(s,Number(p.assetId))!=='—'?`；当前台账：${asset(s,Number(p.assetId))}`:''}`:''
 return [...new Set([...identities,fallback,p.name,p.code,p.quantity&&`${p.quantity} 件`,p.borrower,p.returner,p.reason,p.opinion,p.resolution,p.commands&&`${p.commands.length} 项业务`].filter(Boolean))].join('；')||'业务记录已保存'
}
export function openToolAuditDetails(s,id){
 const r=s.toolManagement.audit.find(r=>r.id===Number(id));if(!r)return
 const fields={name:'工具名称',code:'编号',warehouseName:'工具库',quantity:'账面数量',status:'状态',tag:'条形码 / RFID',receivedAt:'入库时间',lastRepairAt:'最后检修时间',lastInspectionAt:'最近检定时间',inspectionCycleMonths:'检定周期（月）',lines:'套装成员'}
 const value=(o,key)=>!o?'记录不存在':o[key]==null||o[key]===''?'—':['receivedAt','lastRepairAt','lastInspectionAt'].includes(key)?date(o[key]):key==='status'?label(o[key]):key==='lines'?o.lines.map(l=>`内部编号 #${l.assetId} × ${l.quantity}`).join('；'):String(o[key])
 const objects=r.objects||[],rows=objects.flatMap(o=>Object.entries(fields).filter(([key])=>o.before?.[key]!==undefined||o.after?.[key]!==undefined).map(([key,title])=>`<tr><td>${esc((o.before||o.after).code||'—')}</td><td>${esc(title)}</td><td>${esc(value(o.before,key))}</td><td>${esc(value(o.after,key))}</td></tr>`)).join('')
 return openModal({title:`操作明细 #${r.id}`,wide:true,confirmText:'关闭',body:`<p>${esc(actionNames[r.action]||r.action)} · ${esc(r.actor)} · ${esc(date(r.at))}</p><p>${esc(auditSummary(s,r))}</p>${rows?`<div class="table-wrap"><table><thead><tr><th>对象编号</th><th>字段</th><th>操作前</th><th>操作后</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="pc-help">该历史记录未保存字段快照，无法还原当时的完整信息。</p>'}`})
}

export function toolRecordData(s,kind){
 const m=s.toolManagement
 if(kind==='loans')return {heads:['借用单 / 类型','工具 / 数量','领用人 / 归还人','办理 / 应还时间','状态'],rows:m.loans.slice().reverse().map(r=>({id:r.id,status:r.status,cells:[`#${r.id} · ${r.borrowType}${r.kitId?`\n套装 ${m.kits.find(k=>k.id===r.kitId)?.name||'—'} · ${m.kits.find(k=>k.id===r.kitId)?.code||'—'}`:''}`,r.lines.map(l=>`${asset(s,l.assetId)}：未还 ${l.quantity-l.returned-(l.disposed||0)} / ${l.quantity} 件；${name(m.warehouses,l.warehouseId)}`).join('\n'),`${r.borrower}\n${r.returns.map(t=>`${t.returner} 归还${t.quantity}件 · ${date(t.at)}`).join('\n')}`,`${date(r.at)}\n预计归还 ${date(r.dueAt)}`,`${r.status==='OPEN'?'未归还':'已结清'}${r.status==='OPEN'&&new Date(r.dueAt)<new Date()?' · 已超期':''}`],actions:[['loan-detail','流转详情'],...(r.status==='OPEN'?[[r.kitId?'kit-return-loan':'return','办理归还']]:[])]}))}
 if(kind==='transfers')return {heads:['调拨单 / 工具','调出 → 调入','数量','经办人 / 时间','状态'],rows:m.transfers.slice().reverse().map(r=>({id:r.id,status:r.status,cells:[`#${r.id} · ${asset(s,r.assetId)}${r.resultingAssetId&&r.resultingAssetId!==r.assetId?`\n接收台账：${asset(s,r.resultingAssetId)}`:''}`,`${name(m.warehouses,r.fromWarehouseId)} → ${name(m.warehouses,r.toWarehouseId)}`,`${r.quantity} 件`,`${r.actor} · ${date(r.at)}\n${r.receivedBy||''} ${date(r.finishedAt)}`,r.status==='PENDING'?'待接收':label(r.status)],actions:r.status==='PENDING'?[['transfer-finish','接收 / 取消']]:[]}))}
 if(['inspection','repair'].includes(kind))return {heads:['单号 / 工具','数量 / 单位','原因','办理 / 完成时间','结果 / 证书'],rows:m.services.filter(r=>r.kind===(kind==='repair'?'REPAIR':'INSPECTION')).slice().reverse().map(r=>({id:r.id,status:r.status,assetId:r.resultingAssetId||r.assetId,cells:[`#${r.id} · ${asset(s,r.assetId)}${r.resultingAssetId&&r.resultingAssetId!==r.assetId?`\n回库台账：${asset(s,r.resultingAssetId)}`:''}`,`${r.quantity} 件 · ${r.provider}`,r.reason,`${r.actor} · ${date(r.at)}\n${r.finishedBy||''} ${date(r.finishedAt)}`,`${r.status==='OPEN'?'办理中':r.result==='PASS'?'合格回库':'不合格转报废审核'}\n${r.certificate||''}`],actions:[['detail','工具详情'],...(r.status==='OPEN'?[['service-finish','登记结果']]:[])]}))}
 if(kind==='disposals')return {heads:['申请单 / 工具','类型 / 数量','原因','申请 / 审核人','状态 / 意见'],rows:m.disposals.slice().reverse().map(r=>({id:r.id,status:r.status,cells:[`#${r.id} · ${asset(s,r.assetId)}`,`${label(r.kind)} · ${r.quantity} 件`,r.reason,`${r.actor} · ${date(r.at)}\n${r.reviewer||'待审核'} · ${date(r.reviewedAt)}`,`${label(r.status)}\n${r.opinion||''}`],actions:[['disposal-detail','申请详情'],...(r.status==='PENDING'?[['disposal-review','审核申请']]:[])]}))}
 if(kind==='warnings')return {heads:['对象','预警类型','提示'],rows:toolAlerts(s).map((r,i)=>({id:i+1,status:r.type,cells:[r.name,({LOW_STOCK:'库存低储',WAREHOUSE_LOW_STOCK:'分库低储',INSPECTION_MISSING:'检定缺失',INSPECTION_DUE:'检定到期',OVERDUE:'借用超期',DEVICE_ERROR:'设备异常'})[r.type]||r.type,r.message],actions:r.assetId?[['detail','工具详情'],...(r.type.startsWith('INSPECTION')?[['inspection','办理送检']]:[])]:r.loanId?[['return','办理归还']]:r.eventId?[['resolve','记录处置']]:[['tool-edit','调整阈值']],target:r.assetId||r.loanId||r.eventId||r.toolId}))}
 if(kind==='events')return {heads:['时间 / 设施','事件 / 来源','结果','内容','处置记录'],rows:m.events.slice().reverse().map(r=>({id:r.id,status:r.status,todo:r.status==='ERROR'&&!r.resolvedAt,cells:[`${date(r.at)} · ${r.deviceName||'作业工具核验'}`,`${label(r.type)} · ${label(r.source)}`,`${label(r.status)}${r.status==='ERROR'?(r.resolvedAt?' · 已处置':' · 待处置'):''}`,r.message,`${r.resolution||'—'}\n${date(r.resolvedAt)}`],actions:r.status==='ERROR'&&!r.resolvedAt?[['resolve','记录处置']]:[]}))}
 return {heads:['记录号','时间','经办人','业务','明细'],rows:m.audit.slice().reverse().map(r=>({id:r.id,status:r.action,cells:[r.id,date(r.at),r.actor,actionNames[r.action]||r.action,auditSummary(s,r)],actions:[['audit-detail','查看变更明细']]}))}
}

export function openToolRecords(ctx,deps,initial='loans',options={}){
 if(options.container)return openToolBusinessPage(ctx,deps,options)
 if(['loans','transfers','inspection','repair','disposals'].includes(initial)){
   const modal=openModal({title:'工具业务记录',wide:true,confirmText:'关闭',body:'<div data-business-record-dialog></div>'})
   openToolBusinessPage(ctx,deps,{container:modal.querySelector('[data-business-record-dialog]'),view:{kind:initial},ids:options.ids});return modal
 }
 let kind=initial==='events'?'events':'audit',query='',status='',selected=null
 const body=`<form class="tool-log-query" data-log-form><label class="tool-field"><span>日志类型</span><select class="select" data-log-kind><option value="audit">操作日志</option><option value="events">设施事件</option></select></label><label class="tool-field"><span>查询工具、人员或内容</span><input class="input" data-log-query type="search"></label><label class="tool-field"><span>状态</span><select class="select" data-log-status><option value="">全部状态</option><option value="todo">办理中</option><option value="done">已完结</option></select></label><button class="btn btn-primary" type="submit">查询</button><button class="btn" type="button" data-log-reset>重置</button></form><div data-record-table></div><div class="tool-bottom-buttons" data-record-actions></div><div class="tool-bottom-buttons"><button class="btn" data-record-export>导出当前日志</button></div>`
 const modal=openModal({title:'操作日志与设施事件',wide:true,confirmText:'关闭',body})
 const pending=r=>Boolean(r.todo??false)
 const rows=()=>toolRecordData(ctx.state,kind).rows.filter(r=>(!options.ids?.length||options.ids.includes(r.id))&&(!status||(status==='todo'?pending(r):!pending(r)))&&r.cells.join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const show=()=>{const data=toolRecordData(ctx.state,kind),visible=rows();if(!visible.some(r=>r.id===selected))selected=null
  modal.querySelector('[data-record-table]').innerHTML=deps.table(['选择',...data.heads],visible.map(r=>[`<input type="radio" name="tool-log" data-record-id="${r.id}" aria-label="选择记录${r.id}" ${r.id===selected?'checked':''}>`,...r.cells.map(c=>`<span class="tool-record-text">${esc(c)}</span>`)]))
  const actions=()=>{const box=modal.querySelector('[data-record-actions]');box.innerHTML=recordQueryActions(ctx.state,kind,visible.find(r=>r.id===selected));box.querySelectorAll('[data-record-action]').forEach(b=>b.addEventListener('click',()=>openModalChild(modal,()=>deps.handle(ctx,b.dataset.recordAction,Number(b.dataset.recordTarget)),show)))}
  modal.querySelectorAll('[data-record-id]').forEach(e=>e.addEventListener('change',()=>{selected=Number(e.dataset.recordId);actions()}));actions()
 }
 modal.querySelector('[data-log-kind]').value=kind
 modal.querySelector('[data-log-form]').addEventListener('submit',e=>{e.preventDefault();const next=modal.querySelector('[data-log-kind]').value;if(next!==kind)options.ids=null;kind=next;query=modal.querySelector('[data-log-query]').value.trim();status=modal.querySelector('[data-log-status]').value;show()})
 modal.querySelector('[data-log-reset]').addEventListener('click',()=>{query='';status='';options.ids=null;modal.querySelector('[data-log-query]').value='';modal.querySelector('[data-log-status]').value='';show()})
 modal.querySelector('[data-record-export]').addEventListener('click',()=>deps.downloadCsv('工具日志.csv',[toolRecordData(ctx.state,kind).heads,...rows().map(r=>r.cells)]))
 show();return modal
}


function openToolBusinessPage(ctx,deps,options){
 const root=options.container,v=options.view||{},business={loans:'借还',transfers:'调拨',inspection:'送检',repair:'送修',disposals:'遗失 / 报废'}
 let kind=business[v.kind]?v.kind:'loans',query=v.query||'',status=['todo','done'].includes(v.status)?v.status:'',actor=v.actor||'',since=v.since||'',warehouse=v.warehouse||'',borrowType=v.borrowType||'',selected=v.selected??null
 const pending=r=>['OPEN','PENDING'].includes(r.status)
 const meta=r=>{const m=ctx.state.toolManagement;return (kind==='loans'?m.loans:kind==='transfers'?m.transfers:kind==='disposals'?m.disposals:m.services).find(x=>x.id===r.id)||{}}
 const events=m=>[{actor:m.actor,at:m.at},{actor:m.finishedBy,at:m.finishedAt},{actor:m.receivedBy,at:m.finishedAt},{actor:m.reviewer,at:m.reviewedAt},...(m.returns||[])].filter(e=>e.at)
 const latest=r=>Math.max(0,...events(meta(r)).map(e=>new Date(e.at).getTime()))
 const filtered=()=>toolRecordData(ctx.state,kind).rows.filter(r=>(!options.ids?.length||options.ids.includes(r.id))&&(!status||(status==='todo'?pending(r):!pending(r)))&&(kind!=='loans'||((!borrowType||meta(r).borrowType===borrowType)&&(!warehouse||(meta(r).lines||[]).some(l=>String(l.warehouseId)===warehouse&&(status!=='todo'||l.quantity-l.returned-(l.disposed||0)>0)))))&&r.cells.join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())&&events(meta(r)).some(e=>(!actor||String(e.actor||'').toLocaleLowerCase().includes(actor.toLocaleLowerCase()))&&(!since||new Date(e.at).getTime()>=new Date(since).getTime()))).sort((a,b)=>latest(b)-latest(a))
 const projection=()=>{const data=toolRecordData(ctx.state,kind),indices=data.heads.map((h,i)=>h==='状态'?-1:i).filter(i=>i>=0);return {heads:[...indices.map(i=>data.heads[i].replace('状态 / 意见','业务结果 / 意见')),'办理状态'],cells:r=>[...indices.map(i=>kind==='loans'&&i===3?`最近办理 ${date(new Date(latest(r)).toISOString())}\n开单 ${date(meta(r).at)}\n应还 ${date(meta(r).dueAt)}`:r.cells[i]),pending(r)?`办理中${kind==='loans'&&new Date(meta(r).dueAt).getTime()<Date.now()?' · 超期':''}`:'已完结']}}
 root.innerHTML=businessQueryMarkup(ctx.state,{kind,query,status,actor,since,warehouse,borrowType,business})
 root.querySelector('[data-record-status]').value=status
 root.querySelector('[data-record-warehouse]').value=warehouse;root.querySelector('[data-record-borrow-type]').value=borrowType
 const controls=()=>({kind:root.querySelector('[data-record-kind]').value,query:root.querySelector('[data-record-query]').value.trim(),status:root.querySelector('[data-record-status]').value,actor:root.querySelector('[data-record-actor]').value.trim(),since:root.querySelector('[data-record-since]').value,warehouse:root.querySelector('[data-record-warehouse]').value,borrowType:root.querySelector('[data-record-borrow-type]').value})
 const dirty=()=>JSON.stringify(controls())!==JSON.stringify({kind,query,status,actor,since,warehouse,borrowType})
 if(v.draft)for(const [key,selector] of Object.entries({kind:'kind',status:'status',query:'query',actor:'actor',since:'since',warehouse:'warehouse',borrowType:'borrow-type'})){if(v.draft[key]!==undefined)root.querySelector(`[data-record-${selector}]`).value=v.draft[key]}
 const show=()=>{
  root.querySelector('[data-record-loan-filters]').hidden=true
  root.querySelector('[data-record-status]').options[1].textContent='办理中';root.querySelector('[data-record-status]').options[2].textContent='已完结'
  const rows=filtered(),p=projection();if(!rows.some(r=>r.id===selected))selected=null
  Object.assign(v,{kind,query,status,actor,since,warehouse,borrowType,selected});root.querySelector('[data-record-count]').textContent=`${business[kind]}记录 · ${rows.length} 条`
  root.querySelector('[data-record-applied]').textContent='已应用：'+[business[kind],status==='todo'?'办理中':status==='done'?'已完结':'全部状态',kind==='loans'&&warehouse&&`工具库 ${name(ctx.state.toolManagement.warehouses,Number(warehouse))}`,kind==='loans'&&borrowType&&`借用类型 ${borrowType}`,query&&`关键词 ${query}`,actor&&`经办人 ${actor}`,since&&`办理时间 ≥ ${since.replace('T',' ')}`].filter(Boolean).join(' · ')
  root.querySelector('[data-record-applied]').hidden=!(query||actor||since||warehouse||borrowType)
  root.querySelector('[data-record-pending]').hidden=!dirty();root.querySelector('[data-record-export]').textContent=`导出当前 ${rows.length} 条记录`
  root.querySelector('[data-record-table]').innerHTML=deps.table(['选择',...p.heads],rows.map(r=>[`<input type="radio" name="tool-record" data-record-id="${r.id}" aria-label="选择记录${r.id}" ${r.id===selected?'checked':''}>`,...p.cells(r).map(c=>`<span class="tool-record-text">${esc(c)}</span>`)]))
  const actions=()=>{const row=rows.find(r=>r.id===selected),box=root.querySelector('[data-record-actions]');box.innerHTML=recordQueryActions(ctx.state,kind,row);box.querySelectorAll('[data-record-action]').forEach(button=>button.addEventListener('click',()=>{if(dirty()){root.querySelector('[data-record-pending]').hidden=false;root.querySelector('[data-record-form] button[type=submit]').focus();return}const child=deps.handle(ctx,button.dataset.recordAction,Number(button.dataset.recordTarget));child?.addEventListener?.('modal:closed',()=>{if(root.isConnected)show()},{once:true})}))}
  root.querySelectorAll('[data-record-id]').forEach(el=>el.addEventListener('change',()=>{selected=Number(el.dataset.recordId);v.selected=selected;actions()}));actions()
 }
 const apply=()=>{if(controls().kind!==kind)options.ids=null;({kind,query,status,actor,since,warehouse,borrowType}=controls());v.draft=null;selected=null;show()}
 root.querySelector('[data-record-form]').addEventListener('submit',e=>{e.preventDefault();apply()})
 root.querySelectorAll('[data-record-form] select').forEach(el=>el.addEventListener('change',()=>{v.draft=dirty()?controls():null;root.querySelector('[data-record-pending]').hidden=!dirty()}))
 root.querySelectorAll('[data-record-form] input').forEach(el=>el.addEventListener('input',()=>{v.draft=dirty()?controls():null;root.querySelector('[data-record-pending]').hidden=!dirty()}))
 root.querySelector('[data-record-reset]').addEventListener('click',()=>{options.ids=null;query='';status='';actor='';since='';warehouse='';borrowType='';v.draft=null;root.querySelector('[data-record-kind]').value=kind;for(const sel of ['query','status','actor','since','warehouse','borrow-type'])root.querySelector(`[data-record-${sel}]`).value='';selected=null;show()})
 root.querySelector('[data-record-audit]').addEventListener('click',()=>openToolRecords(ctx,deps,'audit',{ids:[]}))
 root.querySelector('[data-record-export]').addEventListener('click',()=>{if(dirty()){root.querySelector('[data-record-pending]').hidden=false;root.querySelector('[data-record-form] button[type=submit]').focus();return}const p=projection();deps.downloadCsv('工具'+business[kind]+'记录.csv',[p.heads,...filtered().map(p.cells)])})
 show();return root
}
