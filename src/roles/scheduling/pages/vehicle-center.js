import { formalVehicleTasks } from '../../../core/vehicle-operations.js'
import { icon, actionIcon } from '../../../shared/icons.js'
import { pageHeader } from '../../../shared/templates.js'
import { locomotiveDrawing } from '../../../shared/rail-visuals.js'
import { escapeHtml as esc } from '../../../core/ui.js'
import { fmtFullDateTime, taskStatusLabel } from '../../../core/derived.js'
import { dateKey, planningTasks, tasksOnDay } from '../../../core/planning-view.js'
import { calendarGrid, taskEvents, taskTable, kindLabel } from '../../../shared/planning-calendar.js'
import { openTaskDetails } from '../../../shared/task-details.js'
import { renderVehicleResources, mountResourceLists } from '../../../shared/resource-lists.js'
import { renderWorkstationMonitor, mountWorkstationMonitor } from '../../../shared/workstation-monitor.js'
import { renderMaintenanceRecords } from '../../../shared/maintenance-records.js'
import { vehicleDetails, mountVehicleMilestones } from '../../../shared/vehicle-details.js'
import { ensureGanttRange, renderGantt, renderGanttToolbar, rowsInGanttRange, updateGanttRange, resetGanttRange } from '../../../shared/gantt.js'
import { planMaintenanceActions,mountPlanMaintenance } from '../../../shared/plan-maintenance.js'

const view = { tab: '', month: '', day: '', station: '', route: '' }

function demoDailyTasks(state, rows) {
  if (!rows.length) return `<div class="demo-day-empty">${icon('calendar',30)}<p>当日暂无检修任务</p></div>`
  return `<ol class="demo-day-tasks">${rows.map(row => {
    const task = state.tasks.find(item => item.id === row.taskId)
    const station = state.workstations.find(item => item.id === row.workstationId)
    return `<li><div class="demo-day-task-title"><button type="button" class="demo-task-detail-link" data-task-detail="${row.id}">${esc(task?.name || '检修工序')}${icon('chevronRight',13)}</button><span class="demo-day-status ${row.status === 'COMPLETED' ? 'is-done' : ''}">${esc(taskStatusLabel(row.status || 'NOT_STARTED'))}</span></div><div class="demo-day-task-time"><time datetime="${esc(row.plannedStartAt)}">${esc(fmtFullDateTime(row.plannedStartAt))}</time><span>至</span><time datetime="${esc(row.plannedEndAt)}">${esc(fmtFullDateTime(row.plannedEndAt))}</time></div><div class="demo-day-task-meta"><span>${esc(station?.name || '未分配工位')}</span><span>${esc(kindLabel[row.planKind] || '待确认')}${row.isLocked ? ' · 锁定' : ''}</span></div></li>`
  }).join('')}</ol>`
}

