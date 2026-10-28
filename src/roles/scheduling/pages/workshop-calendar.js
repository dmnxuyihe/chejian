import { pageHeader, emptyState } from '../../../shared/templates.js'
import { escapeHtml as esc, openModal, toast } from '../../../core/ui.js'
import { fmtDateTime, fmtFullDateTime, taskOf, taskStatusLabel, workstationOf } from '../../../core/derived.js'
import { dateKey, monthDays, planningTasks, shiftMonth, tasksOnDay } from '../../../core/planning-view.js'
import { kindLabel } from '../../../shared/planning-calendar.js'
import { createScheduleExport } from '../../../shared/schedule-export.js'
const DAY = 24 * 60 * 60 * 1000
const DAY_WIDTH = 288
const view = { tab: 'workshop', month: '', day: '', vehicleId: '', ganttRange: null, expandedDayVehicles: new Set(), workshopVehicleIds: [], workshopInitialized: false, ganttVehicleIds: [], ganttInitialized: false }

function ensureView(state) {
  if (!view.month) view.month = dateKey(state.demoClock || new Date()).slice(0, 7)
  if (!view.day || !view.day.startsWith(view.month)) view.day = `${view.month}-01`
  if (view.vehicleId && !state.vehicleRepairs.some(vehicle => vehicle.id === Number(view.vehicleId))) view.vehicleId = ''
  const taskVehicleIds = new Set(planningTasks(state).map(row => row.vehicleRepairId))
  view.workshopVehicleIds = view.workshopVehicleIds.filter(id => taskVehicleIds.has(id))
  view.ganttVehicleIds = view.ganttVehicleIds.filter(id => taskVehicleIds.has(id))
  if (!view.workshopInitialized) { view.workshopVehicleIds = [...taskVehicleIds]; view.workshopInitialized = true }
  if (!view.ganttInitialized) { view.ganttVehicleIds = [...taskVehicleIds]; view.ganttInitialized = true }
  return view
}

const kindClass = kind => kind === 'formal' ? 'is-formal' : kind === 'preview' ? 'is-preview' : 'is-draft'
const kindBadge = kind => kind === 'formal' ? 'badge-green' : kind === 'preview' ? 'badge-purple' : 'badge-amber'
const time = value => fmtDateTime(value).split(' ').at(-1)
const vehicleOf = (state, id) => state.vehicleRepairs.find(item => item.id === Number(id))

function dominantKind(rows) {
  return rows.some(row => row.planKind === 'preview') ? 'preview' : rows.some(row => row.planKind === 'draft') ? 'draft' : 'formal'
}

function vehiclesOnDay(state, rows, day) {
  const groups = new Map()
  for (const row of tasksOnDay(rows, day)) {
    if (!groups.has(row.vehicleRepairId)) groups.set(row.vehicleRepairId, [])
    groups.get(row.vehicleRepairId).push(row)
  }
  return [...groups].map(([vehicleId, tasks]) => ({ vehicleId, vehicle: vehicleOf(state, vehicleId), tasks, kind: dominantKind(tasks) }))
    .sort((a, b) => (a.vehicle?.locomotiveNo || '').localeCompare(b.vehicle?.locomotiveNo || '', 'zh-CN'))
}

function calendar(state, rows) {
  return `<div class="wc-calendar" role="grid" aria-label="${esc(view.month)}车间任务日历">
    ${['一','二','三','四','五','六','日'].map(day => `<div class="wc-weekday" role="columnheader">周${day}</div>`).join('')}
    ${monthDays(view.month).map(day => {
      const vehicles = vehiclesOnDay(state, rows, day), visible = vehicles.slice(0, 3)
      const taskCount = vehicles.reduce((sum, item) => sum + item.tasks.length, 0)
      return `<div class="wc-day ${day.startsWith(view.month) ? '' : 'is-outside'} ${view.day === day ? 'is-selected' : ''}" role="gridcell" tabindex="0" data-wc-day="${day}" aria-label="查看${day}，${vehicles.length}辆车${taskCount}项任务" aria-pressed="${view.day === day}">
        <div class="wc-day-number"><strong>${Number(day.slice(-2))}</strong><span>${vehicles.length ? `${vehicles.length}辆` : ''}</span></div>
        <div class="wc-day-events">${visible.map(item => `<button type="button" class="wc-event ${kindClass(item.kind)}" data-wc-day-vehicle="${item.vehicleId}" data-wc-event-day="${day}" title="${esc(item.vehicle?.locomotiveNo || '未知车辆')}，${item.tasks.length}项任务"><span>${esc(item.vehicle?.locomotiveNo || '未知车辆')}</span><b>${item.tasks.length}项</b></button>`).join('')}${vehicles.length > 3 ? `<button type="button" class="wc-more" data-wc-more="${day}">还有${vehicles.length - 3}辆</button>` : ''}</div>
      </div>`
    }).join('')}
  </div>`
}

