// Current UI: real import buttons, independent browsers and PostgreSQL writes.
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
const {chromium}=createRequire(import.meta.url)('playwright')
const schema=`pc1_test_browser_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
const {createHandler}=await import('../server/http.js')
const server=http.createServer(createHandler(db))
const out=process.env.PC1_QA_DIR||'test-artifacts/pc1-postgres'
const checks=[]
let browser
const check=name=>{checks.push(name);console.log('PASS: '+name)}
const save=page=>page.evaluate(()=>window.__APP_DEBUG__.getPersistence().save())
const csv=name=>Buffer.from('\uFEFF机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\r\n'+name+',HXD1C,HXD1C高级修,1,2026-10-31,演示局,演示段,1000,隔离测试\r\n')
try {
 await db.init();await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.mkdir(out,{recursive:true})
 const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:'msedge',headless:true})
 const ca=await browser.newContext(),cb=await browser.newContext()
 const a=await ca.newPage(),b=await cb.newPage(),errors=[]
 for(const page of[a,b])page.on('pageerror',e=>errors.push(e.message))
 await Promise.all([a.goto(base+'/#/planning/plans'),b.goto(base+'/#/planning/plans')])
 for(const page of[a,b]){await page.locator('[data-import-month]').fill('2026-10');await page.locator('[data-import-month]').dispatchEvent('change')}
 await a.locator('[data-open-manual]').click()
 await a.locator('[data-manual-loco]').fill('CROSS-BROWSER-01');await a.locator('[data-manual-model]').selectOption('HXD1C');await a.locator('[data-manual-program]').selectOption('HXD1C高级修');await a.locator('[data-manual-date]').fill('2026-10-31')
 await a.locator('[data-manual-preview]').click();await a.locator('[data-confirm-import]').waitFor()
 assert.equal((await db.read()).snapshot.data.vehicleRepairs.length,1)
 await a.locator('[data-confirm-import]').click();await a.locator('.pc-plan-result').waitFor()
 await b.locator('.plan-car-no').filter({hasText:'CROSS-BROWSER-01'}).waitFor({timeout:15000})
 assert.equal((await db.read()).snapshot.data.vehicleRepairs.length,2)
 check('manual create previews before write; confirmed row reaches a second independent browser')
 await a.locator('[data-plan-file]').setInputFiles({name:'cancel.csv',mimeType:'text/csv',buffer:csv('CANCEL-ONLY')});await a.locator('[data-cancel-preview]').click()
 assert.equal((await db.read()).snapshot.data.vehicleRepairs.length,2)
 await a.locator('[data-plan-file]').setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:csv('CROSS-BROWSER-01')});await a.locator('.pc-plan-preview').waitFor();assert.ok(await a.locator('[data-confirm-import]').isDisabled());await a.locator('[data-cancel-preview]').click()
 await a.locator('[data-plan-file]').setInputFiles({name:'broken.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});await a.locator('.pc-plan-message.is-error').waitFor();assert.equal(await a.locator('.pc-plan-preview').count(),0)
 check('cancel, duplicate guard and corrupted-file recovery do not create extra database rows')
 const annualResponse=a.waitForResponse(r=>r.url().includes('/api/planning/plans?')&&r.url().includes('planSource=ANNUAL'))
 await a.locator('[data-import-type]').selectOption('ANNUAL');await annualResponse
 await a.locator('[data-annual-year]').waitFor();await a.reload();await a.locator('[data-annual-year]').waitFor();assert.equal(await a.locator('[data-import-type]').inputValue(),'ANNUAL')
 const monthlyResponse=a.waitForResponse(r=>r.url().includes('/api/planning/plans?')&&r.url().includes('planSource=MONTHLY'))
 await a.locator('[data-import-type]').selectOption('MONTHLY');await monthlyResponse;await a.locator('[data-import-month]').waitFor()
 check('annual/monthly switch re-queries the selected source and keeps its selection on refresh')
 await b.locator('[data-import-month]').fill('2026-11');await b.locator('[data-import-month]').dispatchEvent('change')
 assert.equal(await a.locator('[data-import-month]').inputValue(),'2026-10')
 await b.reload();await b.locator('[data-import-month]').waitFor();assert.equal(await b.locator('[data-import-month]').inputValue(),'2026-11')
 check('month filters stay local to each browser and survive reload')
 await b.evaluate(()=>{window.__APP_STATE__.vehicleRepairs[0].remark='dirty-browser-B'})
 await a.evaluate(()=>{window.__APP_STATE__.vehicleRepairs[0].remark='saved-browser-A'})
 assert.ok((await save(a)).ok)
 const conflict=await save(b);assert.equal(conflict.ok,false)
 assert.equal((await db.read()).snapshot.data.vehicleRepairs[0].remark,'saved-browser-A')
 assert.equal(await b.evaluate(()=>window.__APP_STATE__.vehicleRepairs[0].remark),'dirty-browser-B')
 await b.evaluate(async()=>{const result=await window.__APP_DEBUG__.getPersistence().load();if(!result.ok)throw Error(result.message);window.__APP_DEBUG__.render(false)})
 assert.equal(await b.evaluate(()=>window.__APP_STATE__.vehicleRepairs[0].remark),'saved-browser-A')
 check('stale save is rejected, local edits are retained and explicit reload reads the saved version')
 await a.goto(base+'/#/scheduling/dashboard');await a.locator('.workspace-menu>summary').click();await a.locator('[data-pc1-demo-plans]').click();assert.ok((await save(a)).ok)
 await a.locator('[data-pc1-simulate]').click();await a.locator('[data-pc1-drag-task]').first().waitFor();assert.equal(await a.locator('[data-pc1-drag-task]').count(),40);assert.ok((await save(a)).ok)
 await b.waitForFunction(()=>window.__APP_STATE__.pc1SchedulePreview?.schedules.length===40,null,{timeout:15000})
 await a.locator('[data-pc1-cancel]').click();assert.ok((await save(a)).ok);await b.waitForFunction(()=>!window.__APP_STATE__.pc1SchedulePreview,null,{timeout:15000})
 await a.locator('[data-pc1-simulate]').click();await a.locator('[data-mobile-nav]').click();await a.getByRole('button',{name:'日计划发布与任务下发',exact:true}).click()
 await a.locator('[data-pc1-dispatch-confirm]').click();await a.locator('[data-modal-confirm]').click();await a.locator('.modal-backdrop').waitFor({state:'detached'})
 await b.waitForFunction(()=>window.__APP_STATE__.schedules.length===60,null,{timeout:15000})
 await b.goto(base+'/#/scheduling/gantt');await b.locator('[data-pc1-dispatch]').waitFor();assert.equal(await b.locator('.pc1-dispatch-item').count(),4)
 check('simulation, cancellation and formal dispatch buttons synchronize forty tasks and four team lists across browsers')
 await a.route('**/api/state',route=>route.abort('failed'))
 await a.evaluate(()=>{window.__APP_STATE__.vehicleRepairs[0].remark='retry-after-network-failure'})
 assert.equal((await save(a)).ok,false)
 assert.notEqual((await db.read()).snapshot.data.vehicleRepairs[0].remark,'retry-after-network-failure')
 await a.unroute('**/api/state');assert.ok((await save(a)).ok)
 assert.equal((await db.read()).snapshot.data.vehicleRepairs[0].remark,'retry-after-network-failure')
 check('failed save retains pending edits and retries successfully after connectivity returns')
 assert.deepEqual(errors,[])
 await a.screenshot({path:out+'/current-ui-database.png',fullPage:true})
 await fs.writeFile(out+'/report.json',JSON.stringify({passed:true,checks,pageErrors:errors},null,2))
 console.log(JSON.stringify({passed:true,checks,pageErrors:errors},null,2))
} finally {
 await browser?.close();if(server.listening)await new Promise(r=>server.close(r))
 if(!/^pc1_test_browser_\d+_\d+$/.test(schema))throw Error('Invalid test schema')
 await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
