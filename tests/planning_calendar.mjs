import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { addPlan, runAutoSchedule, publishSchedule, submitPlan, updatePlan, deletePlan } from '../src/core/actions.js'
import { commitImport, parseCsv, templateCsv, validateImport } from '../src/core/plan-import.js'
import { confirmedExit, dateKey, monthDays, planningTasks, plansInMonth, shiftMonth, tasksOnDay } from '../src/core/planning-view.js'
import { demoPlanningPage } from '../src/roles/planning/pages/demo-planning.js'

const state = createState()
assert.equal(monthDays('2026-02').length, 35)
assert.equal(monthDays('2024-02').filter(d => d.startsWith('2024-02')).length, 29)
assert.equal(monthDays('2026-13').length, 0)
assert.equal(shiftMonth('2026-12', 1), '2027-01')
assert.equal(dateKey(null), '')
assert.deepEqual(parseCsv('\uFEFF车号,备注\r\nA,"两行\n含""引号"""\r\n'), [['车号', '备注'], ['A', '两行\n含"引号"']])
assert.throws(() => parseCsv('a,"b'), /未闭合/)

const matrix = parseCsv(templateCsv)
const before = structuredClone(state)
assert.equal(validateImport(matrix, state).filter(r => r.status === 'ready').length, 2)
assert.deepEqual(state, before, '预览不得修改业务数据')
const imported = commitImport(state, matrix)
assert.equal(imported.ids.length, 2)
assert.equal(commitImport(state, matrix).ids.length, 0, '重复导入不得生成新车')
assert.equal(state.vehicleRepairs.length, 3)
const manual = addPlan(state, { locomotiveNo: ' MANUAL ', plannedEntryAt: '2026-10-27T08:00:00', plannedExitAt: '2026-11-10T18:00:00', priority: 0 })
assert.equal(state.vehicleRepairs.find(v => v.id === manual).priority, 0)
assert.equal(state.vehicleRepairs.find(v => v.id === manual).locomotiveNo, 'MANUAL')
assert.equal(addPlan(state, { locomotiveNo: 'manual', plannedEntryAt: '2026-10-27T09:00:00', plannedExitAt: '2026-11-10T18:00:00' }), null)
assert.equal(updatePlan(state, manual, { locomotiveNo: 'HXD1C-DEMO01' }).ok, false)
state.pc1SchedulePreview = { vehicleRepairIds: [manual], schedules: [] }
assert.equal(deletePlan(state, manual).ok, false, '有模拟草稿的车辆应禁止删除')
assert.equal(updatePlan(state, manual, { priority: 1 }).ok, false)
delete state.pc1SchedulePreview
assert.ok(deletePlan(state, manual).ok)
const invalid = validateImport([
  ['车号', '入段日期', '最晚完成日期'], ['BAD', '2026-02-30', '2026-03-10'],
  ['BAD2', '2026-10-27', '2026-10-26'], ['VALID', '2026-10-27', ''], ['VALID', '2026-10-27', ''],
], state)
assert.deepEqual(invalid.map(r => r.status), ['error', 'error', 'ready', 'duplicate'])
assert.equal(invalid[2].data.plannedExitAt, '2026-11-10T18:00:00')
assert.equal(validateImport([['车号', '入段日期'], ['EXCEL', 46322]], state)[0].data.plannedEntryAt.slice(0, 10), '2026-10-27')

const id = imported.ids[0]
assert.equal(confirmedExit(state, id), null, '要求交车日期不是已排出段日期')
submitPlan(state, id)
assert.equal(planningTasks(state, id).length, 0, '零时长待排占位不应显示成全天任务')
runAutoSchedule(state, id)
assert.equal(planningTasks(state, id).length, 20)
assert.equal(confirmedExit(state, id), null, '未确认排程不得显示正式出段')
assert.equal(planningTasks(state, id)[0].planKind, 'draft')
state.selectedVehicleRepairId = id
assert.ok(publishSchedule(state))
assert.ok(confirmedExit(state, id))
assert.equal(planningTasks(state, id)[0].planKind, 'formal')
const savedRows = structuredClone(state.schedules)
state.pc1SchedulePreview = { vehicleRepairIds: [id], schedules: [{ ...planningTasks(state, id)[0], plannedStartAt: '2026-11-01T23:00:00', plannedEndAt: '2026-11-03T00:00:00' }] }
assert.equal(planningTasks(state, id).length, 1)
assert.equal(planningTasks(state, id)[0].planKind, 'preview')
assert.equal(planningTasks(state, 1).length, 20, '未参与模拟的其他车保持显示')
assert.equal(tasksOnDay(planningTasks(state, id), '2026-11-02').length, 1, '跨日任务逐日显示')
assert.equal(tasksOnDay(planningTasks(state, id), '2026-11-03').length, 0, '午夜结束不占用次日')
assert.ok(plansInMonth(state, '2026-11').some(v => v.id === id), '跨月任务仍可查车辆')
assert.deepEqual(state.schedules, savedRows, '模拟显示不得改正式排程')
const formalExit = confirmedExit(state, id)
state.pc1SchedulePreview.schedules[0].plannedEndAt = '2026-11-04T00:00:00'
assert.equal(confirmedExit(state, id), formalExit, '模拟调整不改变正式出段标记')

const injected = addPlan(state, { locomotiveNo: '<img src=x onerror=alert(1)>', plannedEntryAt: '2026-10-27T08:00:00', plannedExitAt: '2026-11-10T18:00:00' })
state.planningView = { tab: 'monthly', month: '2026-10', vehicleFilter: '', day: '' }
const html = demoPlanningPage.render({ state })
assert.ok(!html.includes('<img src=x'), '导入文本须转义')
assert.ok(html.includes('&lt;img'))
for (const tab of ['vehicle', 'workshop']) {
  state.planningView.tab = tab; state.selectedVehicleRepairId = injected
  assert.ok(demoPlanningPage.render({ state }).includes('pc-calendar'))
}
console.log('PASS: CSV/import validation and deduplication, confirmed exits, draft preview adapter, cross-month/day tasks, view rendering and text escaping')