function taskButton(state, row) {
  return `<button type="button" class="wc-accordion-task" data-wc-task="${row.id}" data-wc-kind="${row.planKind}"><span><strong>${esc(taskOf(state,row.taskId)?.name || '检修任务')}</strong><small>${esc(time(row.plannedStartAt))}—${esc(time(row.plannedEndAt))} · ${esc(workstationOf(state,row.workstationId)?.name || '未分配工位')}</small></span><span class="badge ${kindBadge(row.planKind)}">${kindLabel[row.planKind]}</span></button>`
}

function dayPanel(state, rows) {
  const groups = vehiclesOnDay(state, rows, view.day)
  const taskCount = groups.reduce((sum, item) => sum + item.tasks.length, 0)
  return `<div class="wc-day-panel">
    <div class="pc-plan-day-summary"><div><span>当日任务</span><strong>${taskCount}</strong></div><div><span>涉及车辆</span><strong>${groups.length}</strong></div></div>
    <div class="wc-vehicle-list">${groups.map(item => { const expanded = view.expandedDayVehicles.has(item.vehicleId); return `<section class="wc-vehicle-accordion"><button type="button" class="wc-vehicle-toggle" data-wc-toggle-vehicle="${item.vehicleId}" aria-expanded="${expanded}"><span><strong>${esc(item.vehicle?.locomotiveNo || '未知车辆')}</strong><small>${item.tasks.length}项任务 · ${kindLabel[item.kind]}</small></span><b>${expanded ? '收起' : '展开'}⌄</b></button>${expanded ? `<div class="wc-vehicle-tasks">${item.tasks.map(row => taskButton(state,row)).join('')}</div>` : ''}</section>` }).join('') || '<p class="pc-plan-empty">当日暂无检修车辆。</p>'}</div>
  </div>`
}

function toolbar(state) {
  const showMonth = view.tab !== 'gantt'
  return `<div class="wc-toolbar"><div class="wc-toolbar-top"><div class="tabs" aria-label="车间任务视图">${[['workshop','车间任务日历'],['vehicle','单车日历'],['gantt','多车甘特图']].map(([key,label]) => `<button type="button" class="tab ${view.tab === key ? 'active' : ''}" data-wc-tab="${key}" aria-pressed="${view.tab === key}">${label}</button>`).join('')}</div>${showMonth ? `<div class="pc-plan-month-nav"><button type="button" class="btn" data-wc-month-step="-1">‹</button><input class="input" type="month" min="1900-01" max="2199-12" value="${view.month}" data-wc-month><button type="button" class="btn" data-wc-month-step="1">›</button><button type="button" class="btn" data-wc-today>回到今天</button></div>` : ''}</div>${view.tab === 'workshop' ? `<div class="wc-filter-row"><span class="wc-filter-title">车辆筛选</span>${workshopVehiclePicker(state)}</div>` : view.tab === 'vehicle' ? `<div class="wc-filter-row"><label class="wc-filter-label">车辆筛选<select class="select" data-wc-filter><option value="">请选择车辆</option>${state.vehicleRepairs.map(vehicle => `<option value="${vehicle.id}" ${String(vehicle.id) === view.vehicleId ? 'selected' : ''}>${esc(vehicle.locomotiveNo)}</option>`).join('')}</select></label></div>` : ''}</div>`
}

