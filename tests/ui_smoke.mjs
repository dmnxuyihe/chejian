import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { functionEntries, functionPath } from '../src/functions/catalog.js'
import { navigationGroups } from '../src/functions/navigation.js'

const port=Number(process.env.UI_SMOKE_PORT||5187)
const base=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,['start.js',`--port=${port}`,'--no-open','--local-demo'],{cwd:process.cwd(),stdio:'ignore',windowsHide:true})
let browser
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try {
  for(let attempt=0;attempt<100;attempt++) {
    try { if((await fetch(base)).ok)break } catch {}
    if(attempt===99)throw new Error('测试服务启动超时')
    await delay(100)
  }
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/#/functions')
  await page.locator('[data-function-entry="monthly-calendar"]').waitFor()
  assert.equal(await page.locator('[data-role-card],[data-switch-role]').count(),0)
  assert.equal(await page.locator('[data-nav-group]').count(),navigationGroups.length)
  assert.equal(await page.locator('.function-primary-card,.workspace-nav').count(),0)
  let pageChecks=0
  for(const entry of functionEntries) {
    await page.evaluate(path=>location.hash='#/'+path,functionPath(entry))
    await page.waitForFunction(id=>document.querySelector('[data-function-shell]')?.dataset.functionEntry===id,entry.id)
    assert.equal(await page.locator('main h1').count(),1,entry.id)
    assert.equal(await page.locator('[data-role-card],[data-switch-role]').count(),0,entry.id)
    assert.ok((await page.locator('main').innerText()).length>10,entry.id)
    pageChecks++
  }
  await page.goto(base+'/#/functions/settings/resources')
  await page.locator('[data-resource-tab="materials"]').click()
  await page.locator('[data-add-resource]').click()
  await page.locator('[role="dialog"]').waitFor()
  await page.locator('.modal-head [data-modal-close]').click()
  assert.equal(await page.locator('[data-resource-tab="tools"]').count(),0)
  await page.locator('[data-resource-tools]').click()
  await page.locator('[data-tool-workspace]').waitFor()
  assert.equal(await page.locator('[data-tool-operation-group]').count(),2)
  await page.locator('.sidebar a[href="#/functions/assets/tool-data"]').click()
  assert.equal(await page.locator('[data-base-kind]').count(),0)
  await page.locator('[data-tool-data-page]').waitFor();assert.equal(await page.locator('[data-tool-data-page]').count(),1)

  // A disposable local fixture exercises the existing execution controls.
  await page.evaluate(async()=>{
    const actions=await import('/src/core/actions.js')
    actions.runAutoSchedule(window.__APP_STATE__,1)
    actions.publishSchedule(window.__APP_STATE__,1)
    window.__APP_STATE__.selectedVehicleRepairId=1
    window.__APP_STATE__.selectedWorkerId=1
    window.__APP_DEBUG__.render()
  })
  await page.goto(base+'/#/functions/execution/assignment')
  await page.locator('[data-fine-tune]').first().click()
  await page.locator('[role="dialog"]').waitFor()
  await page.locator('.modal-head [data-modal-close]').click()
  await page.goto(base+'/#/functions/execution/execution')
  await page.locator('[data-start-task]').first().click()
  await page.locator('.gantt-bar.status-in-progress').first().waitFor()
  await page.locator('[data-complete-task]').first().click()
  await page.locator('.gantt-bar.status-completed').first().waitFor()
  assert.equal(await page.locator('[data-worker-select]').count(),1)
  await page.goto(base+'/#/select')
  await page.locator('[data-function-entry="monthly-calendar"]').waitFor()
  assert.ok(page.url().endsWith('#/functions/plans/monthly-calendar'))
  await page.goto(base+'/#/functions/catalog')
  await page.locator('[data-function-directory]').waitFor()
  await page.locator('[data-function-search]').fill('工具')
  assert.equal(await page.locator('.function-group:not([hidden])').count(),1)
  assert.equal(await page.locator('[data-function-label]:visible').count(),4)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,functionEntries:functionEntries.length,pageChecks,actions:['monthly-default','all-function-routes','resource-tabs-and-form','assignment-detail','execution-start-and-complete','employee-data-filter','legacy-home-redirect','explicit-catalog-alias-search'],browser:'msedge'},null,2))
} finally {
  await browser?.close()
  server.kill()
}
