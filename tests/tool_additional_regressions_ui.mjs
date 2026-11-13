// Acceptance: repeat the original browser/PostgreSQL reproductions and verify the corrected behavior.
import assert from 'node:assert/strict'
import http from 'node:http'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand,assetStock,assetBusinessHistory} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const out=new URL('../../outputs/工具管理追加修复_20261109/',import.meta.url)
await fs.mkdir(out,{recursive:true})
const schema=`tools_fixed_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),findings=[],errors=[]
let server,browser,seq=0
const liveBefore=await(await fetch('http://127.0.0.1:5193/api/state')).json()
try{
 await db.init();const snapshot=await db.read(),s=snapshot.snapshot.data
 const run=(type,payload={},actor='合成审查员')=>applyToolCommand(s,{type,payload,actor,requestId:`ui-discovery-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const w=s.toolManagement.warehouses[0].id
 const t=run('TOOL_SAVE',{code:'ADDITIONAL-UI',name:'合成审查扳手'}).id
 const add=(code,quantity=10)=>run('ASSET_CREATE',{toolId:t,warehouseId:w,code,mode:'BULK',quantity,tag:code}).id
 const a=add('AUDIT-REPAIR'),b=add('AUDIT-COUNTS'),c=add('AUDIT-FAIL')
 const device=run('DEVICE_SAVE',{code:'AUDIT-DEVICE',name:'合成审查工具柜',warehouseId:w,kind:'CABINET'}).id
 const error=run('DEVICE_EVENT',{deviceId:device,eventId:'unknown',eventType:'CHECKOUT',tag:'DOES-NOT-EXIST',employeeId:s.employees[0].id,dueAt:'2099-01-01'})
 run('EVENT_RESOLVE',{id:error.id,resolution:'已人工检查并处理'})
 await db.save(snapshot.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:900}})
 page.on('pageerror',e=>errors.push(e.message))
 const modal=()=>page.locator('.modal, body:not(:has(.modal)) [data-tool-records-page]'),action=k=>page.locator(`[data-tool-table-action="${k}"]`)
 const close=async()=>{if(await page.locator('.modal').count())await page.locator('.modal [data-modal-cancel]').click();else await page.goto(base+'/#/functions/assets/tool-register')}
 await page.goto(base+'/#/functions/assets/tool-register');await action('asset-new').waitFor()
 await page.locator(`[data-tool-check="asset:${a}"]`).check();await action('repair').click()
 for(const [key,value] of Object.entries({provider:'合成维修单位',reason:'检查维修回执',actor:'合成送修员'}))await modal().locator(`[data-f="${key}"]`).fill(value)
 await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'})
 const service=(await db.read()).snapshot.data.toolManagement.services.at(-1);assert.equal(service.kind,'REPAIR')
 await action('receipt').click();const sentKind=await modal().locator('[data-record-kind]').inputValue(),sentRows=await modal().locator('[data-record-id]').count()
 assert.equal(sentKind,'repair');assert.equal(sentRows,1)
 await page.screenshot({path:fileURLToPath(new URL('07-维修回执正确.png',out))});await close()
 await action('service-finish').click();await modal().locator('[data-f="result"]').selectOption('PASS');await modal().locator('[data-f="certificate"]').fill('AUDIT-REPAIR-PASS');await modal().locator('[data-f="actor"]').fill('合成校验员')
 await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'});await action('receipt').click()
 const finishedKind=await modal().locator('[data-record-kind]').inputValue(),finishedRows=await modal().locator('[data-record-id]').count();assert.equal(finishedKind,'repair');assert.equal(finishedRows,1);await close()
 findings.push({id:'N07',priority:'P2',title:'送修和维修完成回执均打开正确记录',passed:true,method:'isolated PostgreSQL + browser',observed:{actualBusiness:'REPAIR',sendReceiptKind:sentKind,sendReceiptRows:sentRows,finishReceiptKind:finishedKind,finishReceiptRows:finishedRows},evidence:'07-维修回执正确.png',verified:'回执按每条已保存单据的实际kind定位'})
 await page.goto(base+'/#/functions/assets/tool-records');await page.locator('[data-record-kind]').waitFor();await page.locator('[data-record-audit]').click();await modal().locator('[data-record-kind]').selectOption('events')
 await modal().locator('[data-record-scope]').selectOption('todo');const pending=await modal().locator(`[data-record-id="${error.id}"]`).count()
 assert.equal(pending,0)
 await page.screenshot({path:fileURLToPath(new URL('08-异常处置已办结.png',out))})
 await modal().locator('[data-record-scope]').selectOption('done');await page.screenshot({path:fileURLToPath(new URL('08-异常处置已办结.png',out))});const done=await modal().locator(`[data-record-id="${error.id}"]`).count();assert.equal(done,1);await close()
 findings.push({id:'N08',priority:'P2',title:'已处置异常从待办移入已办结',passed:true,method:'isolated PostgreSQL + browser',observed:{resolvedEvent:error.id,visibleInTodo:pending,visibleInDone:done,resolution:'已人工检查并处理'},evidence:'08-异常处置已办结.png',verified:'保留ERROR原始结果，按resolvedAt区分办理范围'})
 await browser.close();browser=null
 const post=async(type,payload,actor='合成审查员')=>{
  const state=await db.read(),response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,actor,requestId:`pg-discovery-${++seq}`,revision:state.revision})}),data=await response.json()
  assert.equal(response.status,200,JSON.stringify(data));return data
 }
 const count=async()=>{const {id}=await post('COUNT_CREATE',{warehouseId:w}),row=(await db.read()).snapshot.data.toolManagement.counts.find(r=>r.id===id);await post('COUNT_FINISH',{id,reason:'同基准重复盘点审查',lines:row.lines.map(l=>({assetId:l.assetId,counted:l.assetId===b?9:l.expected}))});return id}
 const counts=[await count(),await count()]
 const beforeRequest=await db.read(),borrowTooMany=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'BORROW',payload:{assetId:b,quantity:10,borrower:'复核领用人',dueAt:'2099-01-01'},actor:'复核员',requestId:`too-many-${++seq}`,revision:beforeRequest.revision})})
 assert.equal(borrowTooMany.status,400);assert.equal((await db.read()).revision,beforeRequest.revision)
 assert.equal(beforeRequest.snapshot.data.toolManagement.assets.find(a=>a.id===b).quantity,10);assert.equal(assetStock(beforeRequest.snapshot.data.toolManagement,beforeRequest.snapshot.data.toolManagement.assets.find(a=>a.id===b)),9)
 const first=await post('DISPOSAL_REQUEST',{assetId:b,quantity:1,kind:'LOST',countId:counts[0],reason:'同一实物差异'})
 const rejected=async(countId)=>{const state=await db.read(),response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'DISPOSAL_REQUEST',payload:{assetId:b,quantity:1,kind:'LOST',countId,reason:'不得重复'},actor:'合成审查员',requestId:`rejected-${++seq}`,revision:state.revision})});assert.equal(response.status,400);assert.match((await response.json()).message,/尚未处理/);assert.equal((await db.read()).revision,state.revision)}
 await rejected(counts[1]);await post('DISPOSAL_REVIEW',{id:first.id,decision:'APPROVED',opinion:'合成独立审核'},'合成审核员');await rejected(counts[1])
 let persisted=(await db.read()).snapshot.data.toolManagement;assert.equal(persisted.assets.find(a=>a.id===b).quantity,9)
 const repair=await post('SERVICE_SEND',{assetId:c,quantity:1,kind:'REPAIR',provider:'合成维修方',reason:'部分维修'})
 const fail=await post('SERVICE_FINISH',{id:repair.id,result:'FAIL',certificate:'其中1件不合格'})
 await post('DISPOSAL_REVIEW',{id:fail.disposalId,decision:'REJECTED',opinion:'需补充资料'},'合成审核员')
 persisted=(await db.read()).snapshot.data.toolManagement;assert.equal(persisted.assets.find(a=>a.id===c).status,'AVAILABLE');assert.equal(persisted.assets.find(a=>a.id===c).quantity,9);assert.equal(persisted.assets.find(a=>a.id===fail.resultingAssetId).status,'DISABLED');assert.equal(persisted.assets.find(a=>a.id===fail.resultingAssetId).quantity,1)
 const databaseEvidence={N02:{countIds:counts,finalQuantity:9,physicalQuantity:9},N03:{total:10,failed:1,unaffectedStatus:'AVAILABLE',unaffectedQuantity:9,isolatedStatus:'DISABLED',isolatedQuantity:1}}
 databaseEvidence.N01={accountBeforeApproval:10,availableBeforeApproval:9,overBorrowHttpStatus:borrowTooMany.status}
 const inspected=await post('SERVICE_SEND',{assetId:a,quantity:2,kind:'INSPECTION',provider:'来源检定机构',reason:'拆分履历验收'}),passed=await post('SERVICE_FINISH',{id:inspected.id,result:'PASS',certificate:'PG-SOURCE-CERT'})
 const move=await post('TRANSFER',{assetId:passed.resultingAssetId,quantity:1,toWarehouseId:s.toolManagement.warehouses[1].id});await post('TRANSFER_FINISH',{id:move.id,decision:'RECEIVED'})
 persisted=(await db.read()).snapshot.data.toolManagement;const received=persisted.transfers.find(r=>r.id===move.id).resultingAssetId
 const reopened=createDatabase({...loadConfig(),schema});try{await reopened.init();const stored=(await reopened.read()).snapshot.data.toolManagement;assert.equal(assetBusinessHistory(stored,received,'services')[0].certificate,'PG-SOURCE-CERT');assert.equal(assetBusinessHistory(stored,received,'transfers')[0].id,move.id)}finally{await reopened.close()}
 const zero=await post('DEVICE_EVENT',{deviceId:device,eventId:'explicit-zero',eventType:'CHECKOUT',tag:'AUDIT-REPAIR',quantity:0,employeeId:s.employees.find(e=>e.status==='ACTIVE').id,dueAt:'2099-01-01'});assert.equal(zero.eventStatus,'ERROR');assert.equal((await db.read()).snapshot.data.toolManagement.loans.length,0)
 await post('KIT_SAVE',{code:'PG-KIT',name:'复核套装',lines:[{assetId:c,quantity:1}]})
 browser=await chromium.launch({channel:'msedge',headless:true});const finalPage=await browser.newPage({viewport:{width:1366,height:900}});finalPage.on('pageerror',e=>errors.push(e.message))
 await finalPage.goto(base+'/#/functions/assets/tool-register');await finalPage.locator('[data-tool-table-action="asset-new"]').waitFor()
 const targetRow=finalPage.locator(`[data-tool-row="asset:${received}"]`)
 await targetRow.locator('[data-tool-detail]').first().click();await finalPage.locator('[data-tool-detail-tab="service"]').click();assert.match(await finalPage.locator('[data-tool-detail-content]').innerText(),/PG-SOURCE-CERT/)
 await finalPage.screenshot({path:fileURLToPath(new URL('04-来源证书与新台账.png',out))});await finalPage.locator('.modal [data-modal-cancel]').click();while(await finalPage.locator('.modal').count())await finalPage.locator('.modal [data-modal-cancel]').click()
 await finalPage.locator(`[data-tool-check="asset:${c}"]`).check();assert.equal(await finalPage.locator('[data-tool-table-action="transfer"]').count(),0);assert.match(await finalPage.locator('[data-tool-operation-reason]').allTextContents().then(r=>r.join(' ')),/套装组成/)
 assert.ok(await finalPage.locator('.tool-table-state .tool-state').count()>0)
 await finalPage.locator('[name="query"]').fill('AUDIT-REPAIR');await finalPage.locator('[data-tool-query] [type="submit"]').click();assert.match(await finalPage.locator('[data-tool-hidden-selection]').innerText(),/1 项不在当前筛选结果内/)
 await finalPage.locator('[data-tool-reset-query]').click()
 await finalPage.locator('[data-tool-clear-selection]').click()
 await post('BATCH',{commands:['REPAIR','INSPECTION'].map(kind=>({type:'SERVICE_SEND',payload:{assetId:a,quantity:1,kind,provider:'混批复核方',reason:'混合回执验收'}}))})
 await finalPage.reload();await finalPage.locator(`[data-tool-check="asset:${a}"]`).check();await finalPage.locator('[data-tool-table-action="service-finish"]').click()
 await finalPage.locator('.modal [data-f="result"]').selectOption('PASS');await finalPage.locator('.modal [data-f="certificate"]').fill('MIXED-CERT');await finalPage.locator('.modal [data-f="actor"]').fill('混批复核员');await finalPage.locator('.modal [data-modal-confirm]').click();await finalPage.locator('.modal').waitFor({state:'detached'})
 assert.equal(await finalPage.locator('[data-tool-receipt-group]').count(),2)
 for(const kind of ['repair','inspection']){await finalPage.locator('[data-tool-receipt-group]').filter({hasText:kind==='repair'?'送修记录':'送检记录'}).click();assert.equal(await finalPage.locator('[data-record-kind]').inputValue(),kind);assert.equal(await finalPage.locator('[data-record-id]').count(),1);await finalPage.locator('.modal [data-modal-cancel]').click();while(await finalPage.locator('.modal').count())await finalPage.locator('.modal [data-modal-cancel]').click()}
 await finalPage.screenshot({path:fileURLToPath(new URL('07-混批回执分别定位.png',out))})
 databaseEvidence.N04={receivedAssetId:received,certificate:'PG-SOURCE-CERT',transferId:move.id,reopened:true};databaseEvidence.N05={explicitZeroStatus:zero.eventStatus,loanMutations:0};databaseEvidence.N06={kitMemberTransferDisabled:true};databaseEvidence.N07={mixedReceiptGroups:2,eachGroupRows:1}
 const approvalOne=await post('DISPOSAL_REQUEST',{assetId:a,quantity:1,kind:'LOST',reason:'合版审批范围甲'}),approvalTwo=await post('DISPOSAL_REQUEST',{assetId:a,quantity:1,kind:'SCRAPPED',reason:'合版审批范围乙'})
 const accountBefore=(await db.read()).snapshot.data.toolManagement.assets.find(r=>r.id===a).quantity
 await finalPage.reload();await finalPage.locator(`[data-tool-check="asset:${a}"]`).check()
 assert.equal(await finalPage.locator('[data-tool-next-action]').getAttribute('data-tool-table-action'),'disposal-review')
 await finalPage.locator('[data-tool-table-action="disposal-review"]').click()
 assert.match(await finalPage.locator('.modal').innerText(),/合版审批范围甲/);assert.match(await finalPage.locator('.modal').innerText(),/申请人 \/ 时间/)
 assert.match(await finalPage.locator('[data-tool-batch-scope]').innerText(),/2 张单 · 2 件/)
 assert.ok((await finalPage.locator('[data-tool-batch-scope]').innerText()).includes(`${accountBefore} → ${accountBefore-2}`))
 await finalPage.locator(`[data-finish-id="${approvalTwo.id}"]`).uncheck();assert.match(await finalPage.locator('[data-tool-batch-scope]').innerText(),/1 张单 · 1 件/)
 assert.ok((await finalPage.locator('[data-tool-batch-scope]').innerText()).includes(`${accountBefore} → ${accountBefore-1}`))
 await finalPage.locator(`[data-finish-id="${approvalOne.id}"]`).uncheck();assert.equal(await finalPage.locator('.modal [data-modal-confirm]').isDisabled(),true)
 await finalPage.locator(`[data-finish-id="${approvalOne.id}"]`).check();await finalPage.locator('.modal [data-f="decision"]').selectOption('REJECTED');assert.match(await finalPage.locator('[data-tool-batch-scope]').innerText(),/驳回不扣减/)
 await finalPage.locator('.modal [data-f="opinion"]').fill('补充依据后再申请');await finalPage.locator('.modal [data-f="actor"]').fill('合版UI独立审核员')
 await finalPage.screenshot({path:fileURLToPath(new URL('合版-审核依据与本次范围.png',out))})
 await finalPage.locator('.modal [data-modal-confirm]').click();await finalPage.locator('.modal').waitFor({state:'detached'})
 const afterReview=(await db.read()).snapshot.data.toolManagement
 assert.equal(afterReview.disposals.find(r=>r.id===approvalOne.id).status,'REJECTED');assert.equal(afterReview.disposals.find(r=>r.id===approvalTwo.id).status,'PENDING');assert.equal(afterReview.assets.find(r=>r.id===a).quantity,accountBefore)
 databaseEvidence.inheritedInteractions={statusColors:true,hiddenSelectionExplicit:true,nextAction:'disposal-review',reviewScope:'only checked applications',unselectedUnchanged:true,emptySelectionDisabled:true}
 assert.equal(errors.length,0)
 const liveAfter=await(await fetch('http://127.0.0.1:5193/api/state')).json();assert.equal(liveAfter.revision,liveBefore.revision)
 const result={date:'2026-11-09',passed:true,purpose:'Acceptance of original browser and PostgreSQL reproductions',productionWrites:false,productionRevisionBefore:liveBefore.revision,productionRevisionAfter:liveAfter.revision,findings,databaseEvidence,browserErrors:errors}
 await fs.writeFile(new URL('浏览器与数据库修复验证.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{
 await browser?.close();if(server)await new Promise(r=>server.close(r))
 if(!/^tools_fixed_\d+_\d+$/.test(schema))throw Error('Unexpected schema')
 await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
