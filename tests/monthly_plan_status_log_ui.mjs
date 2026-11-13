import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import http from 'node:http'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const schema = `pc1_test_status_log_ui_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
let server
let browser

try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const dictionary = (await db.pool.query(`
    SELECT lm.model_name, rp.repair_program_name
    FROM "${schema}".repair_program rp
    JOIN "${schema}".locomotive_model lm ON lm.model_id = rp.model_id
    WHERE rp.repair_program_name = 'C1'
    ORDER BY rp.repair_program_id
    LIMIT 1
  `)).rows[0]
  const period = { year: 2197, month: 9 }
  await service.createDraftItem({
    ...period,
    role: 'PLANNER',
    values: {
      modelName: dictionary.model_name,
      repairProgramName: dictionary.repair_program_name,
      locomotiveNo: 'LOG-UI-01',
      repairSequence: 1,
      plannedEntryAt: '2197-09-08',
      ownerBureau: '哈尔滨局',
      ownerDepot: '哈尔滨机务段',
      mileageKm: 100,
      remark: '日志界面测试'
    }
  })
  await service.submit({ ...period, role: 'PLANNER', note: '日志界面测试申请', adjustReason: '新增车辆' })

  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}/#/functions/plans/monthly-calendar`)
  await page.locator('[data-calendar-month]').fill('2197-09')
  await page.locator('[data-calendar-month]').dispatchEvent('change')
  await page.waitForFunction(() => document.querySelector('[data-calendar-month]')?.value === '2197-09' && !document.querySelector('.pc-plan-loading'))

  const toolbar = page.locator('.pc-plan-month-nav')
  const todoIndex = await toolbar.locator('button').evaluateAll(nodes => nodes.findIndex(node => node.hasAttribute('data-open-monthly-todos')))
  const logIndex = await toolbar.locator('button').evaluateAll(nodes => nodes.findIndex(node => node.hasAttribute('data-open-monthly-logs')))
  assert.equal(logIndex, todoIndex + 1, '日志按钮应紧跟在待办按钮右侧')

  await page.locator('[data-open-monthly-logs]').click()
  const modal = page.locator('.modal')
  await modal.waitFor()
  assert.match(await modal.innerText(), /2197年9月月度计划状态变更日志/)
  await modal.locator('.pc-monthly-log-table').waitFor()
  const headers = await modal.locator('.pc-monthly-log-table th').allTextContents()
  assert.deepEqual(headers, ['时间', '操作人', '操作事项', '状态变化', '查看详情'])
  assert.match(await modal.innerText(), /第1轮 · 申请审核/)
  assert.match(await modal.innerText(), /未提交 → 待科长审核/)

  await modal.locator('[data-log-detail]').click()
  await modal.locator('.pc-monthly-log-detail').waitFor()
  const detailText = await modal.innerText()
  assert.match(detailText, /原状态\s*未提交/)
  assert.match(detailText, /新状态\s*待科长审核/)
  assert.match(detailText, /新增\s*1 辆/)
  assert.match(detailText, /LOG-UI-01/)
  const layout = await modal.evaluate(element => {
    const body = element.querySelector('.modal-body').getBoundingClientRect()
    const table = element.querySelector('.pc-monthly-status-change-table').getBoundingClientRect()
    return { width: element.getBoundingClientRect().width, inside: table.left >= body.left - 1 && table.right <= body.right + 1 }
  })
  assert.ok(layout.width >= 1000, '日志详情应使用加宽弹窗')
  assert.equal(layout.inside, true, '车辆变更表格不得撑出弹窗正文')

  console.log('PASS: 月度状态日志按钮、五列表格、状态详情、历史车辆明细和弹窗布局正确')
} finally {
  await browser?.close().catch(() => {})
  if (server) await new Promise(resolve => server.close(resolve))
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
  await db.close()
}
