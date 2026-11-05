import { pageHeader } from '../../../shared/templates.js'
import { icon, actionIcon } from '../../../shared/icons.js'
import { locomotiveDrawing } from '../../../shared/rail-visuals.js'
import { escapeHtml as esc, openModal, toast } from '../../../core/ui.js'
import { dateKey, monthDays, confirmedExit } from '../../../core/planning-view.js'
import { fmtFullDateTime, formatLocalDateTime } from '../../../core/derived.js'
import { pc1Preflight, simulatePc1, pc1PreviewIssues, movePc1Task, togglePc1Lock, confirmPc1Preview, canPlanVehicle } from '../../../core/pc1-simulation.js'
import { commitImport, parseCsv, templateCsv } from '../../../core/plan-import.js'
import { exportDemoSnapshot } from '../../../core/demo-persistence.js'
import { renderTaskDetails, openTaskDetails } from '../../../shared/task-details.js'
import { renderVehicleResources, mountResourceLists } from '../../../shared/resource-lists.js'
import { planMaintenanceActions, mountPlanMaintenance } from '../../../shared/plan-maintenance.js'

const DAY = 86400000
const view = { initialized: false, month: '', ids: [], deadline: '', showPreflight: false, message: '', dayWidth: 192, timelineVehicle: '', taskVehicleId: null, taskId: null, taskMessage: '', inspectorOpen: true, publishedVehicleId: null }
const equalIds = (a,b) => [...a].sort((x,y) => x-y).join(',') === [...b].sort((x,y) => x-y).join(',')
const localInput = value => String(value || '').slice(0,16)

function initialize(state) {
  if (!view.initialized) {
    view.ids = state.pc1SchedulePreview?.vehicleRepairIds || state.planningView?.resourceVehicleIds || []
    view.deadline = state.pc1SchedulePreview?.deadline || ''
    view.month = dateKey(state.vehicleRepairs.find(row => view.ids.includes(row.id))?.plannedEntryAt || new Date()).slice(0,7)
    view.initialized = true
  }
  view.ids = view.ids.filter(id => state.vehicleRepairs.some(row => row.id === id))
  if (!view.deadline && view.ids.length) view.deadline = defaultDeadline(state)
  state.planningView ||= { tab: 'monthly', month: view.month, vehicleFilter: '', day: '' }
  state.planningView.resourceVehicleIds = [...view.ids]
}

function defaultDeadline(state) {
  const selected = state.vehicleRepairs.filter(row => view.ids.includes(row.id))
  if (!selected.length) return ''
  const latest = Math.max(...selected.map(row => new Date(row.plannedExitAt || new Date(new Date(row.plannedEntryAt).getTime() + 14 * DAY)).getTime()))
  return formatLocalDateTime(latest)
}

const vehicleStage=row=>({SUBMITTED:'待审核',REVIEWED:'待审批发布',PUBLISHED:'已发布',REJECTED:'已驳回',REVISING:'待修改'})[row.approvalStatus]||(row.currentVersionId?'已排程':'未模拟')

function selectionCalendar(state) {
  return `<div class="pc1-plan-calendar" role="grid" aria-label="选择月度检修车辆">${['一','二','三','四','五','六','日'].map(day => `<div class="pc1-calendar-weekday">周${day}</div>`).join('')}${monthDays(view.month).map(day => {
    const entries = state.vehicleRepairs.filter(row => dateKey(row.plannedEntryAt) === day && !['CANCELLED','CANCELED'].includes(row.status))
    const exits = state.vehicleRepairs.filter(row => dateKey(confirmedExit(state,row.id)) === day)
    return `<div class="pc1-selection-day ${day.startsWith(view.month) ? '' : 'is-outside'}"><strong>${Number(day.slice(-2))}</strong>${entries.map(row => row.approvalStatus==='PUBLISHED'?`<button type="button" class="pc1-calendar-vehicle pc1-calendar-published ${view.publishedVehicleId===row.id?'is-selected':''}" data-pc1-view-published="${row.id}" title="查看${esc(row.locomotiveNo)}当前正式排程"><span>${esc(row.locomotiveNo)}<small>已发布 · 点击查看</small></span></button>`:`<label class="pc1-calendar-vehicle ${view.ids.includes(row.id) ? 'is-selected' : ''}" title="计划入段：${esc(row.locomotiveNo)}；当前状态：${vehicleStage(row)}${canPlanVehicle(state,row) ? '' : '；当前状态不能排程'}"><input type="checkbox" data-pc1-select-vehicle="${row.id}" ${view.ids.includes(row.id) ? 'checked' : ''} ${canPlanVehicle(state,row) || view.ids.includes(row.id) ? '' : 'disabled'}><span>${esc(row.locomotiveNo)}<small>${vehicleStage(row)}</small></span></label>`).join('')}${exits.map(row => `<span class="pc1-calendar-exit">出段 · ${esc(row.locomotiveNo)}</span>`).join('')}</div>`
  }).join('')}</div>`
}

