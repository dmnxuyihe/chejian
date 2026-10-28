import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import * as XLSX from '@e965/xlsx'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const schema = `pc1_test_plans_ui_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
let server
const output = process.env.PC1_QA_DIR || 'test-artifacts/planning-page'
const headers = ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注']
const csv = rows => `\uFEFF${[headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}\r\n`

try {
  await db.init()
  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const pageErrors = []
  const requestIssues = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('requestfailed', request => requestIssues.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`))
  try {
    await page.goto(`${base}/#/planning/plans`)
    await page.locator('.pc-plan-records').waitFor()
    assert.equal(await page.locator('.pc-plan-calendar').count(), 0, 'import page must not show a calendar')
    assert.equal(await page.locator('[data-import-type]').inputValue(), 'MONTHLY')
    const dictionary = await page.evaluate(async () => (await (await fetch('/api/planning/lookups')).json()))
    const model = dictionary.models.find(item => item.name === 'HXD1C')
    const program = dictionary.programs.find(item => item.name === 'HXD1C高级修' && item.modelId === model.id)
    assert.ok(model && program, 'test fixture must use enabled database dictionaries')
    await page.locator('[data-import-month]').fill('2027-11')
    await page.locator('[data-import-month]').dispatchEvent('change')

    await page.locator('[data-open-manual]').click()
    await page.locator('[data-manual-loco]').fill('TEST-MANUAL-01')
    await page.locator('[data-manual-model]').selectOption('HXD1C')
    await page.locator('[data-manual-program]').selectOption('HXD1C高级修')
    await page.locator('[data-manual-date]').fill('2027-11-05')
    const beforeManual = await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)
    await page.locator('[data-manual-preview]').click()
    await page.locator('.pc-plan-preview').waitFor()
    assert.match(await page.locator('.pc-plan-preview').innerText(), /可导入1行，错误0行/)
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)).rows[0].n, beforeManual.rows[0].n, 'manual preview must not write')
    await page.locator('[data-confirm-import]').click()
    await page.locator('.pc-plan-result').waitFor()
    await page.locator('[data-dismiss-result]').click()
    assert.ok((await page.locator('.pc-plan-records').innerText()).includes('TEST-MANUAL-01'), 'manual plan must appear in database-backed plan list')

    const templateXlsx = page.waitForEvent('download')
    await page.getByRole('link', { name: '下载 XLSX 模板' }).click()
    assert.equal((await templateXlsx).suggestedFilename(), '检修计划导入模板.xlsx')
    const templateCsv = page.waitForEvent('download')
    await page.getByRole('link', { name: '下载 CSV 模板' }).click()
    assert.equal((await templateCsv).suggestedFilename(), '检修计划导入模板.csv')

    await page.locator('[data-import-month]').fill('2027-11')
    const before = await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)
    const invalidMixed = csv([
      ['TEST-CANCEL-01', 'HXD1C', 'HXD1C高级修', '', '2027/12/03', '', '', '', 'valid row in another month'],
      ['TEST-CANCEL-02', 'NO-MODEL', 'HXD1C高级修', '0', '2027-11-04', '', '', '-1', 'multiple invalid fields'],
    ])
    await page.locator('[data-plan-file]').setInputFiles({ name: '混合错误.csv', mimeType: 'text/csv', buffer: Buffer.from(invalidMixed) })
    await page.waitForFunction(() => document.querySelector('.pc-plan-preview') || (document.querySelector('.pc-plan-message')?.textContent.trim() && !document.querySelector('.pc-plan-message').textContent.includes('正在上传')), null, { timeout: 10000 }).catch(() => {})
    assert.equal(await page.locator('.pc-plan-preview').count(), 1, `file preview failed: ${await page.locator('.pc-plan-message').innerText()} | ${requestIssues.join('; ')} | ${pageErrors.join('; ')}`)
    assert.match(await page.locator('.pc-plan-preview').innerText(), /可导入1行，错误1行/)
    assert.ok((await page.locator('.pc-plan-preview').innerText()).includes('2027-12-03'), 'slash dates normalize to YYYY-MM-DD and monthly imports allow another month')
    const invalidPreviewText = await page.locator('.pc-plan-preview').innerText()
    assert.ok(invalidPreviewText.includes('NO-MODEL') && invalidPreviewText.includes('机型；修次；累计走行公里'), 'error rows must show original values and semicolon-joined fields')
    assert.ok(invalidPreviewText.includes('机型不在有效字典中；修次必须是正整数；必须为非负数，最多1位小数'), 'semicolon-joined reasons must align with their fields')
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)).rows[0].n, before.rows[0].n, 'preview must not write to the database')
    await page.locator('[data-preview-filter="errors"]').click()
    await page.waitForFunction(() => document.querySelector('[data-preview-filter="errors"]')?.classList.contains('is-active'))
    assert.equal(await page.locator('.pc-plan-preview .pc-plan-preview-table tbody tr').count(), 1, await page.locator('.pc-plan-preview .pc-plan-preview-table tbody').innerText())
    const errorsDownload = page.waitForEvent('download')
    await page.locator('[data-download-errors]').click()
    const errorFile = await errorsDownload
    assert.match(errorFile.suggestedFilename(), /错误明细\.csv/)
    const errorCsv = await fs.readFile(await errorFile.path(), 'utf8')
    assert.ok(errorCsv.includes('原始行号') && errorCsv.includes('原始数据') && errorCsv.includes('错误字段') && errorCsv.includes('错误原因') && errorCsv.includes('NO-MODEL'), 'error CSV must contain source row, original data, fields and reasons')
    assert.ok(errorCsv.includes('机型；修次；累计走行公里'), 'error CSV must group multiple fields on one source row')
    await page.locator('[data-cancel-preview]').click()
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)).rows[0].n, before.rows[0].n, 'cancelling preview must not write')

    const manyRows = Array.from({ length: 15 }, (_, index) => [`TEST-CALENDAR-${String(index + 1).padStart(2, '0')}`, 'HXD1C', 'HXD1C高级修', index === 0 ? '2' : '', '2027-11-03', '测试局', '测试段', index ? '' : '1000.5', `月度计划${index + 1}`])
    await page.locator('[data-plan-file]').setInputFiles({ name: '月度计划.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(manyRows)) })
    await page.locator('.pc-plan-preview').waitFor()
    assert.match(await page.locator('.pc-plan-preview').innerText(), /可导入15行，错误0行/)
    assert.equal(await page.locator('[data-confirm-import]').textContent(), '确认导入15条')
    await page.locator('[data-confirm-import]').click()
    await page.locator('.pc-plan-result').waitFor()
    assert.match(await page.locator('.pc-plan-result').innerText(), /新增15条，未导入0条/)
    await page.locator('[data-dismiss-result]').click()
    assert.ok(await page.locator('[data-nav="g2-p2"]').count(), `calendar route nav missing at ${page.url()}: ${await page.locator('.sidebar').innerText()}`)
    await page.locator('[data-nav="g2-p2"]').click()
    await page.locator('.pc-plan-layout').waitFor()
    assert.equal(await page.locator('[data-import-type]').count(), 0, 'calendar page must not show import controls')
    await page.locator('[data-calendar-month]').fill('2027-11')
    await page.locator('[data-calendar-month]').dispatchEvent('change')
    await page.waitForFunction(() => !document.querySelector('.pc-plan-loading'))
    await page.locator('[data-calendar-day="2027-11-03"]').waitFor()
    const revisionBeforeClick = (await db.pool.query(`SELECT revision FROM "${schema}".application_state WHERE singleton`)).rows[0].revision
    const clickStarted = Date.now()
    const emptyDayCell = page.locator('[data-calendar-day="2027-11-02"]')
    await emptyDayCell.click({ position: { x: 10, y: 50 } })
    const clickElapsed = Date.now() - clickStarted
    assert.ok(clickElapsed < 1000, `calendar date click should respond promptly, took ${clickElapsed}ms`)
    assert.equal((await db.pool.query(`SELECT revision FROM "${schema}".application_state WHERE singleton`)).rows[0].revision, revisionBeforeClick, 'calendar clicks must not persist or write business state')
    assert.equal(await page.locator('.pc-plan-day-card .pc-plan-panel-head p').innerText(), '2027-11-02', 'clicking the blank area of a day cell selects that day')
    await page.locator('[data-select-day="2027-11-03"]').first().click()
    assert.equal(await page.locator('.pc-plan-vehicle-card').count(), 15)
    const focusedDay = page.locator('.pc-plan-day').filter({ has: page.locator('[data-select-day="2027-11-03"]') })
    assert.equal(await focusedDay.locator('.pc-plan-event').count(), 3, 'calendar shows at most three entries in one day')
    const heights = await page.evaluate(() => {
      const a = document.querySelector('.pc-plan-calendar-card').getBoundingClientRect()
      const b = document.querySelector('.pc-plan-day-card').getBoundingClientRect()
      const list = document.querySelector('.pc-plan-day-panel')
      return { left: a.height, right: b.height, listHeight: list.clientHeight, listScroll: list.scrollHeight }
    })
    assert.ok(Math.abs(heights.left - heights.right) < 2, `calendar and details must be equal height: ${JSON.stringify(heights)}`)
    assert.ok(heights.listScroll > heights.listHeight, 'long daily details must scroll inside the right panel')
    assert.ok((await page.locator('.pc-plan-calendar').innerText()).includes('还有12条'))
    await page.locator('[data-filter-model]').selectOption(String(model.id))
    assert.equal(await page.locator('.pc-plan-vehicle-card').count(), 15)
    await page.locator('[data-filter-model]').selectOption('')

    await page.locator('[data-open-vehicle]').first().click()
    await page.locator('.pc-plan-drawer').waitFor()
    assert.ok((await page.locator('.pc-plan-drawer').innerText()).includes('测试局'))
    assert.ok((await page.locator('.pc-plan-drawer').innerText()).includes('尚未正式排程'))
    await page.locator('[data-close-detail]').click()

    await page.locator('[data-select-day="2027-12-01"]').first().click()
    assert.equal(await page.locator('[data-calendar-month]').inputValue(), '2027-12', 'clicking an adjacent-month day must jump the calendar to that month')
    await page.waitForFunction(() => document.querySelector('[data-calendar-month]')?.value === '2027-12' && !document.querySelector('.pc-plan-loading'))
    assert.equal(await page.locator('.pc-plan-day-card .pc-plan-panel-head p').innerText(), '2027-12-01')

    // Follow the existing submit -> schedule -> publish flow on this isolated test database.
    const published = await page.evaluate(async () => {
      const state = window.__APP_STATE__
      const vehicle = state.vehicleRepairs.find(row => row.locomotiveNo === 'TEST-CALENDAR-01')
      const actions = await import('/src/core/actions.js')
      const submitted = actions.submitPlan(state, vehicle.id)
      const scheduled = actions.runAutoSchedule(state, vehicle.id)
      state.selectedVehicleRepairId = vehicle.id
      const released = actions.publishSchedule(state)
      const saved = await window.__APP_DEBUG__.getPersistence().save()
      return { submitted, exceptions: scheduled.exceptionCount, released, saved: saved.ok }
    })
    assert.equal(published.submitted, true)
    assert.equal(published.released, true)
    assert.equal(published.saved, true, JSON.stringify(published))
    const persistedCalendar = await page.evaluate(async () => (await (await fetch('/api/planning/calendar?from=2027-11-01&to=2027-11-30')).json()).vehicles)
    const releasedVehicle = persistedCalendar.find(row => row.locomotiveNo === 'TEST-CALENDAR-01')
    assert.ok(releasedVehicle.confirmedExitDate, 'published CURRENT version must generate an exit date')
    assert.equal(releasedVehicle.versionStatus, 'CURRENT')
    assert.equal((await db.pool.query(`SELECT status FROM "${schema}".vehicle_repair WHERE vehicle_repair_id=$1`, [releasedVehicle.id])).rows[0].status, 'SCHEDULED')

    await page.setViewportSize({ width: 768, height: 900 })
    const stacked = await page.evaluate(() => {
      const calendar = document.querySelector('.pc-plan-calendar-card').getBoundingClientRect()
      const detail = document.querySelector('.pc-plan-day-card').getBoundingClientRect()
      return detail.top >= calendar.bottom
    })
    assert.equal(stacked, true, 'tablet layout must stack the panels')
    await page.setViewportSize({ width: 390, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page must not overflow horizontally')
    await page.screenshot({ path: path.join(output, 'planning-month-mobile.png'), fullPage: true, animations: 'disabled' })
    await page.locator('[data-calendar-month]').fill('2030-01')
    await page.locator('[data-calendar-month]').dispatchEvent('change')
    await page.waitForFunction(() => document.querySelector('.pc-plan-calendar') && !document.querySelector('.pc-plan-calendar').innerText.includes('TEST-CALENDAR'))
    await page.getByText('当前日历范围内暂无匹配的检修计划。').waitFor()
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
    console.log(JSON.stringify({ passed: true, calendarClickMs: clickElapsed, checks: ['separate import and calendar routes', 'manual create through preview and confirmation', 'database-backed plan list and dictionaries', 'xlsx/csv template downloads', 'preview zero-write and cancel zero-write', 'mixed row errors with original values and CSV download', 'monthly import accepts other months and normalizes slash dates', 'calendar click latency and no persistence write', 'adjacent-month date click jumps to the selected month', 'equal desktop panels and inner detail scroll', 'more-than-three daily events', 'model filter', 'vehicle details drawer', 'official schedule publish produces CURRENT exit', 'tablet stacked layout', 'mobile horizontal overflow', 'empty-month state'], screenshots: output }, null, 2))
  } finally { await browser.close() }
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  assert.ok(/^pc1_test_plans_ui_\d+_\d+$/.test(schema), 'only the isolated UI test schema may be removed')
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
