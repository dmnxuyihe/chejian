import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { templateCsv } from '../src/core/plan-import.js'

// Optional browser test tooling; the server's runtime dependency is pg.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const JSZip = require('jszip')
const port = 5198
const base = process.env.PC1_BASE_URL || `http://127.0.0.1:${port}`
const localServer = process.env.PC1_BASE_URL ? null : spawn(process.execPath, ['start.js', `--port=${port}`, '--no-open', '--local-demo'], { cwd: process.cwd(), stdio: 'ignore' })
if (localServer) {
  let ready = false
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/config`)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) { localServer.kill(); throw new Error('本地回归服务启动失败') }
}
const out = process.env.PC1_QA_DIR || 'test-artifacts/pc1'
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const state = expression => page.evaluate(expression)
async function screenshot(name) {
  // Exclude transient toast messages and place sticky chrome at its normal location.
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) })
  await page.screenshot({ path: path.join(out, name), fullPage: true, animations: 'disabled' })
}

async function file(name, buffer) {
  await page.locator('[data-pc-file]').setInputFiles({ name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  await page.locator('.pc-import-panel').waitFor()
}

try {
  await page.goto(`${base}/#/planning/plans`)
  await page.locator('[data-test="pc1-planning"]').waitFor()
  assert.equal(await page.locator('.pc-entry.pc-event').count(), 1)
  assert.equal(await page.locator('.pc-exit.pc-event').count(), 1)
  const downloadEvent = page.waitForEvent('download')
  await page.locator('[data-pc-template]').click()
  assert.equal((await downloadEvent).suggestedFilename(), '月度检修计划导入模板.csv')

  const csv = `${templateCsv}BAD,2026-02-30,2026-03-10,80,0,无效日期\r\n`
  await file('月度计划.csv', Buffer.from(csv))
  assert.ok((await page.locator('.pc-import-panel').innerText()).includes('2行可导入，0行重复跳过，1行错误跳过'))
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 1, '确认前不得写入')
  await page.locator('[data-pc-confirm-import]').click()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 3)
  assert.equal(await page.locator('.pc-entry.pc-event').count(), 3)
  assert.equal(await page.locator('.pc-exit.pc-event').count(), 1, '未排车辆不得虚构出段')
  await file('重复.csv', Buffer.from(templateCsv))
  assert.ok(await page.locator('[data-pc-confirm-import]').isDisabled())
  await page.locator('[data-pc-cancel-import]').click()

  // Real XLSX archive with inline strings and numeric Excel dates.
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="月度计划" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>车号</t></is></c><c r="B1" t="inlineStr"><is><t>入段日期</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>XLSX-TEST</t></is></c><c r="B2"><v>46322</v></c></row></sheetData></worksheet>')
  await file('计划.xlsx', await zip.generateAsync({ type: 'nodebuffer' }))
  assert.ok((await page.locator('.pc-import-panel').innerText()).includes('XLSX-TEST'))
  await page.locator('[data-pc-confirm-import]').click()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)
  await page.locator('[data-pc-file]').setInputFiles({ name: '损坏.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') })
  await page.getByText(/导入失败：/).waitFor()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)

  // Prepare real two-car schedules through existing scheduler APIs.
  await page.evaluate(async () => {
    const { submitPlan, runAutoSchedule, publishSchedule } = await import('/src/core/actions.js')
    const s = window.__APP_STATE__
    const demo = s.vehicleRepairs.filter(v => v.locomotiveNo.startsWith('HXD1C-DEMO'))
    for (const v of demo) { submitPlan(s, v.id); runAutoSchedule(s, v.id); s.selectedVehicleRepairId = v.id; publishSchedule(s) }
    window.__APP_DEBUG__.render()
  })
  await screenshot('monthly-desktop.png')
  await page.locator('[data-pc-tab="workshop"]').click()
  await page.locator('[data-pc-day="2026-10-29"]').first().click()
  assert.ok(await page.locator('.pc-task-table tbody tr').count() > 0)
  await page.locator('[data-pc-filter]').selectOption('2')
  assert.ok(!(await page.locator('.pc-calendar').innerText()).includes('HXD1C-DEMO02'))
  await page.locator('[data-pc-filter]').selectOption('')
  await screenshot('workshop-desktop.png')

  await page.locator('[data-pc-tab="monthly"]').click()
  await page.locator('[data-pc-vehicle="2"]').first().click()
  assert.equal(await page.locator('[data-pc-detail-vehicle]').inputValue(), '2')
  assert.equal(await page.locator('[data-pc-task]').count(), 20)
  await page.locator('[data-pc-task]').first().click()
  assert.ok((await page.locator('[data-pc-task-detail]').innerText()).includes('正式'))
  await page.locator('[data-gantt-range="start"]').fill('2026-10-28')
  await page.locator('[data-gantt-range="start"]').dispatchEvent('change')
  await page.locator('[data-gantt-range="end"]').fill('2026-10-28')
  await page.locator('[data-gantt-range="end"]').dispatchEvent('change')
  assert.ok(await page.locator('[data-pc-task]').count() < 20)
  await page.locator('[data-gantt-reset]').click()
  assert.equal(await page.locator('[data-pc-task]').count(), 20)
  await screenshot('vehicle-desktop.png')

  // The view contract reads preview edits and cancellation without mutating formal dates.
  const formalDates = await state(() => window.__APP_STATE__.schedules.filter(s => s.vehicleRepairId === 2).map(s => s.plannedEndAt))
  await page.evaluate(() => {
    const s = window.__APP_STATE__
    const row = s.schedules.find(s => s.vehicleRepairId === 2)
    s.pc1SchedulePreview = { vehicleRepairIds: [2], schedules: [{ ...row, plannedStartAt: '2026-10-29T08:00:00', plannedEndAt: '2026-10-29T10:00:00', isLocked: true }] }
    window.__APP_DEBUG__.render()
  })
  assert.equal(await page.locator('[data-pc-task]').count(), 1)
  assert.equal(await page.locator('.pc-event.pc-preview').count(), 1)
  await page.locator('[data-pc-tab="workshop"]').click()
  await page.locator('[data-pc-filter]').selectOption('2')
  assert.equal(await page.locator('.pc-event.pc-preview').count(), 1)
  await page.locator('[data-pc-day="2026-10-29"]').first().click()
  assert.ok((await page.locator('.pc-task-table').innerText()).includes('模拟 · 锁定'))
  assert.deepEqual(await state(() => window.__APP_STATE__.schedules.filter(s => s.vehicleRepairId === 2).map(s => s.plannedEndAt)), formalDates)
  await screenshot('simulation-sync.png')
  await page.reload()
  await page.locator('[data-test="pc1-planning"]').waitFor()
  assert.equal(await page.locator('.pc-event.pc-preview').count(), 1)
  assert.ok((await page.locator('.pc-task-table').innerText()).includes('模拟 · 锁定'))
  await page.evaluate(() => { delete window.__APP_STATE__.pc1SchedulePreview; window.__APP_DEBUG__.render() })
  assert.equal(await page.locator('.pc-event.pc-preview').count(), 0)

  // Reload keeps imports, schedules, the selected calendar and the draft contract.
  const savedSchedules = await state(() => window.__APP_STATE__.schedules)
  await page.reload()
  await page.locator('[data-test="pc1-planning"]').waitFor()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)
  assert.deepEqual(await state(() => window.__APP_STATE__.schedules), savedSchedules)
  assert.equal(await page.locator('[data-pc-tab="workshop"]').getAttribute('aria-pressed'), 'true')
  assert.ok((await page.locator('.pc-save-row').innerText()).includes('已恢复本机'))
  await page.locator('[data-pc-data-tools]').click()
  const backupDownload = page.waitForEvent('download')
  await page.locator('[data-pc-backup]').click()
  const backupPath = await (await backupDownload).path()
  const backupText = await fs.readFile(backupPath, 'utf8')
  assert.equal(JSON.parse(backupText).data.vehicleRepairs.length, 4)
  await page.locator('[data-pc-reset]').click()
  await page.locator('[data-pc-cancel-data]').click()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)
  await page.locator('[data-pc-reset]').click()
  const resetDownload = page.waitForEvent('download')
  await page.locator('[data-pc-confirm-data]').click()
  await resetDownload
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 1)
  await screenshot('data-reset-undo.png')
  await page.locator('[data-pc-undo-data]').click()
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)
  await page.locator('[data-pc-backup-file]').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(backupText) })
  assert.ok((await page.locator('.pc-data-confirm').innerText()).includes('4辆车'))
  const restoreDownload = page.waitForEvent('download')
  await page.locator('[data-pc-confirm-data]').click()
  await restoreDownload
  assert.equal(await state(() => window.__APP_STATE__.vehicleRepairs.length), 4)
  const beforeInvalidBackup = await state(() => window.__APP_STATE__.schedules)
  await page.locator('[data-pc-backup-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') })
  await page.getByText('备份无法恢复', { exact: true }).waitFor()
  assert.deepEqual(await state(() => window.__APP_STATE__.schedules), beforeInvalidBackup)
  assert.equal(await page.locator('.pc-data-confirm').count(), 0)
  await screenshot('data-tools-desktop.png')
  await page.locator('[data-pc-data-tools]').click()

  // Missing plans, empty month, narrow layouts, larger text, keyboard and dark mode.
  await page.locator('[data-pc-month]').fill('2030-01')
  await page.locator('[data-pc-month]').dispatchEvent('change')
  assert.equal(await page.locator('.pc-event').count(), 0)
  await page.locator('[data-pc-month]').fill('2026-10')
  await page.locator('[data-pc-month]').dispatchEvent('change')
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await screenshot(`workshop-${width}.png`)
    assert.ok(await state(() => document.documentElement.scrollWidth <= innerWidth + 1), `页面不得整体横向溢出：${width}`)
  }
  await page.locator('[data-pc-tab="monthly"]').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('[data-pc-tab="monthly"]').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.pcTab), 'monthly')
  await page.evaluate(() => document.documentElement.style.fontSize = '200%')
  assert.ok(await page.locator('[data-pc-import]').isVisible())
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.classList.add('dark') })
  await screenshot('monthly-dark-mobile.png')
  await page.evaluate(() => { const s = window.__APP_STATE__; s.vehicleRepairs = []; s.schedules = []; s.planningView.tab = 'vehicle'; window.__APP_DEBUG__.render() })
  assert.ok((await page.locator('.pc-planning').innerText()).includes('暂无车辆计划'))
  // A corrupt local record survives startup; the app opens with a recovery warning.
  await page.evaluate(async () => { const { DEMO_STORAGE_KEY } = await import('/src/core/demo-persistence.js'); localStorage.setItem(DEMO_STORAGE_KEY, '{corrupt original') })
  await page.reload()
  await page.locator('[data-test="pc1-planning"]').waitFor()
  assert.ok((await page.locator('.pc-save-row').innerText()).includes('原记录已保留'))
  assert.equal(await page.evaluate(async () => { const { DEMO_STORAGE_KEY } = await import('/src/core/demo-persistence.js'); return localStorage.getItem(DEMO_STORAGE_KEY) }), '{corrupt original')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['CSV-preview-invalid-dedup', 'XLSX-upload', 'corrupt-file', 'two-car-views', 'month-filter', 'vehicle-drilldown', 'preview-sync-cancel', 'reload-persistence', 'backup-download', 'restore-reset-cancel-undo', 'invalid-backup', 'corrupt-local-record', 'empty-states', 'keyboard-focus', 'responsive-390-768-1440', 'dark-mode'], screenshots: out }, null, 2))
} finally { await browser.close(); localServer?.kill() }
