import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'

const { chromium } = createRequire(import.meta.url)('playwright')
const schema = `pc1_test_phase_three_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
let server, browser
try {
  await db.init()
  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  const headerStyle = () => page.evaluate(() => { const header=document.querySelector('.page-header'),title=header?.querySelector('h1'),hs=getComputedStyle(header),ts=getComputedStyle(title);return {fontSize:ts.fontSize,fontWeight:ts.fontWeight,lineHeight:ts.lineHeight,paddingBottom:hs.paddingBottom,marginBottom:hs.marginBottom,borderBottom:hs.borderBottomStyle,alignItems:hs.alignItems,minHeight:hs.minHeight} })
  await page.goto(`${base}/#/functions/plans/monthly-calendar`)
  await page.locator('.pc-plan-page .page-header').waitFor()
  const monthlyHeader = await headerStyle()

  await page.goto(`${base}/#/functions/plans/annual-stats`)
  await page.locator('[data-annual-delivery-card]').waitFor()
  assert.equal(await page.locator('.pc-annual-demo').count(),0,'annual page must not show an implementation/demo-data notice')
  assert.deepEqual(await headerStyle(), monthlyHeader, 'annual header must match monthly-calendar')
  assert.equal(await page.locator('[data-chip-menu="annual-depot"] input').count(), 3)
  await page.locator('[data-chart-month-index="1"]').hover()
  const tooltip = page.locator('.pc-annual-chart-tooltip')
  await tooltip.waitFor({ state: 'visible' })
  const tooltipText = await tooltip.innerText()
  await page.locator('[data-annual-year]').fill('2025')
  await page.locator('[data-annual-refresh]').click()
  await page.locator('.pc-annual-empty').waitFor()
  assert.match(await page.locator('.pc-annual-empty').innerText(), /当前年度暂无/)
  assert.equal(await page.locator('[data-annual-toggle-depot]').count(), 0, 'a year without records must not reuse demo data from another year')
  await page.locator('[data-annual-year]').fill('2026')
  await page.locator('[data-annual-refresh]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-annual-toggle-depot]').length === 3)
  for (const depot of ['模拟一段', '模拟二段', '模拟三段']) assert.match(tooltipText, new RegExp(depot))

  await page.locator('[data-chip-menu="annual-depot"] input[value="模拟一段"]').check()
  await page.locator('[data-annual-refresh]').click()
  await page.waitForFunction(() => document.querySelectorAll('.pc-annual-detail-table tbody tr').length === 3)
  assert.equal(await page.locator('[data-chip-menu="annual-depot"] input').count(), 3, 'depot filtering must retain every depot option')
  assert.equal(await page.locator('[data-annual-toggle-depot]').count(), 1)

  await page.goto(`${base}/#/functions/plans/annual-plan`)
  await page.locator('[data-annual-import]').click()
  await page.locator('[data-open-import-dialog]').waitFor()
  assert.equal(await page.locator('.page-header h1').innerText(),'年度计划导入')
  assert.equal(await page.locator('[data-import-type]').count(),0)
  await page.goto(`${base}/#/functions/plans/monthly-calendar`)
  await page.locator('.plan-view-tabs').waitFor()
  assert.match(await page.locator('.plan-view-tabs').innerText(),/计划日历/)

  await page.goto(`${base}/#/functions/plans/component-down-plan`)
  await page.locator('[data-component-down-page]').waitFor()
  assert.deepEqual(await headerStyle(), monthlyHeader, 'component header must match monthly-calendar')
  const downRows = await page.locator('tbody tr').count()
  if (downRows !== 4) console.log(await page.locator('[data-component-down-page]').innerText())
  assert.equal(downRows, 4)
  assert.match(await page.locator('[data-component-down-page]').innerText(), /测算检修数量/)

  await page.goto(`${base}/#/functions/plans/component-up-plan`)
  await page.locator('[data-component-up-page]').waitFor()
  assert.equal(await page.locator('[data-component-up-row]').count(), 7)
  assert.match(await page.locator('[data-component-up-page]').innerText(), /公里匹配：现库无里程字段/)
  await page.goto(`${base}/#/functions/plans/temporary-repair`)
  await page.locator('[data-temporary-repair-page]').waitFor()
  assert.deepEqual(await headerStyle(), monthlyHeader, 'temporary repair header must match monthly-calendar')
  const readyRow=page.locator('tr',{hasText:'HXD1C6208'})
  await readyRow.waitFor()
  assert.equal(await readyRow.locator('[data-temp-submit]').isEnabled(),true,'submit-ready temporary repair sample must have an attachment')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('PASS: annual depot filter, all-depot month tooltip, component down/up plan pages')
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  assert.ok(/^pc1_test_phase_three_\d+_\d+$/.test(schema))
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
