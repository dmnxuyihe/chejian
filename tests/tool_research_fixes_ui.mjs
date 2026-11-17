import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {toolAlerts} from '../src/core/tool-management.js'
import http from 'node:http'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const out=new URL('../test-artifacts/tool-research-fixes/',import.meta.url),schema=`tool_research_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),observations=[],errors=[]
let server,browser,seq=0
try{
 await fs.mkdir(out,{recursive:true});await db.init();const snap=await db.read(),s=snap.snapshot.data
 const now=new Date(),ago=n=>new Date(now.getTime()-n*86400000).toISOString()
 const run=(type,payload,at=ago(40),actor='研究发放员')=>applyToolCommand(s,{type,payload,actor,requestId:`research-${++seq}`},{now:at})
 run('WAREHOUSE_STANDARDIZE',{});const wh=s.toolManagement.warehouses[0]
 const tool=run('TOOL_SAVE',{code:'UX-RESEARCH',name:'研究扭矩扳手',lowStock:100})
 const add=(code,quantity=1,extra={})=>run('ASSET_CREATE',{toolId:tool.id,code,mode:quantity===1?'NUMBERED':'BULK',warehouseId:wh.id,quantity,receivedAt:ago(40),...extra},ago(15))
 const a=add('UX-A'),b=add('UX-B'),bulk=add('UX-BULK',10),due=add('UX-DUE',1,{inspectionCycleMonths:1,lastInspectionAt:ago(20).slice(0,10)}),sent=add('UX-SENT',1,{inspectionCycleMonths:1,lastInspectionAt:ago(20).slice(0,10)}),missing=add('UX-NODATE',1,{inspectionCycleMonths:1}),returned=add('UX-RETURN'),late=add('UX-LATE')
 run('BORROW',{assetId:b.id,quantity:1,borrower:'张三',dueAt:'2099-01-01'},ago(5))
 run('BORROW',{assetId:bulk.id,quantity:2,borrower:'李四',dueAt:'2099-01-01'},ago(5))
 run('BORROW',{assetId:bulk.id,quantity:3,borrower:'赵六',dueAt:'2099-01-01'},ago(4))
 const oldLoan=run('BORROW',{assetId:returned.id,quantity:1,borrower:'王五',dueAt:'2099-01-01'},ago(10))
 run('RETURN',{loanId:oldLoan.id,assetId:returned.id,quantity:1,returner:'王五'},now.toISOString(),'研究收回员')
 run('BORROW',{assetId:late.id,quantity:1,borrower:'逾期领用人',dueAt:ago(1)},ago(5))
 run('SERVICE_SEND',{assetId:sent.id,quantity:1,kind:'INSPECTION',provider:'研究计量中心',reason:'周期检定'},ago(1))
 for(let i=0;i<25;i++)add(`UX-FILL-${i}`)
 run('TOOL_SAVE',{id:tool.id,code:'UX-RESEARCH',name:'研究扭矩扳手',lowStock:100,lowStockWarehouseId:wh.id})
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>errors.push(e.message))
 const base=`http://127.0.0.1:${server.address().port}`
 const open=async id=>{await page.goto(`${base}/#/functions/assets/${id}`,{waitUntil:'networkidle'});await page.locator('main h1').waitFor()}
 const query=async text=>{await page.locator('[name=query]').fill(text);await page.locator('[data-tool-query] button[type=submit]').click()}
 const close=async()=>{if(await page.locator('.modal').count())await page.locator('.modal [data-modal-cancel]').click()}
 const note=(id,title,data)=>observations.push({id,title,data})
 const shot=async name=>page.screenshot({path:new URL(name,out).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true})
 await open('tool-dashboard');assert.equal(await page.locator('.tool-dashboard-stats a').count(),6);assert.match(await page.locator('.tool-dashboard-stats').innerText(),/件/)
 await page.locator('.tool-dashboard-section').nth(1).locator('header a').click();await page.locator('[data-warning-query]').waitFor();assert.equal(await page.locator('[name=kind]').inputValue(),'stock')
 await open('tool-dashboard');await page.locator('.tool-dashboard-section').first().locator('header a').click();await page.locator('[data-warning-query]').waitFor();assert.equal(await page.locator('[name=kind]').inputValue(),'inspection');note('R01/R16','预警上下文、统计单位及下钻',{passed:true})
 await open('tool-register');await query('UX-A');await page.locator(`[data-tool-check="asset:${a.id}"]`).check();await query('UX-BULK');await page.locator(`[data-tool-check="asset:${bulk.id}"]`).check();assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/已选 2 项[\s\S]*其中 1 项不在当前筛选/)
 const scope=await page.locator('[data-tool-selection-summary]').boundingBox(),action=await page.locator('[data-tool-table-action=borrow]').boundingBox();assert.ok(scope.y<=action.y);note('R02','按钮旁明确隐藏选择范围',{passed:true})
 let downloads=0;page.on('download',()=>downloads++);await page.locator('[name=query]').fill('没有此工具');await page.locator('[data-tool-table-action=export]').click();await page.locator('.toast.warning').last().waitFor();assert.equal(downloads,0);assert.equal(await page.locator('[data-query-pending]').isVisible(),true);await query('UX-BULK');note('R03','未应用条件不按旧范围导出',{passed:true})
 await page.locator('[data-tool-clear-selection]').click();await page.locator(`[data-tool-check="asset:${bulk.id}"]`).check();await page.locator('[data-tool-table-action=return]').click();assert.equal(await page.locator('[data-return-pick]:checked').count(),0);assert.equal(await page.locator('[data-modal-confirm]').isDisabled(),true);await page.locator('[data-return-pick="0"]').check();assert.match(await page.locator('[data-return-summary]').innerText(),/合计 2 件/);assert.match(await page.locator('[data-modal-confirm]').innerText(),/2件/)
 await page.locator('[data-f=returner]').fill('李四');await page.locator('[data-f=actor]').fill('研究收回员');await page.locator('[data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'});const saved=(await db.read()).snapshot.data;assert.equal(saved.toolManagement.loans.find(l=>l.borrower==='李四').status,'CLOSED');assert.equal(saved.toolManagement.loans.find(l=>l.borrower==='赵六').lines[0].returned,0);note('R05','部分归还只处理明确勾选的借用单',{passed:true})
 await page.locator('[data-tool-clear-selection]').click();await page.locator('[data-tool-reset-query]').click();await page.locator(`[data-tool-check="asset:${a.id}"]`).check();await page.locator(`[data-tool-check="asset:${b.id}"]`).check();await page.locator('.tool-unavailable summary').click();assert.match(await page.locator('.tool-unavailable').innerText(),/UX-B/);await page.locator('[data-tool-clear-selection]').click();await query('UX-B');await page.locator(`[data-tool-row="asset:${b.id}"] [data-tool-detail]`).first().click();assert.match(await page.locator('[data-tool-detail-content]').innerText(),/张三/);await close();note('R07','编辑入口先显示当前领用摘要',{passed:true})
 await open('tool-records');await page.locator('.tool-record-advanced summary').click();await page.locator('[data-record-actor]').fill('不存在的经办人');await page.locator('[data-record-kind]').selectOption('inspection');assert.equal(await page.locator('[data-record-id]').count(),0);assert.equal(await page.locator('[data-record-pending]').isVisible(),false);await page.locator('[data-record-reset]').click();await page.locator('[data-record-kind]').selectOption('loans')
 await page.locator('[data-record-actor]').fill('研究收回员');await page.locator('[data-record-since]').fill(now.toISOString().slice(0,10)+'T00:00');await page.locator('[data-record-form] button[type=submit]').click();assert.equal(await page.locator(`[data-record-id="${oldLoan.id}"]`).count(),1)
 await page.locator('[data-record-actor]').fill('研究发放员');await page.locator('[data-record-form] button[type=submit]').click();assert.equal(await page.locator('[data-record-id]').count(),0);await page.locator('[data-record-reset]').click();note('R03/R04','统一应用条件，人员与办理事件时间关联',{passed:true})
 const headers=(await page.locator('[data-record-table] th').allTextContents()).slice(1);assert.equal(headers.filter(h=>h==='状态').length,0);assert.equal(headers.filter(h=>h==='办理状态').length,1);const downloadPromise=page.waitForEvent('download');await page.locator('[data-record-export]').click();const download=await downloadPromise;const csv=await fs.readFile(await download.path(),'utf8'),exported=JSON.parse('['+csv.replace(/^\uFEFF/,'').split(/\r?\n/)[0]+']');assert.deepEqual(exported,headers);note('R11/R12','屏幕只保留一列办理状态，导出字段相同',{passed:true})
 await open('tool-warnings');await page.locator('[name=stage]').selectOption('processing');assert.equal(await page.locator(`a[href*="asset=${sent.id}"]`).count(),2);assert.equal(await page.locator(`a[href*="asset=${due.id}"]`).count(),0);await page.locator('[name=stage]').selectOption('');assert.ok(toolAlerts(saved).some(r=>r.assetId===due.id&&r.type==='INSPECTION_DUE'));note('R08/R15','预警办理范围与30天口径一致',{passed:true})
 await page.locator('[name=kind]').selectOption('stock');await page.locator('[data-warning-query] [name=query]').fill('UX-RESEARCH');await page.locator('[data-warning-query] button[type=submit]').click();assert.equal(await page.locator('.tool-overview-table tbody a[data-warning-ledger]').count(),2);await page.locator('.tool-overview-table tbody a[data-warning-ledger]').first().click();await page.locator('.tool-compact-ledger').waitFor();assert.equal(await page.locator('[name=query]').inputValue(),'');assert.equal(await page.locator('[data-tool-row]').count(),saved.toolManagement.assets.filter(a=>a.toolId===tool.id).length);note('R09/R10','编号查询库存预警并定位正确工具台账',{passed:true})
 await page.locator('[data-tool-reset-query]').click();assert.ok(!page.url().includes('?'));await page.reload();await page.locator('[data-tool-workspace]').waitFor();assert.equal(await page.locator('[data-tool-row]').count(),saved.toolManagement.assets.length+saved.toolManagement.kits.length);await page.locator('[data-tool-filter-open=type]').click();await page.locator('[data-filter-all]').uncheck();await page.locator('[data-filter-label]').filter({hasText:'有编号工具'}).locator('input').check();await page.locator('[data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'});assert.match(await page.locator('[data-tool-filter-remove=type]').innerText(),/有编号工具/);await page.locator('[data-tool-filter-remove=type]').click();assert.equal(await page.locator('[data-tool-filter-remove=type]').count(),0);note('R13','表头已用条件可见且可逐项删除',{passed:true})
 await open('tool-dashboard');await page.locator('.tool-dashboard-section').nth(2).locator('header a').click();await page.locator('.modal [data-record-kind]').waitFor();assert.equal(await page.locator('.modal [data-record-kind]').inputValue(),'audit');await close();note('R14','最近操作直接进入日志',{passed:true})
 assert.deepEqual(errors,[]);await fs.writeFile(new URL('report.json',out),JSON.stringify({passed:true,observations,productionWrites:false,errors},null,2));console.log(JSON.stringify({passed:true,checks:observations,productionWrites:false},null,2))
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(!/^tool_research_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