function workshopVehiclePicker(state) {
  const taskIds = new Set(planningTasks(state).map(row => row.vehicleRepairId))
  const vehicles = state.vehicleRepairs.filter(vehicle => taskIds.has(vehicle.id))
  const selected = vehicles.filter(vehicle => view.workshopVehicleIds.includes(vehicle.id))
  return `<details class="wc-multi-select wc-workshop-picker"><summary>${selected.length ? `已选择${selected.length}辆：${selected.slice(0,2).map(vehicle => esc(vehicle.locomotiveNo)).join('、')}${selected.length > 2 ? '…' : ''}` : '请选择车辆'}</summary><div class="wc-multi-options" role="listbox" aria-multiselectable="true">${vehicles.map(vehicle => `<label><input type="checkbox" value="${vehicle.id}" data-wc-workshop-vehicle ${view.workshopVehicleIds.includes(vehicle.id) ? 'checked' : ''}><span>${esc(vehicle.locomotiveNo)}</span></label>`).join('') || '<p>暂无已排程车辆</p>'}</div></details>`
}

function workshopView(state) {
  const selectedIds = new Set(view.workshopVehicleIds)
  const rows = planningTasks(state).filter(row => selectedIds.has(row.vehicleRepairId))
  return `<section class="pc-plan-layout wc-layout"><div class="card pc-plan-calendar-card"><div class="pc-plan-panel-head"><div><h2>${esc(view.month)} 车间每日检修任务</h2><p>每辆车每天只显示一行，右侧展开车辆查看具体任务。</p></div><div class="wc-legend"><span><i class="is-formal"></i>正式排程</span><span><i class="is-draft"></i>待确认</span><span><i class="is-preview"></i>模拟预览</span></div></div>${calendar(state, rows)}</div>
    <aside class="card pc-plan-day-card"><div class="pc-plan-panel-head"><div><h2>当日车辆</h2><p>${esc(view.day)} · 点击车辆下拉查看任务</p></div></div>${dayPanel(state, rows)}</aside></section>`
}

function selectedVehicle(state) {
  return vehicleOf(state, view.vehicleId) || vehicleOf(state, state.selectedVehicleRepairId) || state.vehicleRepairs[0]
}

function vehicleSummary(state, vehicle, rows) {
  const version = state.scheduleVersions.find(item => item.id === vehicle.currentVersionId)
  return `<div class="wc-vehicle-summary"><div><span>车辆编号</span><strong>${esc(vehicle.locomotiveNo)}</strong></div><div><span>计划入段</span><strong>${fmtFullDateTime(vehicle.plannedEntryAt)}</strong></div><div><span>排程状态</span><strong>${version?.status === 'PUBLISHED' ? '正式排程' : version ? '待确认' : '未排程'}</strong></div><div><span>任务数量</span><strong>${rows.length}</strong></div></div>`
}

function vehicleCalendarView(state) {
  const vehicle = selectedVehicle(state)
  if (!vehicle) return `<section class="card">${emptyState('暂无车辆', '数据库中暂无检修车辆。')}</section>`
  const rows = planningTasks(state, vehicle.id)
  const firstDay = rows.length ? dateKey(rows[0].plannedStartAt) : ''
  const lastDay = rows.length ? dateKey(new Date(Math.max(new Date(rows.at(-1).plannedStartAt).getTime(), new Date(rows.at(-1).plannedEndAt).getTime() - 1))) : ''
  const dayRows = tasksOnDay(rows, view.day)
  return `<section class="card wc-single-card"><div class="pc-plan-panel-head"><div><h2>${esc(vehicle.locomotiveNo)} 单车任务日历</h2><p>与车间日历、多车甘特图使用相同排程数据。</p></div><div class="wc-jump-actions"><button type="button" class="btn btn-sm" data-wc-jump-day="${firstDay}" ${firstDay ? '' : 'disabled'}>跳到第一次任务</button><button type="button" class="btn btn-sm" data-wc-jump-day="${lastDay}" ${lastDay ? '' : 'disabled'}>跳到最后一次任务</button></div></div>${vehicleSummary(state, vehicle, rows)}${calendar(state, rows)}<div class="wc-single-day"><h3>${esc(view.day)} · ${dayRows.length}项任务</h3>${dayRows.map(row => taskButton(state,row)).join('') || '<p class="pc-plan-empty">当日暂无本车任务。</p>'}</div></section>`
}