function publishedVehiclePanel(state) {
  const vehicle=state.vehicleRepairs.find(row=>row.id===view.publishedVehicleId)
  if(!vehicle)return''
  const version=state.scheduleVersions.find(row=>row.id===vehicle.currentVersionId)
  const rows=state.schedules.filter(row=>row.vehicleRepairId===vehicle.id&&row.versionId===vehicle.currentVersionId&&row.status!=='CANCELLED').sort((a,b)=>a.plannedStartAt.localeCompare(b.plannedStartAt))
  const actions=planMaintenanceActions(state,vehicle.id,{showHelp:false}).replace('查看排程计划','查看目前排程').replace('申请调整','申请重排')
  return `<aside class="card pc1-published-panel"><div class="desk-panel-head"><div><span class="plan-status">已发布</span><h2>${esc(vehicle.locomotiveNo)}</h2><p>当前正式排程 V${version?.versionNo||1}</p></div></div><dl class="pc1-published-summary"><div><dt>计划入段</dt><dd>${esc(fmtFullDateTime(vehicle.plannedEntryAt))}</dd></div><div><dt>预计出段</dt><dd>${esc(fmtFullDateTime(confirmedExit(state,vehicle.id)||vehicle.plannedExitAt))}</dd></div><div><dt>排程任务</dt><dd>${rows.length} 项</dd></div><div><dt>发布时间</dt><dd>${esc(fmtFullDateTime(version?.publishedAt))}</dd></div></dl><div class="table-actions pc1-published-actions">${actions}</div><div class="table-wrap"><table><thead><tr><th>工序</th><th>开始</th><th>结束</th></tr></thead><tbody>${rows.slice(0,8).map(row=>`<tr><td>${esc(state.tasks.find(task=>task.id===row.taskId)?.name||'工序')}</td><td>${esc(fmtFullDateTime(row.plannedStartAt))}</td><td>${esc(fmtFullDateTime(row.plannedEndAt))}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">暂无正式排程任务</td></tr>'}</tbody></table></div></aside>`
}

function resourceSummary(report) {
  return `<div class="table-wrap"><table class="pc1-preflight-table"><thead><tr><th>资源</th><th>类型</th><th>需求</th><th>可用</th><th>缺口</th></tr></thead><tbody>${[...report.staffing.map(row => ({ name:row.team.name,kind:'人员',need:row.peak,available:row.available,gap:row.gap,unit:'人' })),...report.tools.map(row => ({...row,kind:'工具',need:row.peak})),...report.materials.map(row => ({...row,kind:'物料',need:row.quantity}))].map(row => `<tr><td>${esc(row.name)}</td><td>${row.kind}</td><td>${row.need} ${esc(row.unit)}</td><td>${row.available} ${esc(row.unit)}</td><td class="${row.gap ? 'pc-error-text' : ''}">${row.gap} ${esc(row.unit)}</td></tr>`).join('')}</tbody></table></div>`
}

function selectedTask(preview) {
  const rows=preview.schedules.filter(row=>!view.timelineVehicle || row.vehicleRepairId===Number(view.timelineVehicle))
  const row=rows.find(row=>row.vehicleRepairId===view.taskVehicleId && row.taskId===view.taskId) || rows[0]
  if(row){view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId}
  return row
}

function renderTaskInspector(state, preview) {
  if(!view.inspectorOpen)return ''
  const row=selectedTask(preview)
  if(!row)return '<aside class="card pc1-task-inspector"><h2>任务详情</h2><p>点击甘特图中的任务查看。</p></aside>'
  const task=state.tasks.find(item=>item.id===row.taskId),vehicle=state.vehicleRepairs.find(item=>item.id===row.vehicleRepairId)
  return `<aside class="card pc1-task-inspector" id="pc1-task-inspector" aria-label="当前任务详情"><div class="pc1-inspector-heading"><div><span>当前任务 · ${row.isLocked?'时间锁定':'可调整'}</span><h2>${esc(task?.name || '检修任务')}</h2><small>${esc(vehicle?.locomotiveNo)}</small></div><button type="button" class="btn btn-icon btn-sm" data-pc1-close-inspector aria-label="收起任务详情">${icon('close',16)}</button></div><form class="pc1-task-time-editor" data-pc1-task-time-editor><label for="pc1-detail-start">精确开始时间</label><input class="input" id="pc1-detail-start" data-pc1-detail-start type="datetime-local" step="60" value="${localInput(row.plannedStartAt)}" ${row.isLocked?'disabled':''} required><div><button class="btn btn-primary btn-sm" type="submit" ${row.isLocked?'disabled':''}>${actionIcon('calendar',22)}调整并锁定</button><button class="btn btn-sm" type="button" data-pc1-inspector-lock="${row.id}" aria-pressed="${row.isLocked}">${actionIcon(row.isLocked?'unlock':'lock',22)}${row.isLocked?'解锁时间':'锁定时间'}</button></div><p class="pc-help" role="status" data-pc1-task-message>${esc(view.taskMessage || (row.isLocked?'当前时间已锁定；先解锁可再次调整。':'填写到分钟，任务时长保持不变。'))}</p></form><button class="text-action pc1-full-detail" type="button" data-pc1-full-detail>展开完整任务与资源清单 ↗</button>${renderTaskDetails(state,{...row,planKind:'preview'},{compact:true,showIdentity:false})}</aside>`
}

