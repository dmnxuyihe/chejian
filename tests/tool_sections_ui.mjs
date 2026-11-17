import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const schema=`tool_sections_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),errors=[],checks=[]
let browser,server,seq=0
try{
 await db.init();const snapshot=await db.read(),s=snapshot.snapshot.data
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'测试资料员',requestId:`sections-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const wh=s.toolManagement.warehouses[0]
 const tool=run('TOOL_SAVE',{code:'SECTIONS',name:'分项测试工具'})
 const asset=run('ASSET_CREATE',{toolId:tool.id,code:'SECTIONS-001',warehouseId:wh.id,mode:'NUMBERED',quantity:1,receivedAt:'2026-11-01'})
 const inspectionDate=new Date(Date.now()-20*86400000).toISOString().slice(0,10)
 const dueAssets=[1,2].map(i=>run('ASSET_CREATE',{toolId:tool.id,code:`SECTIONS-DUE-${i}`,warehouseId:wh.id,mode:'NUMBERED',quantity:1,receivedAt:inspectionDate,inspectionCycleMonths:1,lastInspectionAt:inspectionDate}))
 await db.save(snapshot.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message))
 const selectors={'tool-register':'[data-tool-workspace]','tool-inventory':'[data-tool-count-select], [data-tool-table-action="count-new"]','tool-records':'[data-tool-records-page] [data-record-kind]','tool-data':'[data-tool-data-page] [data-base-tab]'}
 const open=async id=>{await page.goto(`${base}/#/functions/assets/${id}`);await page.locator(selectors[id]).first().waitFor()}
 const action=key=>page.locator(`[data-tool-table-action="${key}"]`),modal=()=>page.locator('.modal')
 const field=(key,value)=>modal().locator(`[data-f="${key}"]`).fill(value)
 const confirm=async()=>{const box=modal();await box.locator('[data-modal-confirm]').click();await box.waitFor({state:'detached'})}
 const state=async()=>(await db.read()).snapshot.data
 await open('tool-register')
 assert.deepEqual(await page.locator('[data-nav-group="tools"] .function-item').allTextContents(),['工具看板','工具台账','工具盘点','业务记录','工具预警','工具资料'])
 assert.equal(await page.locator('main h1').innerText(),'工具台账')
 assert.equal(await page.locator('[data-tool-scan-mode]').count(),0);assert.equal(await page.locator('[name=borrowType],[name=serviceQuery]').count(),0);assert.equal(await page.locator('.tool-master-table th').count(),10)
 assert.deepEqual(await page.locator('[name=queryStatus] option').allTextContents(),['全部状态','在库','借出','送检','送修','送检 / 送修','调拨中','待审核','停用','已报废','已遗失','待完善登记'])
 for(const key of ['count-new','count-history','records','tool-data'])assert.equal(await action(key).count(),0)
 for(const key of ['borrow','return','transfer','inspection','repair'])assert.equal(await action(key).count(),0)
 await page.locator('[data-tool-ledger-scope=legacy]').click();await page.locator('[data-tool-check^="legacy:"]').first().check();assert.ok(await action('adopt').isEnabled());assert.equal(await action('borrow').count(),0);await page.locator('[data-tool-clear-selection]').click();await page.locator('[data-tool-ledger-scope=registered]').click()
 await page.locator(`[data-tool-check="asset:${asset.id}"]`).check();await action('borrow').click();await field('borrower','测试领用人');await field('dueAt','2099-01-01T17:00');await field('actor','测试发放员');await confirm()
 const loan=(await state()).toolManagement.loans.at(-1);assert.equal(loan.status,'OPEN')
 await page.setViewportSize({width:1366,height:768});await page.waitForTimeout(250);const layout=await page.locator('[data-tool-bottom]').boundingBox();assert.ok(layout.y+layout.height<=768,JSON.stringify(layout));await page.screenshot({path:'test-artifacts/tool-revision-ledger.png'});await page.setViewportSize({width:1440,height:1050})
 checks.push('台账独立展示增删改和业务操作；未选择与待登记时按钮可见；借出实际保存')
 await open('tool-records');assert.equal(await modal().count(),0);assert.equal(await page.locator('main h1').innerText(),'业务记录')
 assert.deepEqual(await page.locator('[data-record-kind] option').allTextContents(),['借还','调拨','送检','送修','遗失 / 报废']);assert.equal(await page.locator('[data-record-scope]').count(),0)
 await page.locator('.tool-record-advanced summary').click();await page.locator('[data-record-actor]').fill('无此经办人');await page.locator('[data-record-form] button[type=submit]').click();assert.equal(await page.locator('[data-record-id]').count(),0);await page.locator('[data-record-reset]').click()
 await page.locator('[data-record-since]').fill('2099-01-01T00:00');await page.locator('[data-record-form] button[type=submit]').click();assert.equal(await page.locator('[data-record-id]').count(),0);await page.locator('[data-record-reset]').click()
 await page.locator(`[data-record-id="${loan.id}"]`).check();assert.equal(await page.locator('[data-record-action="return"]').count(),0);await page.locator('[data-record-ledger]').click();await page.locator(`[data-tool-check="asset:${asset.id}"]`).check();await action('return').click();await field('returner','测试归还人');await field('actor','测试收回员');await confirm()
 assert.equal((await state()).toolManagement.loans.find(l=>l.id===loan.id).status,'CLOSED');await open('tool-records');assert.equal(await page.locator('[data-record-kind]').inputValue(),'loans')
 for(const kind of ['transfers','inspection','repair','disposals']){await page.locator('[data-record-kind]').selectOption(kind);assert.equal(await page.locator('[data-record-export]').count(),1)}
 checks.push('业务记录在页面内查询、切换五类业务记录、办理归还并刷新状态')
 await open('tool-data');assert.equal(await modal().count(),0);await page.locator('[data-base-tab="categories"]').click();assert.equal(await page.locator('[data-base-action="edit"]').isDisabled(),true);assert.equal(await page.locator('[data-base-action="delete"]').isDisabled(),true);await page.locator('[data-base-action="add"]').click();await field('code','SECTIONS-CAT');await field('name','页面分类');await field('actor','测试资料员');await confirm()
 let category=(await state()).toolManagement.categories.find(c=>c.code==='SECTIONS-CAT');assert.ok(category);assert.equal(await page.locator('[data-base-tab="categories"]').getAttribute('aria-pressed'),'true')
 await page.locator(`[name="base-record"][value="${category.id}"]`).check();assert.equal(await page.locator('[data-base-action="edit"]').isEnabled(),true,'edit enabled after selection');assert.equal(await page.locator('[data-base-action="delete"]').isEnabled(),true,'delete enabled after selection');await page.locator('[data-base-action="edit"]').click();await field('name','修改后分类');await field('actor','测试资料员');await confirm();assert.match(await page.locator('[data-base-table]').innerText(),/修改后分类/);assert.equal(await page.locator(`[name="base-record"][value="${category.id}"]`).isChecked(),true,'selection restored after edit');assert.equal(await page.locator('[data-base-action="edit"]').isEnabled(),true,'edit remains enabled after returning from edit')
 await page.locator(`[name="base-record"][value="${category.id}"]`).check();await page.locator('[data-base-action="delete"]').click();await field('actor','测试资料员');await confirm();assert.ok(!(await state()).toolManagement.categories.some(c=>c.id===category.id))
 for(const kind of ['tools','kits','devices']){await page.locator(`[data-base-tab="${kind}"]`).click();for(const op of ['add','edit','delete'])assert.ok(await page.locator(`[data-base-action="${op}"]`).isVisible())}
 checks.push('工具资料四类维护独立成页；分类增删改保存后保留当前页签')
 await page.goto(base+'/#/functions/assets/tool-dashboard');await page.locator('.tool-dashboard-stats').waitFor();assert.equal(await page.locator('.tool-dashboard-stats>div').count(),6);assert.match(await page.locator('main').innerText(),/最近操作记录/)
 await page.goto(base+'/#/functions/assets/tool-warnings');await page.locator('[data-warning-query]').waitFor();await page.locator('[data-warning-query] [name=query]').fill('SECTIONS-DUE');await page.locator('[data-warning-query] [type=submit]').click();assert.equal(await page.locator('[data-warning-ledger]').count(),2);assert.equal(await page.locator('[data-warning-send]').count(),0)
 await open('tool-register');await page.locator('[data-tool-reset-query]').click();if(await page.locator('[data-tool-clear-selection]').count())await page.locator('[data-tool-clear-selection]').click();for(const dueAsset of dueAssets)await page.locator(`[data-tool-check="asset:${dueAsset.id}"]`).check();await action('inspection').click();await field('provider','测试检定单位');await field('reason','到期前批量送检');await field('actor','测试送检员');await confirm();assert.equal((await state()).toolManagement.services.filter(r=>dueAssets.some(a=>a.id===r.assetId)&&r.status==='OPEN').length,2)
 await page.goto(base+'/#/functions/assets/tool-warnings');await page.locator('[data-warning-query]').waitFor();await page.locator('[data-warning-query] [name=kind]').selectOption('stock');assert.equal(await page.locator('[data-warning-send]').count(),0)
 await open('tool-register');await page.locator(`[data-tool-row="asset:${asset.id}"] [data-tool-detail]`).first().click();assert.equal(await modal().locator('[data-f]').count(),0);assert.match(await modal().locator('[data-tool-detail-content]').innerText(),/最近合格检定/);await modal().locator('[data-modal-cancel]').click()
 checks.push('六项导航、看板实际统计、精简台账、名称编辑、经办人与时间查询、多选预警送检通过；审核规则保持')
 await open('tool-inventory');await action('count-new').click();await modal().locator('[data-f="warehouseId"]').selectOption(String(wh.id));await field('actor','测试盘点员');await confirm();await page.locator('[data-count-present]').first().waitFor()
 const count=(await state()).toolManagement.counts.at(-1)
 for(const line of count.lines)await page.locator(`[data-count-present="${line.assetId}"]`).check()
 await action('count-confirm').click();await field('reason','全部找到，账实一致');await field('actor','测试盘点员');await confirm();assert.equal((await state()).toolManagement.counts.find(c=>c.id===count.id).status,'CLOSED')
 const downloadPromise=page.waitForEvent('download');await action('count-export').click();const download=await downloadPromise;assert.match(await fs.readFile(await download.path(),'utf8'),/清点完成/)
 await action('count-exit').click();await page.locator(`[data-tool-count-select][value="${count.id}"]`).check();await action('count-open-selected').click();assert.match(await page.locator('.tool-count-banner').innerText(),/已完成/)
 await page.reload();await page.locator(`[data-tool-count-select][value="${count.id}"]`).check();await action('count-open-selected').click();assert.match(await page.locator('.tool-count-banner').innerText(),/已完成/)
 checks.push('盘点独立开始、清点、确认、导出、返回列表和刷新后重开已完成记录')
 await open('tool-register');if(await page.locator('[data-tool-clear-selection]').count())await page.locator('[data-tool-clear-selection]').click();await page.setViewportSize({width:390,height:844});await page.locator(`[data-tool-check="asset:${asset.id}"]`).check()
 for(const key of ['borrow','transfer','inspection','repair'])assert.ok(await action(key).isVisible())
 const size=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));assert.ok(size.body<=size.viewport+2,JSON.stringify(size));assert.deepEqual(errors,[])
 await fs.mkdir('test-artifacts/tool-sections',{recursive:true});await page.screenshot({path:'test-artifacts/tool-sections/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:'test-artifacts/tool-sections/ledger.png',fullPage:true})
 await fs.writeFile('test-artifacts/tool-sections/report.json',JSON.stringify({passed:true,checks,productionWrites:false},null,2));console.log(JSON.stringify({passed:true,checks,productionWrites:false},null,2))
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(!/^tool_sections_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