export const vehicleCenterPage = {
  render(ctx) {
    const { state } = ctx
    const vehicle = state.vehicleRepairs.find(row => row.id === state.selectedVehicleRepairId) || state.vehicleRepairs[0]
    if (!vehicle) return `${pageHeader(ctx.demoPage==='control'?'整车检修管控':'单车检修查询','查看车辆每日任务、进度和检修资料。')}<section class="card empty">请先导入车辆检修计划。${ctx.demo?'<a class="btn" href="#/demo/plans">导入月度计划</a>':''}</section>`
    state.selectedVehicleRepairId = vehicle.id
    state.planningView ||= { tab: 'vehicle', month: dateKey(vehicle.plannedEntryAt).slice(0, 7), vehicleFilter: '', day: '' }
    const route=(ctx.demo?'demo/':'')+ctx.role?.id+'/'+ctx.page
    if(view.route!==route){view.tab=['exceptions','control'].includes(ctx.page)?'records':'calendar';view.route=route}
    if(ctx.demoPage==='control')view.tab='records'
    else if(ctx.demo && view.tab==='records')view.tab='calendar'
    const rows = view.tab==='records'?formalVehicleTasks(state,vehicle.id):planningTasks(state, vehicle.id), first = rows[0]?.plannedStartAt || vehicle.plannedEntryAt
    view.month ||= dateKey(first).slice(0, 7); view.day ||= dateKey(first)
    const version = state.scheduleVersions.find(row => row.id === vehicle.currentVersionId)
    const completed = rows.filter(row => row.status === 'COMPLETED').length
    const tabs = [['calendar','每日任务日历'],['gantt','甘特图进度'],['resources','人员 / 工具 / 物料'],...(!ctx.demo?[['records','整车检修管控']]:[])]
    let content = ''
    if (view.tab === 'calendar') {
      const toolbar = `<div class="pc1-toolbar"><label>月份<input class="input" type="month" value="${esc(view.month)}" data-pc1-vehicle-month aria-label="检修日历月份"></label><button type="button" class="btn" data-pc1-first-task ${rows.length ? '' : 'disabled'}>${actionIcon('calendar')}跳到首项任务</button></div>`
      const grid = calendarGrid({ month: view.month, selectedDay: view.day, selectEventDay: true, taskDetails: true, eventsForDay: day => taskEvents(state, rows, day, { includeVehicle: !ctx.demo }) })
      const daily = tasksOnDay(rows, view.day)
      content = ctx.demo
        ? `<div class="demo-vehicle-calendar"><section class="card demo-vehicle-month">${toolbar}${grid}</section><aside class="card demo-vehicle-day" aria-label="当日检修任务"><div class="demo-day-heading"><h3>${esc(view.day)}<span>当日检修任务</span></h3><span class="demo-day-count">${daily.length}项</span></div><div class="demo-day-content" aria-live="polite" aria-atomic="true">${demoDailyTasks(state, daily)}</div></aside></div>`
        : `<section class="card">${toolbar}${grid}<h3>${esc(view.day)} · 当日检修任务</h3>${taskTable(state, daily)}</section>`
    }
    if (view.tab === 'gantt') {
      const key = `pc1-vehicle-${vehicle.id}`, range = ensureGanttRange(state, key, rows, vehicle.plannedEntryAt, vehicle.plannedExitAt)
      const visible = rowsInGanttRange(rows, range)
      content = `<section class="card">${renderGanttToolbar({ range, count: visible.length })}${renderGantt({ rows: visible, range, interactive: true, labelFor: row => state.tasks.find(task => task.id === row.taskId)?.name || '工序', metaFor: row => `${fmtFullDateTime(row.plannedStartAt)}—${fmtFullDateTime(row.plannedEndAt)}`, barClassFor: row => `${row.isLocked ? 'locked' : ''} ${row.planKind === 'preview' ? 'pc1-preview-bar' : ''}`, attributesFor: row => `data-pc1-query-task="${row.id}" data-task-detail="${row.id}"` })}<p class="pc-help">需要调整任务时，进入 <a href="#/scheduling/dashboard">整车日计划编排与调整</a> 生成或调整模拟方案。</p></section>`
    }
    if (view.tab === 'resources') content = renderVehicleResources(state, vehicle.id, true)
    if (view.tab === 'records') content = ctx.demo ? `${renderMaintenanceRecords(state,vehicle.id,{presentation:true})}<details class="pc1-control-stations"><summary>按工位查看进度与异常</summary>${renderWorkstationMonitor(state, vehicle.id, view.station)}</details>` : renderWorkstationMonitor(state, vehicle.id, view.station)
    return `<div class="pc1-workspace" data-pc1-vehicle-center>${pageHeader(ctx.demo?(ctx.demoPage==='control'?'整车检修管控':'单车检修查询'):'单车检修查询与管控',ctx.demo?'':'同一辆车的每日任务、排程进度、资源清单与已提交记录。', `<select class="select" data-pc1-query-vehicle aria-label="选择检修车辆">${state.vehicleRepairs.map(row => `<option value="${row.id}" ${row.id === vehicle.id ? 'selected' : ''}>${esc(row.locomotiveNo)}</option>`).join('')}</select>`)}${ctx.demo?'':`<section class="card pc1-vehicle-summary"><div class="vehicle-identity-summary"><div><span>机车编号</span><strong>${esc(vehicle.locomotiveNo)}</strong></div>${locomotiveDrawing()}</div><div><span>计划入段</span><strong>${fmtFullDateTime(vehicle.plannedEntryAt)}</strong></div><div><span>排程状态</span><strong>${rows.some(row => row.planKind === 'preview') ? '模拟预览 · 未确认' : version?.status === 'PUBLISHED' ? '正式排程' : '待排程 / 待确认'}</strong></div><div><span>检修进度</span><strong>${completed} / ${rows.length}</strong></div></section>`}<div class="tabs pc1-tabs" aria-label="单车信息">${(ctx.demoPage==='control'?[]:tabs).map(([key,label]) => `<button class="tab ${view.tab === key ? 'active' : ''}" data-pc1-vehicle-tab="${key}" aria-pressed="${view.tab === key}">${ctx.demo ? icon(({calendar:'calendar',gantt:'schedule',resources:'wrench'})[key],15) : ''}${label}</button>`).join('')}</div>${ctx.demo?'':vehicleDetails(state,vehicle,rows,view.tab==='records'?dateKey(new Date()):view.day,{milestones:true})}${content}</div>`
  },
  mount(ctx) {
    if(!ctx.demo){const vehicle=ctx.state.vehicleRepairs.find(row=>row.id===ctx.state.selectedVehicleRepairId),summary=document.querySelector('.pc1-vehicle-summary');if(vehicle&&summary){summary.insertAdjacentHTML('afterend',`<section class="card pc1-vehicle-plan-actions"><div class="card-title-row"><div><div class="card-title">排程计划操作</div><div class="card-subtitle">审批中和已发布版本只读；需要调整时先确认修改或申请调整。</div></div></div>${planMaintenanceActions(ctx.state,vehicle.id)}</section>`);mountPlanMaintenance(ctx,async()=>ctx.rerender(false))}}
    document.querySelector('[data-pc1-query-vehicle]')?.addEventListener('change', event => { ctx.state.selectedVehicleRepairId = Number(event.target.value); view.month = ''; view.day = ''; ctx.rerender(false) })
    document.querySelectorAll('[data-pc1-vehicle-tab]').forEach(button => button.addEventListener('click', () => { view.tab = button.dataset.pc1VehicleTab; ctx.rerender(false) }))
    document.querySelector('[data-pc1-vehicle-month]')?.addEventListener('change', event => { if (event.target.validity.valid && /^\d{4}-\d{2}$/.test(event.target.value)) { view.month = event.target.value; view.day = `${view.month}-01`; ctx.rerender(false) } })
    document.querySelectorAll('[data-pc-day]:not([data-task-detail])').forEach(button => button.addEventListener('click', () => { view.day = button.dataset.pcDay; view.month = view.day.slice(0, 7); ctx.rerender(false) }))
    document.querySelector('[data-pc1-first-task]')?.addEventListener('click', () => { const row = planningTasks(ctx.state, ctx.state.selectedVehicleRepairId)[0]; if (row) { view.day = dateKey(row.plannedStartAt); view.month = view.day.slice(0, 7); ctx.rerender(false) } })
    const key = `pc1-vehicle-${ctx.state.selectedVehicleRepairId}`
    document.querySelectorAll('[data-gantt-range]').forEach(input => input.addEventListener('change', () => { updateGanttRange(ctx.state, key, input.dataset.ganttRange, input.value); ctx.rerender(false) }))
    document.querySelector('[data-gantt-reset]')?.addEventListener('click', () => { resetGanttRange(ctx.state, key); ctx.rerender(false) })
    document.querySelectorAll('[data-task-detail]').forEach(button=>button.addEventListener('click',()=>{
      const row=planningTasks(ctx.state,ctx.state.selectedVehicleRepairId).find(row=>row.id===Number(button.dataset.taskDetail))
      if(!row)return
      if(button.dataset.pcDay){
        view.day=button.dataset.pcDay;view.month=view.day.slice(0,7);ctx.rerender(false)
        document.querySelector(`[data-task-detail="${row.id}"]`)?.focus({preventScroll:true})
      }
      openTaskDetails(ctx.state,row)
    }))
    mountResourceLists(ctx, ctx.state.planningView || {}, true)
    mountVehicleMilestones(ctx)
    mountWorkstationMonitor(ctx,station=>{view.station=station})
  },
}
