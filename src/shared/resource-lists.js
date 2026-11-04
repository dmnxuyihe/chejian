import { contextIcon } from './workspace-art.js'
import { buildResourceReport } from '../core/resource-report.js'
import { escapeHtml as esc, openModal, toast } from '../core/ui.js'
import { fmtFullDateTime } from '../core/derived.js'
import { updateResource } from '../core/actions.js'
import { createResourceDemo } from '../core/resource-demo.js'

const n = value => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(value)
const hours = minutes => `${n(minutes/60)} 小时`
const basis = use => ({process:'工艺表用量',demo:'演示用量',manual:'已核对用量'}[use.basis]||'用量待核对')
const time = use => use.timed?`${fmtFullDateTime(use.plannedStartAt)}—${fmtFullDateTime(use.plannedEndAt)}`:'尚未排程'
const labelKind = report => !report.rows.length?'暂无有效任务':report.rows.some(r=>r.planKind==='preview')?'模拟预览':report.rows.some(r=>r.planKind==='draft')?'待确认安排':report.unscheduled?'待排程':'正式排程'
const edit = (kind,id,readOnly) => readOnly?'':`<button class="btn btn-sm" data-resource-edit="${kind}" data-resource-id="${id}">核对可用量</button>`
const taskNames = rows => [...new Set(rows.map(r=>`${r.vehicle.locomotiveNo} · ${r.task.name}`))].map(v=>esc(v)).join('、')
function table(headers,rows,empty){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`}
function notices(report){
  const gaps=[...report.staffing.map(r=>({...r,name:r.team.name,unit:'人'})),...report.tools,...report.materials].filter(r=>r.gap>0)
  const warnings=[...gaps.map(r=>`${r.name}缺少 ${n(r.gap)} ${r.unit}；受影响任务：${[...new Set(r.affectedTasks.map(u=>`${u.vehicle.locomotiveNo} · ${u.task.name}`))].join('、')}`),...(report.pendingAssignments.length?['部分任务尚未落实到可用人员，请核对人员安排。']:[])]
  return `${report.unscheduled?'<p class="pc-help">部分车辆尚未排程：已核对总工时、累计物料和单项用量；工具及人员的联合占用须在模拟后再次核对。</p>':''}${warnings.length||report.issues.length?`<div class="resource-alert" role="status"><strong>资源准备有待处理项</strong><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>${report.issues.length?`<details><summary>查看 ${report.issues.length} 项人员安排或资料问题</summary><ul>${report.issues.map(i=>`<li>${esc(i.message)}</li>`).join('')}</ul></details>`:''}</div>`:report.ready?'<p class="resource-ok" role="status">当前人员、工具与物料核对通过。</p>':'<p class="pc-help" role="status">待任务时间及人员安排明确后，再完成资源核对。</p>'}`
}
function shortageSummary(report,readOnly){
  return `${notices(report)}<div class="resource-summary"><span>计划人员工时 <strong>${hours(report.personMinutes)}</strong></span><span>已派工时 <strong>${hours(report.assignedMinutes)}</strong></span><span>资源缺口 <strong>${report.shortageCount} 项</strong></span><span>${labelKind(report)}</span></div>
  ${table(['班组','计划人员工时','最大同时需求','可用人数','缺口','受影响任务'],report.staffing.map(r=>`<tr><td>${esc(r.team.name)}</td><td>${hours(r.personMinutes)}</td><td>${n(r.peak)} 人</td><td>${r.available} 人</td><td class="${r.gap?'pc-error-text':''}">${n(r.gap)} 人</td><td>${taskNames(r.affectedTasks)||'—'}</td></tr>`),'当前车辆暂无班组需求')}`
}
function resourceTables(report,readOnly,listTab){
 const usedPeople=new Set(report.people.map(p=>p.employee.id)).size
 const people=[...new Set(report.people.map(p=>p.employee.id))].map(id=>{const uses=report.people.filter(p=>p.employee.id===id);return {...uses[0],uses,workMinutes:uses.reduce((n,p)=>n+p.workMinutes,0),unavailable:uses.some(p=>p.unavailable)}})
 const demandButton=(kind,u)=>readOnly?'':`<button class="btn btn-sm" data-resource-demand="${kind}" data-requirement-id="${u.requirementId}">核对用量</button>`
 return `<div class="tabs resource-tabs" role="tablist" aria-label="资源清单">${[['people','人员',usedPeople],['tools','工具',report.tools.length],['materials','物料',report.materials.length]].map(([key,name,count])=>`<button class="tab ${listTab===key?'active':''}" id="resource-tab-${key}" role="tab" aria-selected="${listTab===key}" aria-controls="resource-panel-${key}" data-resource-tab="${key}">${contextIcon(name,16)}${name} · ${count}</button>`).join('')}</div><div id="resource-panel-people" class="resource-tab-panel" role="tabpanel" aria-labelledby="resource-tab-people" ${listTab==='people'?'':'hidden'}><h3 class="resource-subtitle">人员清单 <span>${usedPeople} 人 · 已派 ${hours(report.assignedMinutes)}</span></h3>
 ${table(['班组','人员','关联任务与作业时段','计划工作时长','安排情况'],people.map(p=>`<tr data-resource-person="${p.employee.id}"><td>${esc(p.teamName)}</td><td>${esc(p.employee.name)}<small class="resource-line">${esc(p.employee.no)}</small></td><td><details><summary>${p.uses.length} 项任务</summary>${p.uses.map(u=>`<div class="resource-use"><strong>${esc(u.task.name)}</strong><span>${time(u)}</span><span>计划工作 ${hours(u.workMinutes)}</span></div>`).join('')}</details></td><td>${hours(p.workMinutes)}</td><td>${p.unavailable?'人员不可用':p.planKind==='preview'?'拟派工':'已安排'}</td></tr>`),report.rows.length?'暂无具体人员安排；班组需求见上表。':'尚无检修任务')}</div>
 <div id="resource-panel-tools" class="resource-tab-panel" role="tabpanel" aria-labelledby="resource-tab-tools" ${listTab==='tools'?'':'hidden'}><h3 class="resource-subtitle">工具清单 <span>工具可重复使用，按同时占用核对</span></h3>
 ${table(['工具名称','最大同时需求','可用数量','缺口','关联任务与计划使用','维护'],report.tools.map(r=>`<tr><td>${esc(r.name)}</td><td>${n(r.peak)} 件</td><td>${r.available} 件</td><td class="${r.gap?'pc-error-text':''}">${n(r.gap)} 件</td><td><details><summary>查看 ${r.uses.length} 项任务</summary>${r.uses.map(u=>`<div class="resource-use"><strong>${esc(u.task.name)}</strong><span>需求 ${n(u.quantity)} 件 · 计划使用 ${u.usedQuantity==null?'待安排':n(u.usedQuantity)+' 件'}</span><span>${time(u)}</span><span>${basis(u)}${demandButton('tools',u)}</span></div>`).join('')}</details></td><td>${edit('tools',r.resource?.id,readOnly)}</td></tr>`),'工艺表未列明本车任务的工具需求')}
 </div><div id="resource-panel-materials" class="resource-tab-panel" role="tabpanel" aria-labelledby="resource-tab-materials" ${listTab==='materials'?'':'hidden'}><h3 class="resource-subtitle">物料清单 <span>按当前车辆累计需求核对，不自动扣减库存</span></h3>
 ${table(['物料名称','需求数量','可用量','缺口','关联任务与用量','维护'],report.materials.map(r=>`<tr><td>${esc(r.name)}</td><td>${n(r.quantity)} ${esc(r.unit)}</td><td>${n(r.available)} ${esc(r.unit)}</td><td class="${r.gap?'pc-error-text':''}">${n(r.gap)} ${esc(r.unit)}</td><td><details><summary>查看 ${r.uses.length} 项任务</summary>${r.uses.map(u=>`<div class="resource-use"><strong>${esc(u.task.name)}</strong><span>需求 ${n(u.quantity)} ${esc(r.unit)} · ${basis(u)}</span><span>${time(u)}</span>${demandButton('materials',u)}</div>`).join('')}</details></td><td>${edit('materials',r.resource?.id,readOnly)}</td></tr>`),'工艺表未列明本车任务的物料需求')}</div>`
}
export function renderVehicleResources(state,vehicleId,readOnly=false){
 const report=buildResourceReport(state,[vehicleId])
 return `<section class="card resource-lists" data-resource-lists><div class="card-title-row"><div><h2 class="card-title">人员、工具与物料</h2><p class="pc-help">${esc(report.vehicles[0]?.locomotiveNo||'当前车辆')} · ${labelKind(report)}。切换车辆及调整排程后同步核对。</p></div></div>${shortageSummary(report,readOnly)}${report.hasDemoQuantities?'<p class="pc-help">工艺表未给定数量的项目采用演示用量，正式使用前请逐项核对；原表明确的紧固件数量已按原值保留。</p>':''}${resourceTables(report,readOnly,state.planningView?.resourceListTab||'people')}</section>`
}
export function resourceVehicleIds(state,view){
 if(view.resourceVehicleIds!==undefined)return view.resourceVehicleIds.filter(id=>state.vehicleRepairs.some(v=>v.id===id&&v.status!=='CANCELLED'))
 const demo=state.vehicleRepairs.filter(v=>/^HXD1C-DEMO0[12]$/.test(v.locomotiveNo)&&v.status!=='CANCELLED').map(v=>v.id)
 return demo.length?demo:[state.selectedVehicleRepairId||state.vehicleRepairs[0]?.id].filter(Boolean)
}
export function renderResourcePreparation(state,view,readOnly=false){
 const ids=resourceVehicleIds(state,view),report=buildResourceReport(state,ids)
 return `<section class="card resource-preparation" data-resource-preparation><div class="card-title-row"><div><h2 class="card-title">两车资源准备</h2><p class="pc-help">选择本次检修车辆。人员与工具按共享时段核对，物料按所选车辆累计需求核对。</p></div>${readOnly?'':`<div class="table-actions"><button class="btn btn-sm" data-resource-demo="normal">下载资源齐备演示</button><button class="btn btn-sm" data-resource-demo="shortage">下载资源不足演示</button></div>`}</div><div class="resource-vehicles">${state.vehicleRepairs.filter(v=>v.status!=='CANCELLED').map(v=>`<label><input type="checkbox" data-resource-vehicle="${v.id}" ${ids.includes(v.id)?'checked':''}>${esc(v.locomotiveNo)}<small>入段 ${esc(v.plannedEntryAt.slice(0,10))}</small></label>`).join('')}</div><p class="pc-help">演示资料包含 10 月 27、28 日入段的两辆车及未确认的作业安排。下载不改变当前数据；可通过“保存与恢复”核对后载入。</p><button class="btn" data-resource-check>核对资源</button><div data-resource-check-result>${report.vehicles.length?shortageSummary(report,readOnly):'<p class="pc-help">请选择需要核对的车辆。</p>'}${report.vehicles.length?'<details class=resource-all-demands><summary>查看工具与物料需求明细</summary>'+table(['资源','需求','可用量','缺口','受影响任务'],[...report.tools.map(r=>({name:r.name,need:r.peak,unit:r.unit,...r})),...report.materials.map(r=>({need:r.quantity,...r}))].map(r=>`<tr><td>${esc(r.name)}</td><td>${n(r.need)} ${esc(r.unit)}</td><td>${n(r.available)} ${esc(r.unit)}</td><td class="${r.gap?'pc-error-text':''}">${n(r.gap)} ${esc(r.unit)}</td><td>${taskNames(r.affectedTasks)||'—'}</td></tr>`),'暂无工具或物料需求')+'</details>':''}</div></section>`
}
export function mountResourceLists(ctx,view,readOnly=false){
 document.querySelectorAll('[data-resource-tab]').forEach(b=>b.addEventListener('click',()=>{view.resourceListTab=b.dataset.resourceTab;ctx.rerender();document.querySelector(`[data-resource-tab="${view.resourceListTab}"]`)?.focus({preventScroll:true})}))
 document.querySelectorAll('[data-resource-vehicle]').forEach(input=>input.addEventListener('change',()=>{view.resourceVehicleIds=[...document.querySelectorAll('[data-resource-vehicle]:checked')].map(i=>Number(i.dataset.resourceVehicle));ctx.rerender()}))
 document.querySelector('[data-resource-check]')?.addEventListener('click',()=>{ctx.rerender();document.querySelector('[data-resource-check-result]')?.scrollIntoView({block:'center',behavior:'smooth'})})
 if(readOnly)return
 document.querySelectorAll('[data-resource-demo]').forEach(b=>b.addEventListener('click',()=>{
  const shortage=b.dataset.resourceDemo==='shortage',url=URL.createObjectURL(new Blob([JSON.stringify(createResourceDemo(shortage),null,2)],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`两车检修_${shortage?'资源不足':'资源齐备'}演示.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }))
 document.querySelectorAll('[data-resource-edit]').forEach(b=>b.addEventListener('click',()=>{
  const kind=b.dataset.resourceEdit,id=Number(b.dataset.resourceId),r=ctx.state[kind]?.find(r=>r.id===id);if(!r)return
  openModal({title:`核对${r.name}可用量`,body:`<div class="field"><label for="supply-quantity">可用数量${r.unit?'（'+esc(r.unit)+'）':''}</label><input class="input" id="supply-quantity" type="number" min="0" step="${kind==='tools'?'1':'0.001'}" value="${r.quantity}"></div><div class="field"><label for="supply-status">资源状态</label><select class="select" id="supply-status"><option value="AVAILABLE" ${r.status==='AVAILABLE'?'selected':''}>可用</option>${kind==='tools'?`<option value="MAINTENANCE" ${r.status==='MAINTENANCE'?'selected':''}>维护中</option>`:''}<option value="DISABLED" ${r.status==='DISABLED'?'selected':''}>停用</option></select></div>`,onConfirm(modal){const input=modal.querySelector('#supply-quantity'),quantity=Number(input.value);if(!input.value||!input.checkValidity()||!Number.isFinite(quantity)||(kind==='tools'&&!Number.isInteger(quantity))){toast('数量无效','请填写有效的非负数量','warning');return false}const result=updateResource(ctx.state,kind,id,{quantity,status:modal.querySelector('#supply-status').value});if(!result.ok){toast('未保存',result.message,'warning');return false}ctx.rerender();toast('资源已更新','已重新核对当前车辆的资源需求')}})
 }))
 document.querySelectorAll('[data-resource-demand]').forEach(b=>b.addEventListener('click',()=>{
  const kind=b.dataset.resourceDemand,key=kind==='tools'?'toolRequirements':'materialRequirements',req=ctx.state[key].find(r=>r.id===Number(b.dataset.requirementId));if(!req)return
  const task=ctx.state.tasks.find(t=>t.id===req.taskId),resource=ctx.state[kind].find(r=>r.id===(req.toolId??req.materialId))
  openModal({title:'核对任务用量',body:`<p><strong>${esc(task?.name||'检修任务')} · ${esc(resource?.name||'资源')}</strong></p><p class="pc-help">同一检修工序的所有车辆共用此用量；保存后重新核对两车需求。</p><div class="field"><label for="task-quantity">每项任务的需求数量${resource?.unit?'（'+esc(resource.unit)+'）':''}</label><input id="task-quantity" class="input" type="number" min="${kind==='tools'?1:0.001}" step="${kind==='tools'?1:0.001}" value="${req.quantity}"></div>`,onConfirm(modal){const input=modal.querySelector('#task-quantity'),quantity=Number(input.value);if(!input.value||!input.checkValidity()||!Number.isFinite(quantity)||quantity<=0){toast('用量无效','需求数量必须大于零','warning');return false}req.quantity=quantity;req.quantityBasis='manual';ctx.rerender();toast('用量已核对','已更新相关车辆的资源需求')}})
 }))
}
