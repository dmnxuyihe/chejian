import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'

const { chromium }=createRequire(import.meta.url)('playwright')
const schema=`pc1_test_temp_repair_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema});let server,browser
try{
 await db.init();server=http.createServer(createHandler(db));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(base+'/#/functions/plans/temporary-repair');await page.locator('[data-temporary-repair-page]').waitFor()
 const initialCount=(await db.read()).snapshot.data.temporaryRepairPlans.length
 await page.locator('[data-temp-add]').click();const modal=page.locator('.modal')
 await modal.locator('[data-temp-field="ownerDepot"]').fill('测试委修段');await modal.locator('[data-temp-field="modelId"]').selectOption('1');await modal.locator('[data-temp-field="locomotiveNo"]').fill('HXD1C-LX-UI01')
 await modal.locator('[data-temp-field="plannedEntryAt"]').fill('2026-11-08T08:00');await modal.locator('[data-temp-field="plannedPlatformAt"]').fill('2026-11-08T10:00');await modal.locator('[data-temp-field="content"]').fill('走行部异响临修检查')
 await modal.locator('[data-temp-attachment]').setInputFiles({name:'临修方案.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')});await modal.locator('[data-modal-confirm]').click()
 await page.getByText('HXD1C-LX-UI01').waitFor();assert.match(await page.locator('tbody').innerText(),/临修方案.pdf/)
 await page.reload();await page.getByText('HXD1C-LX-UI01').waitFor();assert.equal((await db.read()).snapshot.data.temporaryRepairPlans.length,initialCount+1,'temporary plan and attachment metadata persist')
 await page.locator('tr', { hasText:'HXD1C-LX-UI01' }).locator('[data-temp-delete]').click();assert.match(await page.locator('.modal').innerText(),/删除后无法恢复/);await page.locator('.modal [data-modal-close]').first().click()

 const csv='\uFEFF委修段,机型,机车号,计划入段时间,计划上台时间,临修内容\r\n导入段,HXD1C,HXD1C-LX-CSV01,2026-11-09 08:00,2026-11-09 09:00,CSV临修内容\r\n导入段,HXD1C,,2026-11-09 08:00,2026-11-09 09:00,错误行\r\n'
 const chooser=page.locator('[data-temp-import-file]');await chooser.setInputFiles({name:'临修计划.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
 await page.getByText('临修计划导入预览与纠错').waitFor();assert.match(await page.locator('.modal').innerText(),/可导入 1 行，错误 1 行/);await page.locator('.modal [data-modal-confirm]').click();await page.getByText('HXD1C-LX-CSV01').waitFor()
 assert.equal((await db.read()).snapshot.data.temporaryRepairPlans.length,initialCount+2);assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS: temporary repair create, attachment persistence, delete warning, CSV preview/correction and import')
}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));assert.ok(/^pc1_test_temp_repair_\d+_\d+$/.test(schema));await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()}