function refreshTimeline(ctx,persist=false,focusSelector) {
  const old=document.querySelector('[data-pc1-timeline-scroll]')
  const scroll={left:old?.scrollLeft || 0,top:old?.scrollTop || 0,x:window.scrollX,y:window.scrollY}
  ctx.rerender(persist)
  const next=document.querySelector('[data-pc1-timeline-scroll]')
  if(next){next.scrollLeft=scroll.left;next.scrollTop=scroll.top}
  document.querySelector(focusSelector || '[data-pc1-inspector-lock]')?.focus({preventScroll:true})
  window.scrollTo(scroll.x,scroll.y)
}

function selectTask(ctx,id,focusSelector) {
  const row=ctx.state.pc1SchedulePreview?.schedules.find(row=>row.id===Number(id))
  if(!row)return
  view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId;view.taskMessage='';view.inspectorOpen=true
  refreshTimeline(ctx,false,focusSelector)
}

export function renderPc1Timeline(state, preview = state.pc1SchedulePreview) {
  if (!preview?.schedules.length) return '<div class="empty">生成模拟排程后可拖动任务，或点击任务精确设置时间。</div>'
  const rows = preview.schedules.filter(row => !view.timelineVehicle || row.vehicleRepairId === Number(view.timelineVehicle))
    .sort((a,b) => a.vehicleRepairId - b.vehicleRepairId || new Date(a.plannedStartAt) - new Date(b.plannedStartAt))
  const earliest = Math.min(...preview.schedules.map(row => new Date(row.plannedStartAt).getTime()))
  const origin = new Date(`${dateKey(earliest)}T00:00:00`).getTime()
  const days = Math.max(1, Math.ceil((Math.max(...preview.schedules.map(row => new Date(row.plannedEndAt).getTime())) - origin) / DAY))
  const width = days * view.dayWidth
  return `<div class="pc1-timeline-scroll" data-pc1-timeline-scroll><div class="pc1-timeline" style="--pc1-time-width:${width}px"><div class="pc1-timeline-head"><div class="pc1-timeline-label">检修工序</div><div class="pc1-timeline-scale" style="grid-template-columns:repeat(${days},1fr)">${Array.from({length:days},(_,index) => `<span>${esc(dateKey(origin + index * DAY).slice(5))}${view.dayWidth >= 576 ? `<small class="pc1-hour-scale">${[0,6,12,18].map(hour=>`<i>${String(hour).padStart(2,'0')}:00</i>`).join('')}</small>` : ''}</span>`).join('')}</div></div>${rows.map((row,index) => {
    const task = state.tasks.find(task => task.id === row.taskId), vehicle = state.vehicleRepairs.find(vehicle => vehicle.id === row.vehicleRepairId)
    const left = (new Date(row.plannedStartAt).getTime() - origin) / DAY * view.dayWidth
    const size = Math.max(9, (new Date(row.plannedEndAt) - new Date(row.plannedStartAt)) / DAY * view.dayWidth)
    const group = !index || rows[index-1].vehicleRepairId !== row.vehicleRepairId ? `<div class="pc1-timeline-group"><strong>${esc(vehicle?.locomotiveNo)}<small>${rows.filter(item => item.vehicleRepairId === row.vehicleRepairId).length}项任务</small></strong></div>` : ''
    const startLabel = String(row.plannedStartAt).slice(5,16).replace('T',' '), endLabel = dateKey(row.plannedEndAt) === dateKey(row.plannedStartAt) ? String(row.plannedEndAt).slice(11,16) : String(row.plannedEndAt).slice(5,16).replace('T',' ')
    return `${group}<div class="pc1-timeline-row ${view.taskVehicleId === row.vehicleRepairId && view.taskId === row.taskId ? 'is-current-task' : ''}"><div class="pc1-timeline-label"><button type="button" class="pc1-task-select" data-pc1-select-task="${row.id}" aria-pressed="${view.taskVehicleId === row.vehicleRepairId && view.taskId === row.taskId}"><strong>${esc(task?.name)}${row.isLocked ? '<em class="timeline-lock">锁定</em>' : ''}</strong><small>${esc(startLabel)} — ${esc(endLabel)}</small></button><details class="pc1-row-options"><summary aria-label="${esc(task?.name)}任务操作">${icon('menu',14)}</summary><div><button type="button" class="btn btn-sm" data-pc1-edit-task="${row.id}" ${row.isLocked ? 'disabled' : ''}>${actionIcon('calendar',22)}调整时间</button><button type="button" class="btn btn-sm" data-pc1-lock-task="${row.id}" aria-pressed="${row.isLocked}">${actionIcon(row.isLocked?'unlock':'lock',22)}${row.isLocked ? '已锁定 · 解锁' : '锁定时间'}</button></div></details></div><div class="pc1-timeline-track" style="background-size:${view.dayWidth >= 576 ? view.dayWidth/24 : view.dayWidth}px 100%"><button type="button" class="pc1-task-bar ${size < 48 ? 'is-short' : ''} ${row.isLocked ? 'is-locked' : ''}" style="left:${left}px;width:${size}px" data-pc1-drag-task="${row.id}" aria-label="${esc(vehicle?.locomotiveNo)} ${esc(task?.name)}，${row.isLocked ? '已锁定，点击查看详情' : '点击查看详情；可拖动，或按左右方向键调整15分钟'}" title="${esc(task?.name)} ${fmtFullDateTime(row.plannedStartAt)}">${esc(task?.name)}</button></div></div>`
  }).join('')}</div></div><p class="pc-help" data-pc1-drag-tip>拖动按15分钟吸附，按住Shift按1分钟微调；右侧可精确填写开始时间。调整后时间自动锁定，重新模拟时保留。</p>`
}