function ganttVehiclePicker(state) {
  const taskIds = new Set(planningTasks(state).map(row => row.vehicleRepairId))
  const vehicles = state.vehicleRepairs.filter(vehicle => taskIds.has(vehicle.id))
  const selected = vehicles.filter(vehicle => view.ganttVehicleIds.includes(vehicle.id))
  return `<details class="wc-multi-select"><summary>${selected.length ? `已选择${selected.length}辆：${selected.slice(0,2).map(vehicle => esc(vehicle.locomotiveNo)).join('、')}${selected.length > 2 ? '…' : ''}` : '请选择车辆'}</summary><div class="wc-multi-options" role="listbox" aria-multiselectable="true">${vehicles.map(vehicle => `<label><input type="checkbox" value="${vehicle.id}" data-wc-gantt-vehicle ${view.ganttVehicleIds.includes(vehicle.id) ? 'checked' : ''}><span>${esc(vehicle.locomotiveNo)}</span></label>`).join('') || '<p>暂无已排程车辆</p>'}</div></details>`
}

function autoGanttRange(rows) {
  if (!rows.length) { const today = dateKey(new Date()); return { start: today, end: today } }
  return { start: dateKey(Math.min(...rows.map(row => new Date(row.plannedStartAt).getTime()))), end: dateKey(Math.max(...rows.map(row => new Date(row.plannedEndAt).getTime()))) }
}

function ganttRowsInRange(rows, range) {
  const start = new Date(`${range.start}T00:00:00`).getTime(), end = new Date(`${range.end}T00:00:00`).getTime() + DAY
  return rows.filter(row => new Date(row.plannedEndAt).getTime() > start && new Date(row.plannedStartAt).getTime() < end)
}

function fixedDayGantt(state, rows, range) {
  const start = new Date(`${range.start}T00:00:00`).getTime(), end = new Date(`${range.end}T00:00:00`).getTime() + DAY
  const days = Math.max(1, Math.round((end - start) / DAY)), width = days * DAY_WIDTH
  const dates = Array.from({ length: days }, (_, index) => new Date(start + index * DAY))
  const sorted = [...rows].sort((a,b) => a.vehicleRepairId - b.vehicleRepairId || new Date(a.plannedStartAt) - new Date(b.plannedStartAt) || a.id - b.id)
  if (!sorted.length) return '<div class="empty"><strong>当前日期范围没有所选车辆任务</strong><span>请选择车辆或调整日期范围。</span></div>'
  return `<div class="wc-gantt-scroll" data-wc-gantt-scroll><div class="wc-fixed-gantt" style="--wc-timeline-width:${width}px"><div class="wc-gantt-head"><div class="wc-gantt-label">车辆 / 任务</div><div class="wc-gantt-days" style="width:${width}px">${dates.map(date => `<span>${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}</span>`).join('')}</div></div>${sorted.map(row => {
    const left = Math.max(0, (new Date(row.plannedStartAt).getTime() - start) / DAY * DAY_WIDTH)
    const right = Math.min(width, (new Date(row.plannedEndAt).getTime() - start) / DAY * DAY_WIDTH)
    return `<div class="wc-gantt-row"><div class="wc-gantt-label"><strong>${esc(vehicleOf(state,row.vehicleRepairId)?.locomotiveNo || '未知车辆')}</strong><span>${esc(taskOf(state,row.taskId)?.name || '检修任务')}</span></div><div class="wc-gantt-track" style="width:${width}px;background-size:${DAY_WIDTH}px 100%"><button type="button" class="wc-gantt-bar ${kindClass(row.planKind)}" style="left:${left}px;width:${Math.max(8,right-left)}px" data-wc-task="${row.id}" data-wc-kind="${row.planKind}" title="${esc(taskOf(state,row.taskId)?.name || '检修任务')}">${esc(taskOf(state,row.taskId)?.name || '任务')}</button></div></div>`
  }).join('')}</div></div>`
}

