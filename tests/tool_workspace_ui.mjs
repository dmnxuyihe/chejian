import assert from 'node:assert/strict'
import http from 'node:http'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
import {createState} from '../src/core/state.js'
import {toolsPage} from '../src/roles/system-admin/pages/tools.js'

const schema=`tool_ui_${Date.now()}_${process.pid}`
let db=createDatabase({...loadConfig(),schema}),server,browser
const checks=[];const errors=[];let seq=0
const emptyState=createState();const emptyHtml=toolsPage.render({state:emptyState,role:{id:'tool-management'},page:'resources'});assert.match(emptyHtml,/data-tool-action="warehouse"/);assert.match(emptyHtml,/首次使用引导/);checks.push('空库时主操作先引导建立工具库')
try{
 await db.init();let snap=await db.read();const data=snap.snapshot.data
 const run=(type,payload={},actor='UI测试')=>applyToolCommand(data,{type,payload,actor,requestId:`ui-${++seq}`})
 const wh=run('WAREHOUSE_SAVE',{code:'UI-W',name:'UI工具库'})
 const legacy=data.tools.find(t=>Number(t.quantity)>0)
 assert.ok(legacy,'fixture must include legacy tool')
 run('ADOPT_LEGACY',{toolId:legacy.id,warehouseId:wh.id,code:'UI-LEGACY-001',tag:'UI-TAG-001'})
 const tool=run('TOOL_SAVE',{code:'UI-BULK',name:'UI批量工具',specification:'UI',lowStock:1})
 const asset=run('ASSET_CREATE',{toolId:tool.id,warehouseId:wh.id,code:'UI-BULK-001',mode:'BULK',quantity:4,tag:'UI-BULK-TAG'})
 const task=data.schedules[0]
 snap.snapshot=exportDemoSnapshot(data);await db.save(snap.revision,snap.snapshot)
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/#/functions/assets/tool-register');await page.locator('[data-tool-workspace]').waitFor()
 await page.screenshot({path:'test-artifacts/tool-workspace-desktop.png',fullPage:true})
 assert.equal(await page.locator('[data-tool-tab]').count(),5);assert.equal(await page.locator('.tool-stock-summary').count(),1);assert.ok((await page.locator('.tool-stock-summary').innerText()).includes('实物可领用量'));checks.push('首次页面结构、库存三口径与五功能页签')
 for(const tab of ['circulation','service','alerts','devices','ledger']){await page.locator(`[data-tool-tab="${tab}"]`).click();await page.locator(`[data-tool-tab="${tab}"]`).waitFor({state:'visible'})}
 checks.push('五功能页签可切换并保留筛选工具栏')
 await page.locator('[data-tool-action="detail"]').first().click();await page.locator('.modal').waitFor();assert.equal(await page.locator('[data-tool-detail-tab]').count(),4);await page.locator('[data-tool-detail-tab="circulation"]').click();assert.ok((await page.locator('[data-tool-detail-content]').innerText()).includes('暂无记录'));await page.locator('.modal [data-modal-close]').first().click();checks.push('单件详情分栏可查看流转、检定和审核上下文')
 await page.locator('[data-tool-tab="alerts"]').click();await page.locator('[data-tool-section="counts"]').click();await page.locator('[data-tool-action="count-new"]').click();await page.locator('[data-f="warehouseId"]').selectOption(String(wh.id));await page.locator('[data-f="actor"]').fill('盘点员');await page.locator('.modal [data-modal-confirm]').click();try{await page.locator('.modal').waitFor({state:'detached',timeout:5000})}catch{console.error('COUNT_CREATE_MODAL',await page.locator('.modal').innerText());throw Error('count create did not close')}assert.ok((await db.read()).snapshot.data.toolManagement.counts.length)
 await page.locator('[data-tool-action="count-finish"]').first().click();for(const field of await page.locator('[data-counted]').all())await field.fill('4');await page.locator('[data-f="reason"]').fill('实盘确认');await page.locator('[data-f="actor"]').fill('盘点员');await page.locator('.modal [data-modal-confirm]').click();try{await page.locator('.modal').waitFor({state:'detached',timeout:5000})}catch{console.error('COUNT_FINISH_MODAL',await page.locator('.modal').innerText());throw Error('count finish did not close')}checks.push('盘点任务创建、实盘填写与确认完整可用')
 await page.locator('[data-tool-tab="devices"]').click();await page.locator('[data-tool-action="device-new"]').click();await page.locator('[data-f="code"]').fill('UI-CAB');await page.locator('[data-f="name"]').fill('UI工具柜');await page.locator('[data-f="warehouseId"]').selectOption(String(wh.id));await page.locator('[data-f="actor"]').fill('设备管理员');await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'});assert.ok((await db.read()).snapshot.data.toolManagement.devices.some(d=>d.code==='UI-CAB'));checks.push('智能设施建档可保存')
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#/functions/assets/tool-register');await page.locator('[data-tool-workspace]').waitFor();await page.screenshot({path:'test-artifacts/tool-workspace-mobile.png',fullPage:true});const overflow=await page.evaluate(()=>({body:document.body.scrollWidth,view:window.innerWidth,cards:document.querySelectorAll('.tool-data-table tbody tr').length}));assert.ok(overflow.body<=overflow.view+2,`mobile overflow ${JSON.stringify(overflow)}`);assert.ok(overflow.cards>0);checks.push('移动端表格转卡片，无横向溢出')
 assert.equal(errors.length,0,errors.join('; '));console.log(JSON.stringify({passed:true,checks},null,2))
}finally{
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(!/^tool_ui_\d+_\d+$/.test(schema))throw Error('Unexpected test schema');await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}