function editTask(ctx, id) {
  const row = ctx.state.pc1SchedulePreview?.schedules.find(row => row.id === Number(id))
  if (!row || row.isLocked) return
  const task = ctx.state.tasks.find(task => task.id === row.taskId)
  openModal({ title: `调整${task.name}`, confirmText: '调整并锁定', body: `<p>作业时长保持${task.duration}分钟；重新模拟会保留指定时间并调整其他任务。</p><div class="field"><label for="pc1-task-start">任务开始时间</label><input id="pc1-task-start" type="datetime-local" class="input" value="${localInput(row.plannedStartAt)}"></div><p class="pc-error-text" data-pc1-edit-error role="alert"></p>`, onConfirm(modal) {
    const result = movePc1Task(ctx.state, row.id, modal.querySelector('#pc1-task-start').value)
    if (!result.ok) { modal.querySelector('[data-pc1-edit-error]').textContent = result.message; return false }
    view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId;view.inspectorOpen=true
    view.message = result.message; ctx.rerender()
  } })
}

export async function saveConfirmedPc1(ctx,submission={}) {
  const next = structuredClone(ctx.state), result = confirmPc1Preview(next,submission)
  if (!result.ok) { toast('暂不能确认', result.issues[0], 'warning'); return false }
  const saved = await ctx.demoPersistence.restore(JSON.stringify(exportDemoSnapshot(next)))
  if (!saved.ok) { toast('确认未保存', saved.message, 'warning'); return false }
  const missing=result.vehicleIds.filter(id=>!ctx.state.planApprovalFlows.some(flow=>flow.entityType==='MONTHLY'&&flow.entityId===id&&flow.status==='SUBMITTED'))
  if(missing.length){toast('审批记录保存校验失败','数据库返回后未找到待审核记录，请勿重复操作并联系管理员。','warning');return false}
  view.message = `已确认${result.vehicleIds.length}辆车、${result.schedules}项任务，并提交${result.approvalFlows}条月度计划审核。`
  ctx.rerender(false); toast('排程已提交审核', view.message)
  return true
}