function ganttView(state) {
  const selectedIds = new Set(view.ganttVehicleIds)
  const allRows = planningTasks(state).filter(row => selectedIds.has(row.vehicleRepairId))
  const range = view.ganttRange || autoGanttRange(allRows)
  const rows = ganttRowsInRange(allRows, range)
  return `<section class="card wc-gantt-card"><div class="pc-plan-panel-head"><div><h2>多车任务甘特图</h2><p>默认覆盖所选车辆首项任务至末项任务；每天固定${DAY_WIDTH}px，可横向滚动。</p></div><div class="wc-gantt-actions">${ganttVehiclePicker(state)}<button type="button" class="btn btn-primary" data-wc-export ${rows.length ? '' : 'disabled'}>导出 Excel</button></div></div><div class="gantt-toolbar"><div class="gantt-date-fields"><div class="field field-compact"><label>开始日期</label><input class="input" type="date" value="${range.start}" data-gantt-range="start"></div><div class="field field-compact"><label>结束日期</label><input class="input" type="date" value="${range.end}" data-gantt-range="end"></div><button type="button" class="btn btn-sm" data-gantt-reset>恢复任务完整范围</button></div><div class="gantt-range-summary"><strong>${rows.length}</strong><span>范围内任务</span></div></div>${fixedDayGantt(state, rows, range)}</section>`
}

function showTask(state, id, kind) {
  const row = planningTasks(state).find(item => item.id === Number(id) && item.planKind === kind)
  if (!row) return
  const vehicle = state.vehicleRepairs.find(item => item.id === row.vehicleRepairId)
  openModal({ title: `${vehicle?.locomotiveNo || '车辆'} · ${taskOf(state,row.taskId)?.name || '检修任务'}`, body: `<div class="detail-grid"><div><span>排程类型</span><strong>${kindLabel[row.planKind]}</strong></div><div><span>任务状态</span><strong>${esc(taskStatusLabel(row.status))}</strong></div><div><span>计划开始</span><strong>${fmtFullDateTime(row.plannedStartAt)}</strong></div><div><span>计划结束</span><strong>${fmtFullDateTime(row.plannedEndAt)}</strong></div><div><span>作业工位</span><strong>${esc(workstationOf(state,row.workstationId)?.name || '未分配工位')}</strong></div><div><span>锁定状态</span><strong>${row.isLocked ? '已锁定' : '未锁定'}</strong></div></div>`, confirmText: '关闭' })
}

function rerender(ctx, selector) {
  ctx.rerender()
  if (selector) document.querySelector(selector)?.focus({ preventScroll: true })
}

