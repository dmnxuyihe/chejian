import { pageHeader, statCard, emptyState } from '../../../shared/templates.js'
import { escapeHtml as esc, toast } from '../../../core/ui.js'
import { fmtFullDateTime, fmtDateTime, taskOf, workstationOf, taskStatusLabel } from '../../../core/derived.js'
import { plansCrudPage } from './plans-crud.js'
import { commitImport, readPlanFile, templateCsv, validateImport } from '../../../core/plan-import.js'
import { confirmedExit, dateKey, ensurePlanningView, planningTasks, plansInMonth, shiftMonth, tasksOnDay } from '../../../core/planning-view.js'
import { calendarGrid, kindLabel, monthlyEvents, taskEvents, taskTable } from '../../../shared/planning-calendar.js'
import { renderGantt, renderGanttToolbar, rowsInGanttRange } from '../../../shared/gantt.js'
import { parseDemoSnapshot } from '../../../core/demo-persistence.js'
import { createPlanTemplate } from '../../../shared/plan-template.js'

function downloadBackup(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url
  a.download = `PC1演示备份_${new Date().toLocaleDateString('sv-SE')}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function dataTools(view, persistence) {
  if (!persistence) return ''
  const status = persistence.status
  const database = status.storage === 'postgresql'
  return `<section class="pc-data-tools" aria-label="演示数据保存与恢复">
    <div class="pc-save-row"><span role="status" class="${status.ok ? '' : 'pc-error-text'}">${esc(status.message)}${status.savedAt && status.ok ? ` · ${fmtFullDateTime(status.savedAt)}` : ''}</span><button class="btn btn-sm" data-pc-data-tools aria-expanded="${!!view.dataToolsOpen}">保存与恢复</button></div>
    ${view.dataToolsOpen ? `<div class="pc-data-actions"><p class="pc-help">${database ? '计划和排程保存在PostgreSQL，同一服务下共享。恢复或复位会替换共享数据；界面筛选各自独立。' : '自动保存在当前浏览器和地址。可导出备份带到其他电脑；复位恢复项目初始演示数据。'}</p><div class="pc-filters"><button class="btn btn-sm" data-pc-backup>导出备份</button><button class="btn btn-sm" data-pc-restore>恢复备份</button><button class="btn btn-sm" data-pc-reset>复位演示数据</button>${database ? '<button class="btn btn-sm" data-pc-save-retry>重试保存</button><button class="btn btn-sm" data-pc-db-reload>加载数据库最新数据</button>' : ''}${database && persistence.hasLocalBackup() ? '<button class="btn btn-sm" data-pc-migrate>迁移本机旧数据</button>' : ''}${view.undoBackup ? '<button class="btn btn-sm" data-pc-undo-data>撤销上次恢复或复位</button>' : ''}</div>
    <input type="file" accept=".json" data-pc-backup-file hidden aria-label="选择PC1演示备份">
    ${view.dataAction ? `<div class="pc-data-confirm" role="region" aria-label="确认数据替换"><h3>${view.dataAction.type === 'reload' ? '加载数据库最新数据' : view.dataAction.type === 'reset' ? '确认复位演示数据' : '确认恢复备份'}</h3><p>${view.dataAction.type === 'reload' ? '将放弃本页未保存的修改，加载数据库中的最新记录。' : view.dataAction.type === 'reset' ? '将替换当前计划和排程，回到项目初始演示数据。' : `备份包含${view.dataAction.vehicles}辆车、${view.dataAction.tasks}条任务，将替换当前演示数据。` }操作前会下载当前备份${view.dataAction.type === 'reload' ? '。' : '；本页可撤销。'}</p><button class="btn" data-pc-cancel-data>取消</button> <button class="btn btn-primary" data-pc-confirm-data>${view.dataAction.type === 'reload' ? '备份当前修改并加载' : view.dataAction.type === 'reset' ? '备份当前数据并复位' : '备份当前数据并恢复'}</button></div>` : ''}
    </div>` : ''}</section>`
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = '月度检修计划导入模板.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toolbar(state, view) {
  return `<div class="pc-toolbar">
    <div class="tabs" aria-label="计划视图">${[['monthly', '月度计划'], ['vehicle', '单车检修'], ['workshop', '车间任务']].map(([key, label]) => `<button class="tab ${view.tab === key ? 'active' : ''}" data-pc-tab="${key}" aria-pressed="${view.tab === key}">${label}</button>`).join('')}</div>
    <div class="pc-filters"><button class="btn btn-sm" data-pc-month-step="-1" aria-label="上个月">上一月</button><label class="pc-month-label">月份<input class="input" type="month" min="1900-01" max="2199-12" value="${view.month}" data-pc-month></label><button class="btn btn-sm" data-pc-month-step="1" aria-label="下个月">下一月</button>
    ${view.tab !== 'vehicle' ? `<label>车辆<select class="select" data-pc-filter><option value="">全部车辆</option>${state.vehicleRepairs.map(v => `<option value="${v.id}" ${String(v.id) === view.vehicleFilter ? 'selected' : ''}>${esc(v.locomotiveNo)}</option>`).join('')}</select></label>` : ''}</div>
  </div>`
}

function planTable(state, vehicles, readOnly = false) {
  return `<div class="table-wrap"><table><thead><tr><th>机车号</th><th>入段时间</th><th>要求完成</th><th>已排出段</th><th>排程状态</th><th>操作</th></tr></thead><tbody>${vehicles.map(v => {
    const exit = confirmedExit(state, v.id)
    const version = state.scheduleVersions.find(s => s.id === v.currentVersionId)
    return `<tr><td><button class="pc-link mono" data-pc-vehicle="${v.id}">${esc(v.locomotiveNo)}</button></td><td>${fmtFullDateTime(v.plannedEntryAt)}</td><td>${fmtFullDateTime(v.plannedExitAt)}</td><td>${exit ? fmtFullDateTime(exit) : '尚未确认排程'}</td><td><span class="badge ${exit ? 'badge-green' : 'badge-amber'}">${exit ? '正式排程' : version ? '未确认' : '待排程'}</span></td><td><div class="table-actions"><button class="btn btn-sm" data-pc-vehicle="${v.id}">单车详情</button>${!readOnly && v.status === 'DRAFT' ? `<button class="btn btn-sm" data-edit-plan="${v.id}">编辑</button><button class="btn btn-sm btn-danger" data-delete-plan="${v.id}">删除</button>` : ''}</div></td></tr>`
  }).join('') || '<tr><td colspan="6" class="empty">本月暂无计划，请切换月份或导入月度计划</td></tr>'}</tbody></table></div>`
}

function importPanel(view) {
  const report = view.importReport
  if (!report) return ''
  const counts = ['ready', 'duplicate', 'error'].map(s => report.rows.filter(r => r.status === s).length)
  return `<section class="card pc-import-panel" aria-labelledby="pc-import-heading">
    <div class="card-title-row"><div><h2 id="pc-import-heading" class="card-title">导入预览 · ${esc(report.name)}</h2><p role="status">${counts[0]}行可导入，${counts[1]}行重复跳过，${counts[2]}行错误跳过。确认后仅保存有效行。</p></div><button class="btn" data-pc-cancel-import>取消导入</button></div>
    <div class="table-wrap pc-import-rows"><table><thead><tr><th>源行</th><th>机车号</th><th>入段日期</th><th>要求完成</th><th>校验结果</th></tr></thead><tbody>${report.rows.map(r => `<tr><td>${r.line}</td><td>${esc(r.data.locomotiveNo)}</td><td>${esc(r.data.plannedEntryAt.replace('T', ' '))}</td><td>${esc(r.data.plannedExitAt.replace('T', ' '))}</td><td class="${r.status === 'error' ? 'pc-error-text' : ''}">${esc(r.message)}</td></tr>`).join('')}</tbody></table></div>
    <div class="pc-import-actions"><span>导入后为待排程计划，不会自动生成正式排程。</span><button class="btn btn-primary" data-pc-confirm-import ${counts[0] ? '' : 'disabled'}>确认导入${counts[0]}行</button></div>
  </section>`
}

function monthly(state, view, readOnly = false) {
  const vehicles = state.vehicleRepairs.filter(v => !view.vehicleFilter || v.id === Number(view.vehicleFilter))
  const eventsForDay = day => monthlyEvents(state, vehicles, confirmedExit, day)
  const monthVehicles = plansInMonth(state, view.month).filter(v => !view.vehicleFilter || v.id === Number(view.vehicleFilter))
  const selected = view.day && view.day.startsWith(view.month) ? eventsForDay(view.day) : []
  return `${readOnly ? '' : importPanel(view)}<section class="card"><div class="card-title-row"><div><h2 class="card-title">${esc(view.month)} 月度检修计划</h2><div class="card-subtitle">点击车辆查看单车任务；已排出段取正式排程最后任务的结束时间。</div></div><div class="pc-legend"><span class="pc-entry">入段</span><span class="pc-exit">已排出段</span></div></div>
    ${calendarGrid({ month: view.month, selectedDay: view.day, eventsForDay })}
    ${view.day ? `<div class="pc-day-detail" aria-live="polite"><h3>${esc(view.day)} 入出段明细</h3>${selected.length ? selected.map(e => `<button class="btn btn-sm" data-pc-vehicle="${e.vehicleId}">${esc(e.label)}</button>`).join(' ') : '<p>当日暂无车辆入出段。</p>'}</div>` : ''}</section>
    <section class="card"><div class="card-title-row"><h2 class="card-title">本月计划 · ${monthVehicles.length}辆</h2></div>${planTable(state, monthVehicles, readOnly)}</section>`
}

function tasksCalendar(state, view, rows, title) {
  const day = view.day?.startsWith(view.month) ? view.day : ''
  return `<section class="card"><div class="card-title-row"><div><h2 class="card-title">${esc(title)}</h2><div class="card-subtitle">跨日任务按每天显示；点击日期查看全部任务。</div></div><div class="pc-legend"><span class="pc-formal">正式</span><span class="pc-preview">模拟 / 待确认</span></div></div>
    ${calendarGrid({ month: view.month, selectedDay: day, eventsForDay: d => taskEvents(state, rows, d) })}
    ${day ? `<div class="pc-day-detail" aria-live="polite"><h3>${day} · ${tasksOnDay(rows, day).length}项任务</h3>${taskTable(state, tasksOnDay(rows, day))}</div>` : '<p class="pc-help">选择一个日期查看任务明细。</p>'}</section>`
}

function vehicleView(state, view) {
  const vehicle = state.vehicleRepairs.find(v => v.id === state.selectedVehicleRepairId) || state.vehicleRepairs[0]
  if (!vehicle) return `<section class="card">${emptyState('暂无车辆计划', '先导入月度计划或新增检修计划。')}</section>`
  const rows = planningTasks(state, vehicle.id)
  const completed = rows.filter(s => s.status === 'COMPLETED').length
  const exit = confirmedExit(state, vehicle.id)
  const monthRange = { start: `${view.month}-01`, end: dateKey(new Date(Number(view.month.slice(0, 4)), Number(view.month.slice(5)), 0)) }
  const monthRows = rowsInGanttRange(rows, monthRange)
  const autoRange = monthRows.length ? { start: dateKey(Math.min(...monthRows.map(s => new Date(s.plannedStartAt).getTime()))), end: dateKey(Math.max(...monthRows.map(s => new Date(s.plannedEndAt).getTime()))) } : monthRange
  const range = view.ganttRange?.key === `${vehicle.id}-${view.month}` ? view.ganttRange : autoRange
  const visible = rowsInGanttRange(rows, range)
  return `<section class="card"><div class="card-title-row"><h2 class="card-title">单车检修信息</h2><label>车辆<select class="select" data-pc-detail-vehicle>${state.vehicleRepairs.map(v => `<option value="${v.id}" ${v.id === vehicle.id ? 'selected' : ''}>${esc(v.locomotiveNo)}</option>`).join('')}</select></label></div>
    <div class="detail-grid"><div><span>入段时间</span><strong>${fmtFullDateTime(vehicle.plannedEntryAt)}</strong></div><div><span>要求完成日期</span><strong>${fmtFullDateTime(vehicle.plannedExitAt)}</strong></div><div><span>已排出段时间</span><strong>${exit ? fmtFullDateTime(exit) : '尚未确认排程'}</strong></div><div><span>任务进度</span><strong>${completed} / ${rows.length} 已完成</strong></div></div>
    <div class="pc-progress"><progress value="${completed}" max="${Math.max(rows.length, 1)}" aria-label="任务完成进度"></progress><span>${rows.length ? Math.round(completed / rows.length * 100) : 0}%</span></div>
    ${rows.length ? '' : '<p class="pc-help">本车尚无排程结果。完成模拟排程后，日历和甘特图会显示本车任务。</p>'}</section>
    ${tasksCalendar(state, view, rows, `${vehicle.locomotiveNo} 每日检修任务`)}
    <section class="card"><div class="card-title-row"><h2 class="card-title">${esc(vehicle.locomotiveNo)} 甘特图</h2><span class="pc-help">可单独调整日期范围；点击任务查看详情</span></div>${renderGanttToolbar({ range, count: visible.length }).replace('data-gantt-range="start"', 'data-gantt-range="start" aria-label="甘特图开始日期"').replace('data-gantt-range="end"', 'data-gantt-range="end" aria-label="甘特图结束日期"').replace('恢复全部范围', '恢复本月任务范围')}<div class="pc-gantt-scroll">${renderGantt({ rows: visible, range, labelFor: s => taskOf(state, s.taskId)?.name || '任务', metaFor: s => `${kindLabel[s.planKind]} · ${fmtDateTime(s.plannedStartAt)} → ${fmtDateTime(s.plannedEndAt)}`, barClassFor: s => `${taskOf(state, s.taskId)?.process === '构架' ? 'frame' : ''} ${s.isLocked ? 'locked' : ''}`, attributesFor: s => `data-pc-task="${s.id}" data-pc-kind="${s.planKind}"`, emptyText: '当前日期范围暂无排程任务' })}</div><div data-pc-task-detail aria-live="polite"></div></section>`
}

function workshop(state, view) {
  const rows = planningTasks(state, view.vehicleFilter || null)
  return tasksCalendar(state, view, rows, `${view.month} 车间每日检修任务`)
}

function refresh(ctx, focusSelector) {
  ctx.rerender()
  if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true })
}

export const demoPlanningPage = {
  render({ state, demoPersistence, planningReadOnly = false }) {
    const view = ensurePlanningView(state)
    const inMonth = plansInMonth(state, view.month)
    return `<div class="pc-planning" data-test="pc1-planning">${pageHeader(planningReadOnly ? '月度计划日历查询' : '检修计划日历', planningReadOnly ? '按月份、车辆查询入出段及每日检修任务。' : '导入月度计划，查看车辆入出段、单车检修任务与车间每日任务。', planningReadOnly ? '' : `<button class="btn" data-pc-xlsx-template>下载Excel模板</button><button class="btn" data-pc-template>CSV模板</button><button class="btn btn-primary" data-pc-import ${view.importBusy ? 'disabled' : ''}>导入月度计划</button><button class="btn" data-add-plan>新增检修计划</button>`)}
      <input type="file" accept=".xlsx,.csv" data-pc-file hidden aria-label="选择月度计划文件">
      <div class="pc-file-status" role="status" data-pc-file-status>${planningReadOnly ? '' : esc(view.importStatus || '')}</div>
      ${planningReadOnly ? `<p class="pc-help" data-pc-query-status role="status">${esc(demoPersistence?.status.message || '')}</p>` : dataTools(view, demoPersistence)}
      <div class="grid grid-4 pc-stats">${statCard('本月关联车辆', inMonth.length, '入出段或本月有任务')}${statCard('本月入段', state.vehicleRepairs.filter(v => dateKey(v.plannedEntryAt).startsWith(view.month)).length, '计划入段', 'metric-indigo')}${statCard('本月已排出段', state.vehicleRepairs.filter(v => dateKey(confirmedExit(state, v.id)).startsWith(view.month)).length, '依据正式排程', 'metric-green')}${statCard('本月任务', planningTasks(state).filter(s => new Date(s.plannedStartAt) < new Date(`${shiftMonth(view.month, 1)}-01T00:00:00`) && new Date(s.plannedEndAt) > new Date(`${view.month}-01T00:00:00`)).length, '含模拟与待确认结果')}</div>
      ${toolbar(state, view)}${view.tab === 'vehicle' ? vehicleView(state, view) : view.tab === 'workshop' ? workshop(state, view) : monthly(state, view, planningReadOnly)}</div>`
  },
  mount(ctx) {
    if (!ctx.planningReadOnly) plansCrudPage.mount(ctx)
    const view = ensurePlanningView(ctx.state)
    const persistence = ctx.demoPersistence
    document.querySelector('[data-pc-xlsx-template]')?.addEventListener('click', async e => {
      const button = e.currentTarget; button.disabled = true
      try {
        const url = URL.createObjectURL(await createPlanTemplate())
        const a = document.createElement('a'); a.href = url; a.download = '月度检修计划导入模板.xlsx'; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch { toast('模板生成失败', '请重试或使用CSV模板', 'warning') }
      finally { button.disabled = false }
    })
    document.querySelector('[data-pc-save-retry]')?.addEventListener('click', async () => { const result = await persistence.save(); toast(result.ok ? '数据库保存完成' : '未保存', result.message, result.ok ? 'success' : 'warning') })
    document.querySelector('[data-pc-db-reload]')?.addEventListener('click', () => { view.dataAction = { type: 'reload' }; refresh(ctx, '[data-pc-confirm-data]') })
    document.querySelector('[data-pc-migrate]')?.addEventListener('click', () => {
      const text = persistence.localBackup()
      if (!text) return toast('没有可迁移的数据', '本机旧记录不存在或无法读取', 'warning')
      const backup = parseDemoSnapshot(text)
      view.dataAction = { type: 'restore', text, vehicles: backup.data.vehicleRepairs.length, tasks: backup.data.schedules.length }
      refresh(ctx, '[data-pc-confirm-data]')
    })
    document.querySelector('[data-pc-data-tools]')?.addEventListener('click', () => { view.dataToolsOpen = !view.dataToolsOpen; delete view.dataAction; refresh(ctx, '[data-pc-data-tools]') })
    document.querySelector('[data-pc-backup]')?.addEventListener('click', () => {
      try { downloadBackup(persistence.export()); toast('备份已导出', '可使用恢复备份加载此文件') }
      catch (error) { toast('无法导出', error.message, 'warning') }
    })
    document.querySelector('[data-pc-restore]')?.addEventListener('click', () => document.querySelector('[data-pc-backup-file]').click())
    document.querySelector('[data-pc-backup-file]')?.addEventListener('change', async e => {
      const file = e.target.files[0]
      if (!file) return
      try {
        if (file.size > 12 * 1024 * 1024) throw new Error('备份不得超过12MB')
        const text = await file.text()
        const backup = parseDemoSnapshot(text)
        view.dataAction = { type: 'restore', text, vehicles: backup.data.vehicleRepairs.length, tasks: backup.data.schedules.length }
        refresh(ctx, '[data-pc-confirm-data]')
      } catch (error) { toast('备份无法恢复', error.message, 'warning') }
      finally { e.target.value = '' }
    })
    document.querySelector('[data-pc-reset]')?.addEventListener('click', () => { view.dataAction = { type: 'reset' }; refresh(ctx, '[data-pc-confirm-data]') })
    document.querySelector('[data-pc-cancel-data]')?.addEventListener('click', () => { delete view.dataAction; refresh(ctx, '[data-pc-data-tools]') })
    document.querySelector('[data-pc-confirm-data]')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true
      try {
        const previous = persistence.export()
        downloadBackup(previous)
        const action = view.dataAction.type
        const result = await (action === 'reload' ? persistence.load() : action === 'reset' ? persistence.reset() : persistence.restore(view.dataAction.text))
        if (!result.ok) { toast('操作未完成', result.message, 'warning'); return }
        const nextView = ensurePlanningView(ctx.state)
        delete nextView.dataAction
        nextView.dataToolsOpen = true
        if (action !== 'reload') { nextView.undoBackup = previous; nextView.undoRevision = persistence.revision }
        refresh(ctx, action === 'reload' ? '[data-pc-data-tools]' : '[data-pc-undo-data]'); toast('数据已加载', action === 'reload' ? '已读取数据库最新记录' : '已下载操作前备份，本页可撤销')
      } catch (error) { toast('操作未完成', error.message, 'warning') }
      finally { const button = document.querySelector('[data-pc-confirm-data]'); if (button) button.disabled = false }
    })
    document.querySelector('[data-pc-undo-data]')?.addEventListener('click', async () => {
      if (persistence.status.storage === 'postgresql' && persistence.revision !== view.undoRevision) return toast('不能直接撤销', '共享数据已有新修改，请核对备份后再恢复', 'warning')
      const result = await persistence.restore(view.undoBackup)
      if (result.ok) { ensurePlanningView(ctx.state).dataToolsOpen = true; refresh(ctx, '[data-pc-data-tools]'); toast('已撤销', '已恢复操作前的演示数据') }
      else toast('撤销失败', result.message, 'warning')
    })
    document.querySelector('[data-pc-template]')?.addEventListener('click', downloadTemplate)
    document.querySelector('[data-pc-import]')?.addEventListener('click', () => document.querySelector('[data-pc-file]').click())
    document.querySelector('[data-pc-file]')?.addEventListener('change', async e => {
      const file = e.target.files[0]
      if (!file) return
      const requestId = (view.importReadId || 0) + 1
      view.importReadId = requestId; view.importBusy = true
      view.importStatus = `正在读取并校验 ${file.name}…`
      delete view.importReport
      refresh(ctx)
      try {
        const matrix = await readPlanFile(file)
        if (view.importReadId !== requestId) return
        view.importReport = { name: file.name, matrix, rows: validateImport(matrix, ctx.state) }
        view.tab = 'monthly'; view.importStatus = ''
      } catch (error) {
        if (view.importReadId === requestId) { view.importStatus = `导入失败：${error.message}`; toast('导入失败', error.message, 'warning') }
      } finally {
        if (view.importReadId === requestId) { view.importBusy = false; refresh(ctx, view.importReport ? '[data-pc-confirm-import]' : '[data-pc-import]') }
      }
    })
    document.querySelector('[data-pc-cancel-import]')?.addEventListener('click', () => { delete view.importReport; refresh(ctx, '[data-pc-import]') })
    document.querySelector('[data-pc-confirm-import]')?.addEventListener('click', async () => {
      try {
        if (!view.importReport || view.importBusy) return
        const result = commitImport(ctx.state, view.importReport.matrix)
        if (result.ids.length) view.month = ctx.state.vehicleRepairs.find(v => v.id === result.ids[0]).plannedEntryAt.slice(0, 7)
        view.vehicleFilter = ''; view.day = ''; delete view.importReport
        refresh(ctx, '[data-pc-import]')
        const saved = await ctx.demoPersistence?.save()
        if (saved && !saved.ok) toast('导入尚未保存', '数据保留在当前页面，请查看保存状态并重试', 'warning')
        else toast('导入完成', `新增${result.ids.length}辆；错误或重复行已跳过`)
      } catch (error) { toast('导入失败', error.message, 'warning') }
    })
    document.querySelectorAll('[data-pc-tab]').forEach(b => b.addEventListener('click', () => { view.tab = b.dataset.pcTab; refresh(ctx, `[data-pc-tab="${view.tab}"]`) }))
    document.querySelector('[data-pc-month]')?.addEventListener('change', e => { if (/^\d{4}-\d{2}$/.test(e.target.value) && e.target.validity.valid) { view.month = e.target.value; view.day = ''; refresh(ctx, '[data-pc-month]') } })
    document.querySelectorAll('[data-pc-month-step]').forEach(b => b.addEventListener('click', () => {
      const month = shiftMonth(view.month, Number(b.dataset.pcMonthStep))
      if (month >= '1900-01' && month <= '2199-12') { view.month = month; view.day = ''; refresh(ctx, `[data-pc-month-step="${b.dataset.pcMonthStep}"]`) }
    }))
    document.querySelector('[data-pc-filter]')?.addEventListener('change', e => { view.vehicleFilter = e.target.value; refresh(ctx, '[data-pc-filter]') })
    document.querySelectorAll('[data-pc-day]').forEach(b => b.addEventListener('click', () => {
      view.day = b.dataset.pcDay; view.month = view.day.slice(0, 7)
      refresh(ctx, `[data-pc-day="${view.day}"]`)
    }))
    document.querySelectorAll('[data-pc-vehicle]').forEach(b => b.addEventListener('click', () => {
      ctx.state.selectedVehicleRepairId = Number(b.dataset.pcVehicle); view.tab = 'vehicle'
      refresh(ctx, '[data-pc-detail-vehicle]')
    }))
    document.querySelector('[data-pc-detail-vehicle]')?.addEventListener('change', e => { ctx.state.selectedVehicleRepairId = Number(e.target.value); refresh(ctx, '[data-pc-detail-vehicle]') })
    document.querySelectorAll('[data-gantt-range]').forEach(input => input.addEventListener('change', () => {
      if (!input.value || !input.validity.valid) return
      const start = document.querySelector('[data-gantt-range="start"]').value
      const end = document.querySelector('[data-gantt-range="end"]').value
      if (start > end) { toast('日期范围无效', '开始日期不得晚于结束日期', 'warning'); return }
      view.ganttRange = { key: `${ctx.state.selectedVehicleRepairId}-${view.month}`, start, end }
      refresh(ctx, `[data-gantt-range="${input.dataset.ganttRange}"]`)
    }))
    document.querySelector('[data-gantt-reset]')?.addEventListener('click', () => { delete view.ganttRange; refresh(ctx, '[data-gantt-reset]') })
    document.querySelectorAll('[data-pc-task]').forEach(b => b.addEventListener('click', () => {
      const s = planningTasks(ctx.state, ctx.state.selectedVehicleRepairId).find(s => s.id === Number(b.dataset.pcTask) && s.planKind === b.dataset.pcKind)
      if (!s) return
      document.querySelector('[data-pc-task-detail]').innerHTML = `<div class="pc-day-detail"><h3>${esc(taskOf(ctx.state, s.taskId)?.name || '任务')}</h3><p>${kindLabel[s.planKind]} · ${esc(taskStatusLabel(s.status))}${s.isLocked ? ' · 已锁定' : ''} · ${esc(workstationOf(ctx.state, s.workstationId)?.name || '未分配工位')}</p><p>${fmtFullDateTime(s.plannedStartAt)} → ${fmtFullDateTime(s.plannedEndAt)}</p></div>`
    }))
  },
}

export const monthlyQueryPage = {
  render(ctx) { return demoPlanningPage.render({ ...ctx, planningReadOnly: true }) },
  mount(ctx) { demoPlanningPage.mount({ ...ctx, planningReadOnly: true }) },
}