function mountTimeline(ctx) {
  document.querySelector('[data-pc1-toggle-inspector]')?.addEventListener('click',()=>{
    view.inspectorOpen=!view.inspectorOpen;refreshTimeline(ctx,false,'[data-pc1-toggle-inspector]')
  })
  document.querySelector('[data-pc1-close-inspector]')?.addEventListener('click',()=>{
    view.inspectorOpen=false;refreshTimeline(ctx,false,'[data-pc1-toggle-inspector]')
  })
  document.querySelector('[data-pc1-full-detail]')?.addEventListener('click',()=>{
    const row=selectedTask(ctx.state.pc1SchedulePreview)
    if(row)openTaskDetails(ctx.state,{...row,planKind:'preview'})
  })
  document.querySelectorAll('[data-pc1-select-task]').forEach(button=>button.addEventListener('click',()=>selectTask(ctx,button.dataset.pc1SelectTask,`[data-pc1-select-task="${button.dataset.pc1SelectTask}"]`)))
  document.querySelectorAll('[data-pc1-edit-task]').forEach(button => button.addEventListener('click', () => editTask(ctx, button.dataset.pc1EditTask)))
  document.querySelectorAll('[data-pc1-lock-task],[data-pc1-inspector-lock]').forEach(button => button.addEventListener('click', () => {
    const id=Number(button.dataset.pc1LockTask || button.dataset.pc1InspectorLock)
    const row=ctx.state.pc1SchedulePreview?.schedules.find(row=>row.id===id)
    if(!row)return
    view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId;view.inspectorOpen=true
    view.taskMessage=togglePc1Lock(ctx.state,id)?'时间已锁定，重新模拟时保留。':'已解锁，可精确调整时间。'
    refreshTimeline(ctx,true)
  }))
  document.querySelector('[data-pc1-task-time-editor]')?.addEventListener('submit',event=>{
    event.preventDefault()
    const row=selectedTask(ctx.state.pc1SchedulePreview)
    if(!row || row.isLocked)return
    const result=movePc1Task(ctx.state,row.id,document.querySelector('[data-pc1-detail-start]').value)
    view.taskMessage=result.message;refreshTimeline(ctx,result.ok,result.ok?'[data-pc1-inspector-lock]':'[data-pc1-detail-start]')
  })
  document.querySelectorAll('[data-pc1-drag-task]').forEach(button => {
    const id = Number(button.dataset.pc1DragTask)
    const focus=`[data-pc1-drag-task="${id}"]`
    button.addEventListener('click',event=>{if(event.detail===0)selectTask(ctx,id,focus)})
    button.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight'].includes(event.key)) {
        event.preventDefault()
        const row = ctx.state.pc1SchedulePreview?.schedules.find(row => row.id === id)
        if(!row)return
        view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId
        const result = movePc1Task(ctx.state, id, new Date(new Date(row.plannedStartAt).getTime() + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey?1:15) * 60000))
        view.taskMessage = result.message; refreshTimeline(ctx,result.ok,focus)
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTask(ctx,id,focus) }
    })
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const row = ctx.state.pc1SchedulePreview?.schedules.find(row => row.id === id)
      if(!row)return
      if(row.isLocked){event.preventDefault();selectTask(ctx,id,focus);return}
      event.preventDefault(); button.setPointerCapture(event.pointerId)
      const scroller = document.querySelector('[data-pc1-timeline-scroll]'), x = event.clientX, scroll = scroller.scrollLeft
      const track=button.parentElement
      const scale=track.getBoundingClientRect().width/track.offsetWidth || 1
      let raw=0,minutes=0,moved=false,readout
      const move = pointer => {
        raw=(pointer.clientX-x)/scale+scroller.scrollLeft-scroll
        if(!moved && Math.abs(raw)*scale<3)return
        moved=true;button.setAttribute('data-pc1-dragging','')
        const step=pointer.shiftKey?1:15
        minutes=Math.round(raw/view.dayWidth*24*60/step)*step
        button.style.transform=`translate(${minutes/1440*view.dayWidth}px,-50%)`
        const target=fmtFullDateTime(new Date(new Date(row.plannedStartAt).getTime()+minutes*60000))
        document.querySelector('[data-pc1-drag-tip]').textContent=`拟调整到 ${target} · ${step}分钟吸附`
        if(!readout){readout=document.createElement('div');readout.className='pc1-drag-readout';readout.setAttribute('role','status');document.body.appendChild(readout)}
        readout.textContent=`${target} · ${step}分钟吸附`
        readout.style.left=Math.max(8,Math.min(pointer.clientX+14,innerWidth-300))+'px'
        readout.style.top=Math.max(8,Math.min(pointer.clientY-48,innerHeight-60))+'px'
      }
      const cleanup=()=>{
        button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',finish);button.removeEventListener('pointercancel',cancel);button.removeEventListener('lostpointercapture',cancel)
        if(button.hasPointerCapture(event.pointerId))button.releasePointerCapture(event.pointerId)
        button.style.transform='';button.removeAttribute('data-pc1-dragging');readout?.remove()
      }
      const finish = () => {
        cleanup()
        if(!moved || !minutes){selectTask(ctx,id,focus);return}
        view.taskVehicleId=row.vehicleRepairId;view.taskId=row.taskId
        const result=movePc1Task(ctx.state,id,new Date(new Date(row.plannedStartAt).getTime()+minutes*60000))
        view.taskMessage=result.message;refreshTimeline(ctx,result.ok,focus)
      }
      const cancel=()=>{cleanup();const tip=document.querySelector('[data-pc1-drag-tip]');if(tip)tip.textContent='已取消拖动，任务时间未修改。'}
      button.addEventListener('pointermove',move);button.addEventListener('pointerup',finish);button.addEventListener('pointercancel',cancel);button.addEventListener('lostpointercapture',cancel)
    })
  })
}

