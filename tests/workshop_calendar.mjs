import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { workshopCalendarPage } from '../src/roles/scheduling/pages/workshop-calendar.js'
import { phaseOneRoles } from '../src/roles/phase-one.js'
import { planningTasks } from '../src/core/planning-view.js'
import { scheduleExportRows } from '../src/shared/schedule-export.js'

const state = createState()
const page = phaseOneRoles.scheduling.pages['workshop-calendar']
assert.equal(page, workshopCalendarPage, '生产日历导航应挂载车间任务日历')
const html = page.render({ state })
assert.match(html, /车间每日任务日历/)
assert.match(html, /车间任务日历/)
assert.match(html, /单车日历/)
assert.match(html, /多车甘特图/)
assert.match(html, /正式排程/)
assert.match(html, /data-wc-day=/, '整个日期格应可点击')
assert.match(html, /data-wc-day-vehicle=/, '月历应按车辆聚合而不是逐任务占行')
assert.match(html, /车辆筛选/, '车辆筛选应位于视图选择下方')
assert.match(html, /data-wc-workshop-vehicle/, '车间任务日历应使用车辆多选下拉框')
const exported = scheduleExportRows(state, planningTasks(state))
assert.equal(exported.length, planningTasks(state).length)
assert.ok(exported.every(row => Number.isFinite(row.hours) && row.start && row.end), 'Excel明细应包含开始、结束和小时数')
assert.doesNotMatch(html, /拖动任务/, '当前范围不应提供尚未实现的拖动操作')
console.log('PASS: workshop route, shared task calendar, vehicle views and large day click target')