export const workshopCalendarPage = {
  render({ state }) {
    ensureView(state)
    const body = view.tab === 'vehicle' ? vehicleCalendarView(state) : view.tab === 'gantt' ? ganttView(state) : workshopView(state)
    return `<div class="pc-planning wc-page" data-test="workshop-calendar">${pageHeader('车间每日任务日历','按日期汇总多辆机车的每日检修任务，并与单车日历、甘特图保持一致。')}<div class="notice notice-info wc-notice"><span>i</span><div>绿色为正式排程，橙色为待确认草稿，紫色为模拟预览。本阶段仅提供查询，不包含拖动和重新模拟。</div></div>${toolbar(state)}${body}</div>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-wc-tab]').forEach(button => button.addEventListener('click', () => { view.tab = button.dataset.wcTab; if (view.tab === 'vehicle' && !view.vehicleId) view.vehicleId = String(ctx.state.selectedVehicleRepairId || ctx.state.vehicleRepairs[0]?.id || ''); rerender(ctx, `[data-wc-tab="${view.tab}"]`) }))
    document.querySelector('[data-wc-month]')?.addEventListener('change', event => { if (event.target.validity.valid && /^\d{4}-\d{2}$/.test(event.target.value)) { view.month = event.target.value; view.day = `${view.month}-01`; rerender(ctx, '[data-wc-month]') } })
    document.querySelectorAll('[data-wc-month-step]').forEach(button => button.addEventListener('click', () => { view.month = shiftMonth(view.month, Number(button.dataset.wcMonthStep)); view.day = `${view.month}-01`; rerender(ctx, `[data-wc-month-step="${button.dataset.wcMonthStep}"]`) }))
    document.querySelector('[data-wc-today]')?.addEventListener('click', () => { const day = dateKey(new Date()); view.month = day.slice(0,7); view.day = day; rerender(ctx, '[data-wc-today]') })
    document.querySelector('[data-wc-filter]')?.addEventListener('change', event => { view.vehicleId = event.target.value; if (view.vehicleId) ctx.state.selectedVehicleRepairId = Number(view.vehicleId); rerender(ctx, '[data-wc-filter]') })
    document.querySelectorAll('[data-wc-day]').forEach(cell => {
      const select = () => { view.day = cell.dataset.wcDay; if (!view.day.startsWith(view.month)) view.month = view.day.slice(0,7); rerender(ctx, `[data-wc-day="${view.day}"]`) }
      cell.addEventListener('click', event => { if (!event.target.closest('button')) select() })
      cell.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } })
    })
    document.querySelectorAll('[data-wc-more]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); view.day = button.dataset.wcMore; rerender(ctx, `[data-wc-day="${view.day}"]`) }))
    document.querySelectorAll('[data-wc-day-vehicle]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); view.day = button.dataset.wcEventDay; view.expandedDayVehicles.add(Number(button.dataset.wcDayVehicle)); rerender(ctx, `[data-wc-toggle-vehicle="${button.dataset.wcDayVehicle}"]`) }))
    document.querySelectorAll('[data-wc-toggle-vehicle]').forEach(button => button.addEventListener('click', () => { const id = Number(button.dataset.wcToggleVehicle); view.expandedDayVehicles.has(id) ? view.expandedDayVehicles.delete(id) : view.expandedDayVehicles.add(id); rerender(ctx, `[data-wc-toggle-vehicle="${id}"]`) }))
    document.querySelectorAll('[data-wc-jump-day]').forEach(button => button.addEventListener('click', () => { if (!button.dataset.wcJumpDay) return; view.day = button.dataset.wcJumpDay; view.month = view.day.slice(0,7); rerender(ctx, `[data-wc-day="${view.day}"]`) }))
    document.querySelectorAll('[data-wc-task]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); showTask(ctx.state, button.dataset.wcTask, button.dataset.wcKind) }))
    document.querySelectorAll('[data-wc-workshop-vehicle]').forEach(input => input.addEventListener('change', () => { const id = Number(input.value); view.workshopVehicleIds = input.checked ? [...new Set([...view.workshopVehicleIds,id])] : view.workshopVehicleIds.filter(item => item !== id); rerender(ctx, '.wc-workshop-picker summary') }))
    document.querySelectorAll('[data-wc-gantt-vehicle]').forEach(input => input.addEventListener('change', () => { const id = Number(input.value); view.ganttVehicleIds = input.checked ? [...new Set([...view.ganttVehicleIds,id])] : view.ganttVehicleIds.filter(item => item !== id); view.ganttRange = null; rerender(ctx, '.wc-multi-select summary') }))
    document.querySelectorAll('[data-gantt-range]').forEach(input => input.addEventListener('change', () => { const start = document.querySelector('[data-gantt-range="start"]')?.value; const end = document.querySelector('[data-gantt-range="end"]')?.value; if (start && end && start <= end) { view.ganttRange = { start, end }; rerender(ctx, `[data-gantt-range="${input.dataset.ganttRange}"]`) } }))
    document.querySelector('[data-gantt-reset]')?.addEventListener('click', () => { view.ganttRange = null; rerender(ctx, '[data-gantt-reset]') })
    document.querySelector('[data-wc-export]')?.addEventListener('click', async event => {
      const button = event.currentTarget
      const selectedIds = new Set(view.ganttVehicleIds)
      const allRows = planningTasks(ctx.state).filter(row => selectedIds.has(row.vehicleRepairId))
      const range = view.ganttRange || autoGanttRange(allRows)
      const rows = ganttRowsInRange(allRows, range)
      button.disabled = true; button.textContent = '正在导出…'
      try {
        const blob = await createScheduleExport(ctx.state, rows)
        const url = URL.createObjectURL(blob), link = document.createElement('a')
        link.href = url; link.download = `多车检修任务_${range.start}_${range.end}.xlsx`; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        toast('导出完成', `已导出${rows.length}项任务，时间精确到分钟`)
      } catch (error) { toast('导出失败', error.message || '请稍后重试', 'warning') }
      finally { const next = document.querySelector('[data-wc-export]'); if (next) { next.disabled = false; next.textContent = '导出 Excel' } }
    })
    document.querySelector('[data-wc-gantt-scroll]')?.addEventListener('wheel', event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); event.currentTarget.scrollLeft += event.deltaY } }, { passive: false })
  },
}