export const pc1PlanningPage = {
  render(ctx) {
    const { state } = ctx
    initialize(state)
    const preview = state.pc1SchedulePreview, check = view.ids.length ? pc1Preflight(state, view.ids) : null
    const issues = preview ? pc1PreviewIssues(state,preview) : []
    if (preview && (!equalIds(view.ids, preview.vehicleRepairIds) || localInput(view.deadline) !== localInput(preview.deadline))) issues.push('车辆选择或最晚日期已修改，请重新模拟')
    if(preview)selectedTask(preview)
    const selected = state.vehicleRepairs.filter(row => view.ids.includes(row.id))
    const timelineFilters = preview ? `<label>车辆<select class="select" data-pc1-timeline-vehicle><option value="">全部车辆</option>${state.vehicleRepairs.filter(row => preview.vehicleRepairIds.includes(row.id)).map(row => `<option value="${row.id}" ${view.timelineVehicle === String(row.id) ? 'selected' : ''}>${esc(row.locomotiveNo)}</option>`).join('')}</select></label><label>时间视图<select class="select" data-pc1-day-width>${[96,192,288,576,1152].map(width => `<option value="${width}" ${view.dayWidth === width ? 'selected' : ''}>${({96:'全程概览',192:'按日 · 标准',288:'按日 · 放大',576:'按小时 · 24px/时',1152:'按小时 · 48px/时'})[width]}</option>`).join('')}</select></label><button class="btn btn-sm" type="button" data-pc1-toggle-inspector aria-expanded="${view.inspectorOpen}">${icon('file',15)}${view.inspectorOpen?'收起详情':'任务详情'}</button>` : ''
    const calendar = `<section class="card desk-calendar"><div class="desk-panel-head"><div><h2>选择检修车辆</h2>${ctx.demo?'':'<p>在月度日历中勾选本次需要排程的机车。</p>'}</div><input class="input" type="month" value="${esc(view.month)}" data-pc1-plan-month aria-label="选择计划月份"></div><div class="calendar-key"><span><i class="key-entry"></i>计划入段</span><span><i class="key-exit"></i>已排出段</span></div>${selectionCalendar(state)}${ctx.demo?'':'<div class="desk-panel-foot"><a class="text-action" href="#/planning/plans">导入其他检修计划 ↗</a><details class="workspace-menu"><summary class="text-action">演示数据</summary><div class="workspace-menu-panel"><button type="button" class="btn" data-pc1-demo-plans>导入两车演示计划</button></div></details></div>'}</section>`
    const simulator = `<section class="card desk-simulator"><div class="desk-panel-head"><div><h2>检修任务甘特图 <span class="count-label">${preview?.schedules.length || 0}</span></h2></div><div class="pc1-toolbar">${timelineFilters}</div></div>${renderPc1Timeline(state,preview)}</section>`
    const deadline = `<label class="desk-deadline"><span class="desk-field-label">最晚完成时间</span><input class="input" type="datetime-local" value="${localInput(view.deadline)}" data-pc1-deadline></label>`
    const preflight = `<div class="desk-preflight"><button type="button" class="text-action" data-pc1-preflight>${icon('check',15)}核对人员、工具、物料</button>${view.showPreflight && check ? `<div data-pc1-preflight-result class="${check.ok ? 'resource-ok' : 'resource-alert'}">${check.ok ? '资源数量预检通过；模拟继续校验时段占用。' : `<strong>资源预检未通过</strong><ul>${check.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>`}<details><summary>需求与可用量</summary>${resourceSummary(check.report)}</details></div>` : ''}</div>`
    const simulate = `<button type="button" class="btn ${preview && !issues.length ? '' : 'btn-primary'}" data-pc1-simulate data-run-schedule ${selected.length ? '' : 'disabled'}>${actionIcon(preview ? 'reset' : 'simulate',22)}${preview ? '重新模拟排程' : '生成模拟排程'}</button>`
    const saveStatus = `<div class="pc1-save-status" role="status" data-pc1-save-status>${esc(ctx.demoPersistence?.status.message || '')}</div>`
    const settings = preview ? `<section class="card pc1-overall-settings" aria-label="整体排程方案">
      <div class="pc1-plan-strip"><div class="pc1-plan-heading"><h2>模拟方案</h2><span class="plan-status ${!issues.length?'is-scheduled':''}">${issues.length?'待调整':'模拟完成 · 待确认'}</span><small>${selected.length}辆车 · ${preview.schedules.length}项任务</small></div>${deadline}<div class="pc1-plan-actions">${simulate}<button type="button" class="btn btn-primary" data-pc1-confirm data-publish ${issues.length?'disabled aria-describedby="pc1-plan-validation"':''}>${actionIcon('publish',22)}确认并提交审核</button></div></div>
      <div class="pc1-plan-meta"><details class="pc1-plan-conditions" ${view.showPreflight && check && !check.ok?'open':''}><summary>车辆与资源条件</summary><div class="pc1-plan-condition-body"><div class="desk-selected">${selected.map(row=>`<div class="desk-car"><div><strong>${esc(row.locomotiveNo)}</strong><small>${esc(dateKey(row.plannedEntryAt))} 入段</small></div></div>`).join('')}</div>${preflight}</div></details><div data-pc1-preview-status id="pc1-plan-validation" class="pc1-plan-validation ${issues.length?'resource-alert':'resource-ok'}">${issues.length?`<details open><summary>${issues.length}项待处理，校验通过后可发布</summary><ul>${issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul></details>`:`${icon('check',15)}人员、工具、物料与时间约束已通过`}</div><button type="button" class="text-action desk-cancel" data-pc1-cancel>取消模拟</button></div>${saveStatus}</section>` : `<section class="card desk-settings"><div class="desk-panel-head"><h2>本次检修安排</h2><span class="plan-status">未模拟</span></div><div class="desk-selected"><div class="desk-field-label">已选车辆 <b>${selected.length}</b></div>${selected.map(row=>`<div class="desk-car">${ctx.demo?'':`<span class="desk-car-icon">${locomotiveDrawing()}</span>`}<div><strong>${esc(row.locomotiveNo)}</strong><small>${esc(dateKey(row.plannedEntryAt))} 入段</small></div></div>`).join('')||'<p class="desk-placeholder">请先在日历中勾选车辆。</p>'}</div>${deadline}${preflight}<div class="desk-primary-actions">${simulate}</div><p class="desk-note">仅排构架与轮驱流程；模拟不会替换正式排程。</p>${saveStatus}</section>`
    return `<div class="pc1-workspace" data-pc1-planning>
      ${pageHeader('检修排程',ctx.demo?'':'先生成模拟方案，调整并校验后再正式发布。', '<a class="text-action" href="#/scheduling/gantt">班组下发清单 ↗</a>')}
      ${view.message && !preview ? `<p class="notice notice-info" role="status" data-pc1-message>${esc(view.message)}</p>` : ''}
      ${preview ? settings : ''}
      <div class="pc1-desk ${preview ? 'has-preview' : ''} ${preview && !view.inspectorOpen?'is-inspector-closed':''}"><div class="pc1-desk-main">${preview ? simulator : calendar}${preview ? `<details class="pc1-calendar-disclosure"><summary>修改本次选车</summary>${calendar}</details>` : ''}</div>
      ${preview ? renderTaskInspector(state, preview) : view.publishedVehicleId ? publishedVehiclePanel(state) : settings}</div>
      ${!ctx.demo && selected.length ? `<details class="pc1-resource-disclosure"><summary>查看单车资源明细与库存</summary><section class="card"><div class="card-title-row"><h2>单车资源明细</h2><select class="select" data-pc1-resource-car aria-label="资源明细车辆">${selected.map(row => `<option value="${row.id}" ${row.id === state.selectedVehicleRepairId ? 'selected' : ''}>${esc(row.locomotiveNo)}</option>`).join('')}</select></div>${renderVehicleResources(state, selected.some(row => row.id === state.selectedVehicleRepairId) ? state.selectedVehicleRepairId : selected[0].id)}</section></details>` : ''}
      </div>`
  },
  mount(ctx) {
    document.querySelector('[data-pc1-plan-month]')?.addEventListener('change', event => { if (event.target.validity.valid && /^\d{4}-\d{2}$/.test(event.target.value)) { view.month = event.target.value; ctx.rerender(false) } })
    document.querySelectorAll('[data-pc1-select-vehicle]').forEach(input => input.addEventListener('change', () => { const id = Number(input.dataset.pc1SelectVehicle); view.ids = input.checked ? [...new Set([...view.ids,id])] : view.ids.filter(value => value !== id); if (!ctx.state.pc1SchedulePreview) view.deadline = defaultDeadline(ctx.state); ctx.rerender(false) }))
    document.querySelectorAll('[data-pc1-view-published]').forEach(button=>button.addEventListener('click',()=>{view.publishedVehicleId=Number(button.dataset.pc1ViewPublished);ctx.state.selectedVehicleRepairId=view.publishedVehicleId;ctx.rerender(false)}))
    document.querySelector('[data-pc1-deadline]')?.addEventListener('change', event => { view.deadline = event.target.value; ctx.rerender(false) })
    document.querySelector('[data-pc1-demo-plans]')?.addEventListener('click', () => {
      commitImport(ctx.state,parseCsv(templateCsv))
      view.ids = ctx.state.vehicleRepairs.filter(row => /^HXD1C-DEMO0[12]$/.test(row.locomotiveNo) && canPlanVehicle(ctx.state,row)).map(row => row.id)
      view.month = dateKey(ctx.state.vehicleRepairs.find(row => view.ids.includes(row.id))?.plannedEntryAt || new Date()).slice(0,7)
      view.deadline = defaultDeadline(ctx.state); view.message = '已准备两辆相邻日期入段的演示计划；尚未排程。'; ctx.rerender()
    })
    document.querySelector('[data-pc1-preflight]')?.addEventListener('click', () => { view.showPreflight = true; ctx.rerender(false); const conditions=document.querySelector('.pc1-plan-conditions');if(conditions)conditions.open=true })
    document.querySelector('[data-pc1-simulate]')?.addEventListener('click', () => {
      view.showPreflight = true
      const result = simulatePc1(ctx.state,view.ids,view.deadline)
      if (!result.ok) { view.message = result.issues.join('；'); ctx.rerender(false); return }
      ctx.state.pc1SchedulePreview = result.preview; view.taskMessage=''; view.message = result.issues.length ? '模拟已生成，请处理下列约束问题。' : '模拟完成，可拖动或精确调整任务，确认前不会改动正式排程。'; ctx.rerender()
    })
    document.querySelector('[data-pc1-confirm]')?.addEventListener('click', () => {const selected=ctx.state.vehicleRepairs.filter(row=>view.ids.includes(row.id)),month=String(selected[0]?.plannedEntryAt||view.month).slice(0,7);openModal({ title: '月度检修计划审核提报', wide:true, body: `<div class="notice notice-info"><strong>已完成排程校验</strong><span>本次共${selected.length}辆机车、${ctx.state.pc1SchedulePreview?.schedules.length||0}项工序。确认后冻结排程并提交主管科长审核。</span></div><div class="pc-plan-manual-grid" style="margin-top:16px"><label class="is-wide">计划名称 *<input class="input" maxlength="100" value="${esc(`${month}月度检修计划`)}" data-approval-plan-name></label><label>计划月份<input class="input" value="${esc(month)}" disabled></label><label>提报部门<input class="input" maxlength="100" value="计划编制" data-approval-department></label><label class="is-wide">提报说明 *<textarea class="textarea" maxlength="500" data-approval-note>排程编制及资源校验已完成，申请主管科长审核。</textarea></label></div><p role="alert" class="pc-error-text" data-approval-error></p>`, confirmText: '确认并提交审核', async onConfirm(wrap){const planName=wrap.querySelector('[data-approval-plan-name]').value.trim(),note=wrap.querySelector('[data-approval-note]').value.trim(),submitterDepartment=wrap.querySelector('[data-approval-department]').value.trim();if(!planName||!note){wrap.querySelector('[data-approval-error]').textContent='请填写计划名称和提报说明。';return false}return saveConfirmedPc1(ctx,{planName,note,submitterDepartment})} }) })
    document.querySelector('[data-pc1-cancel]')?.addEventListener('click', () => { delete ctx.state.pc1SchedulePreview; view.message = '已取消模拟，原正式排程及资源安排未改变。'; ctx.rerender() })
    document.querySelector('[data-pc1-timeline-vehicle]')?.addEventListener('change', event => { view.timelineVehicle = event.target.value; view.taskMessage=''; refreshTimeline(ctx,false,'[data-pc1-timeline-vehicle]') })
    document.querySelector('[data-pc1-day-width]')?.addEventListener('change', event => {
      view.dayWidth = Number(event.target.value); refreshTimeline(ctx,false,'[data-pc1-day-width]')
      const preview=ctx.state.pc1SchedulePreview,row=selectedTask(preview),scroller=document.querySelector('[data-pc1-timeline-scroll]')
      if(row && scroller){
        const origin=new Date(`${dateKey(Math.min(...preview.schedules.map(item=>new Date(item.plannedStartAt).getTime())))}T00:00:00`).getTime()
        const labelWidth=document.querySelector('.pc1-timeline-head .pc1-timeline-label')?.offsetWidth || 230
        scroller.scrollLeft=Math.max(0,(new Date(row.plannedStartAt).getTime()-origin)/DAY*view.dayWidth-Math.max(0,scroller.clientWidth-labelWidth)/2)
      }
    })
    document.querySelector('[data-pc1-resource-car]')?.addEventListener('change', event => { ctx.state.selectedVehicleRepairId = Number(event.target.value); ctx.rerender(false) })
    mountTimeline(ctx)
    mountPlanMaintenance(ctx,async()=>{view.publishedVehicleId=null;ctx.rerender(false)})
    mountResourceLists(ctx,ctx.state.planningView)
  },
}
