import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const out=new URL('../test-artifacts/tool-ux-fixes/',import.meta.url),schema=`ux_round2_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),findings=[],errors=[]
let browser,server,seq=0
const note=(id,title,observed,evidence)=>findings.push({id,title,observed,...(evidence?{evidence}:{})})
const file=n=>new URL(n,out).pathname.replace(/^\/([A-Z]:)/,'$1')
try{
 await db.init();const snap=await db.read(),s=snap.snapshot.data
 const run=(type,payload={},actor='研究测试员')=>applyToolCommand(s,{type,payload,actor,requestId:`r2-fixture-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const wh=s.toolManagement.warehouses[0],other=s.toolManagement.warehouses[1]
 const t=run('TOOL_SAVE',{code:'R2-T',name:'复查扭矩扳手',lowStock:1}).id
 const add=(code,mode='NUMBERED',quantity=1)=>run('ASSET_CREATE',{toolId:t,warehouseId:wh.id,code,mode,quantity,tag:code,receivedAt:'2026-10-01'}).id
 const a=add('R2-A'),b=add('R2-B'),c=add('R2-C'),d=add('R2-D'),bulk=add('R2-BULK','BULK',6)
 run('BORROW',{assetId:b,quantity:1,borrower:'研究领用人',borrowType:'检修使用',dueAt:'2099-01-01T17:00'})
 run('SERVICE_SEND',{assetId:c,quantity:1,kind:'INSPECTION',provider:'研究计量室',reason:'周期检定'})
 run('SERVICE_SEND',{assetId:d,quantity:1,kind:'REPAIR',provider:'研究维修室',reason:'损坏维修'})
 for(let i=1;i<=27;i++)add(`R2-FILL-${i}`)
 snap.snapshot=exportDemoSnapshot(s);await db.save(snap.revision,snap.snapshot)
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}})
 page.on('pageerror',e=>errors.push(e.message));await fs.mkdir(new URL('screenshots/',out),{recursive:true})
 const action=k=>page.locator(`[data-tool-table-action="${k}"]`),modal=()=>page.locator('.modal')
 const close=async()=>{if(await modal().count())await modal().locator('[data-modal-cancel]').click()}
 const check=id=>page.locator(`[data-tool-check="asset:${id}"]`).check()
 const clear=async()=>{if(await page.locator('[data-tool-clear-selection]').count())await page.locator('[data-tool-clear-selection]').click()}
 const reset=async()=>{await page.locator('[data-tool-reset-query]').click();await clear()}
 const savedCount=async id=>(await db.read()).snapshot.data.toolManagement.counts.find(c=>c.id===id)
 const waitProgress=async(id,assetId,n)=>{for(let i=0;i<40;i++){if((await savedCount(id)).lines.find(l=>l.assetId===assetId).counted===n)return;await new Promise(r=>setTimeout(r,100))}throw Error('Count progress not saved')}
 const openCount=async id=>{await action('count-history').click();await modal().locator(`[name="count-history"][value="${id}"]`).check();await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'})}
 const newCount=async()=>{await action('count-new').click();await modal().locator('[data-f="warehouseId"]').selectOption(String(wh.id));await modal().locator('[data-f="actor"]').fill('研究盘点人');await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'});return (await db.read()).snapshot.data.toolManagement.counts.at(-1).id}
 await page.goto(base+'/#/functions/assets/tool-register');await action('tool-data').waitFor()
 await page.screenshot({path:file('screenshots/01-current-desktop.png')})
 note('R01','首屏数据密度及初始操作区',await page.evaluate(()=>{const t=document.querySelector('.tool-table-scroll'),p=document.querySelector('.tool-workspace-actions');return {viewport:{width:innerWidth,height:innerHeight},table:{clientWidth:t.clientWidth,scrollWidth:t.scrollWidth},columns:document.querySelectorAll('.tool-master-table th').length,bottomTop:p.getBoundingClientRect().top}}),'screenshots/01-current-desktop.png')
 await page.locator(`[data-tool-detail="asset:${a}"]`).click();note('R02','名称详情与复选框选择已分离',{modalTitle:await modal().locator('h3').innerText(),selected:await page.locator('[data-tool-check]:checked').count()});await close()
 await check(a);note('R03','选中后固定底栏',{geometry:await page.locator('[data-tool-bottom]').evaluate(el=>({position:getComputedStyle(el).position,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:el.offsetHeight})),actions:await page.locator('[data-tool-operation-group="selection"] button').allTextContents()});await page.screenshot({path:file('screenshots/02-selected-bottom.png')})
 await check(b);note('R04','混选动作保留，灰显并说明原因',{actions:await page.locator('[data-tool-operation-group="selection"] button').allTextContents(),reasonControls:await page.locator('[data-tool-operation-reason]').count()});await reset()
 note('R05','统计已可点击',{buttons:await page.locator('.tool-global-stats button').count()})
 await page.locator('[data-tool-stat="service"]').click();note('R06','送检送修统计进入清单的覆盖',{queryStatus:await page.locator('[name="queryStatus"]').inputValue(),inspectionVisible:await page.locator(`[data-tool-row="asset:${c}"]`).count(),repairVisible:await page.locator(`[data-tool-row="asset:${d}"]`).count()});await reset()
 await page.locator('[name="warehouse"]').selectOption(String(other.id));await page.locator('[data-tool-query] [type="submit"]').click();await page.locator('[data-tool-stat="borrowed"]').click();note('R07','全局统计跳转是否清理旧查询',{warehouse:await page.locator('[name="warehouse"]').inputValue(),borrowedVisible:await page.locator(`[data-tool-row="asset:${b}"]`).count()});await reset()
 await check(a);await action('borrow').click();await modal().locator('[data-f="borrower"]').fill('未保存草稿')
 const handleDialog=dialog=>dialog.dismiss();page.once('dialog',handleDialog);await page.locator('.modal-backdrop').click({position:{x:3,y:3}});note('R08','误点遮罩已有保护',{modalRetained:await modal().count(),value:await modal().locator('[data-f="borrower"]').inputValue()});await close()
 await action('borrow').click();note('R09','显式取消清空，确认文案明确动作',{borrower:await modal().locator('[data-f="borrower"]').inputValue(),confirmText:await modal().locator('[data-modal-confirm]').innerText()});await close();await clear()
 await action('tool-data').click();await modal().locator('[data-base-tab="categories"]').click();await modal().locator('[data-base-action="add"]').click();await close();note('R10','取消基础资料子操作的原上下文',{modals:await modal().count(),categoriesRestored:await page.locator('[data-base-tab="categories"]').count()});await close()
 await action('records').click();await modal().locator('[data-record-id]').first().check();await modal().locator('[data-record-action="return"]').click();await close();note('R11','取消归还返回原清单',{recordViews:await page.locator('[data-record-kind]').count()});await close()
 const countId=await newCount();await page.locator(`[data-count-present="${a}"]`).check();await waitProgress(countId,a,1);await page.reload();await action('count-history').waitFor();await openCount(countId)
 note('R12','等待服务端保存后刷新恢复',{checked:await page.locator(`[data-count-present="${a}"]`).isChecked(),counted:(await savedCount(countId)).lines.find(l=>l.assetId===a).counted})
 await action('count-confirm').click();note('R13','未核对项不能直接确认',{confirmModal:await modal().count(),warning:await page.locator('.toast.warning').last().innerText()})
 await page.locator(`[data-count-verified="${a}"]`).selectOption('UNVERIFIED');await page.waitForTimeout(800);await page.reload();await action('count-history').waitFor();await openCount(countId)
 note('R14','撤回已核对状态在刷新后是否恢复',{selectedStatus:await page.locator(`[data-count-verified="${a}"]`).inputValue(),serverCounted:(await savedCount(countId)).lines.find(l=>l.assetId===a).counted})
 await page.screenshot({path:file('screenshots/03-unverify-refresh.png')});await action('count-exit').click()
 const fastId=await newCount();await page.locator(`[data-count-present="${a}"]`).check();await page.reload();await action('count-history').waitFor();await page.waitForTimeout(650);await openCount(fastId);await waitProgress(fastId,a,1)
 note('R15','勾选后立即刷新',{selectedStatus:await page.locator(`[data-count-verified="${a}"]`).inputValue(),serverCounted:(await savedCount(fastId)).lines.find(l=>l.assetId===a).counted});await action('count-exit').click()
 await check(a);await page.setViewportSize({width:390,height:844});await page.screenshot({path:file('screenshots/04-selected-mobile.png')})
 note('R16','窄屏固定底栏占用与横向溢出',await page.evaluate(()=>{const p=document.querySelector('[data-tool-bottom].has-selection'),r=p.getBoundingClientRect();return {viewport:innerHeight,bodyWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,panelHeight:r.height,panelTop:r.top,percent:Math.round(r.height/innerHeight*100)}}),'screenshots/04-selected-mobile.png')
 await page.setViewportSize({width:1366,height:768});await clear();await page.locator('[name="query"]').fill('R2-A');await page.locator('[data-tool-query] [type="submit"]').click();await page.reload();await action('tool-data').waitFor()
 note('R17','查询恢复及表格效率控件',{query:await page.locator('[name="query"]').inputValue(),sortOrViews:await page.locator('[aria-sort],[data-tool-sort],[data-tool-columns],[data-tool-saved-view]').count()})
 await check(a);await action('borrow').click();await page.evaluate(()=>location.hash='#/functions/catalog');await page.locator('[data-function-directory]').waitFor();note('R18','切换路由后工具弹窗是否仍悬挂',{modals:await modal().count(),hash:await page.evaluate(()=>location.hash)});await close()
 // Pure domain reproduction uses a separate in-memory state, not the DB fixture.
 const memory=structuredClone(s);let k=0;const cmd=(type,payload)=>applyToolCommand(memory,{type,payload,actor:'内存研究',requestId:`count-boundary-${++k}`})
 const cid=cmd('COUNT_CREATE',{warehouseId:wh.id}).id,row=memory.toolManagement.counts.find(r=>r.id===cid)
 cmd('COUNT_FINISH',{id:cid,reason:'只在内存复现盘点边界',lines:row.lines.map(l=>({assetId:l.assetId,counted:l.assetId===a?0:l.expected}))})
 const item=memory.toolManagement.assets.find(i=>i.id===a);let lossApplication
 try{cmd('DISPOSAL_REQUEST',{assetId:a,quantity:1,kind:'LOST',countId:cid,reason:'盘点差异申请'});lossApplication='accepted'}catch(e){lossApplication=e.message}
 note('R19','盘点保留账面数量，允许关联申请',{quantity:item.quantity,status:item.status,lossApplication,approvalCount:memory.toolManagement.disposals.length,method:'pure in-memory domain command'})
  const observed=id=>findings.find(f=>f.id===id).observed
 assert.ok(observed('R01').bottomTop>0&&observed('R01').bottomTop<768)
 assert.ok(observed('R03').geometry.height<180)
 assert.equal(observed('R02').selected,0)
 assert.ok(observed('R04').reasonControls>0)
 assert.equal(observed('R06').inspectionVisible,1);assert.equal(observed('R06').repairVisible,1)
 assert.equal(observed('R07').warehouse,'');assert.equal(observed('R07').borrowedVisible,1)
 assert.equal(observed('R08').modalRetained,1);assert.match(observed('R09').confirmText,/借出/)
 assert.equal(observed('R10').categoriesRestored,1);assert.equal(observed('R11').recordViews,1)
 assert.equal(observed('R12').counted,1);assert.equal(observed('R13').confirmModal,0)
 assert.equal(observed('R14').selectedStatus,'UNVERIFIED');assert.equal(observed('R14').serverCounted,null)
 assert.equal(observed('R15').selectedStatus,'FOUND');assert.equal(observed('R15').serverCounted,1)
 assert.ok(observed('R16').panelTop>=0&&observed('R16').panelTop+observed('R16').panelHeight<=845);assert.ok(observed('R16').percent<=27);assert.equal(observed('R16').bodyWidth,390)
 assert.equal(observed('R17').query,'R2-A');assert.ok(observed('R17').sortOrViews>0)
 assert.equal(observed('R18').modals,0)
 assert.equal(observed('R19').quantity,1);assert.equal(observed('R19').lossApplication,'accepted')
 await page.goto(base+'/#/functions/assets/tool-register');await action('tool-data').waitFor();await reset()
 // Scan selects an identity once; it never silently increments business quantity.
 await page.locator('[data-tool-scan-mode]').check()
 const scan=async value=>{await page.locator('[name="query"]').fill(value);await page.locator('[name="query"]').press('Enter')}
 await scan('R2-A');assert.equal(await page.locator('[data-tool-check]:checked').count(),1)
 await scan('R2-A');assert.match(await page.locator('[data-tool-scan-status]').innerText(),/未重复添加/)
 await scan('UNKNOWN-TEST');assert.match(await page.locator('[data-tool-scan-status]').innerText(),/未找到/)
 assert.equal(await page.locator('[data-tool-check]:checked').count(),1)
 await page.locator('[data-tool-scan-mode]').uncheck();await reset()
 note('R20','连续扫码：加入、重复、未知标签',{passed:true})
 // Custom quantity controls must participate in the dirty-form protection.
 await check(bulk);await action('borrow').click()
 await modal().locator(`[data-batch-quantity="asset:${bulk}"]`).fill('2')
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('.modal-backdrop').click({position:{x:3,y:3}})
 assert.equal(await modal().count(),1);await close();await clear()
 note('R21','批量数量修改同样保护误关表单',{passed:true})
 const offlineCount=await newCount()
 await page.context().setOffline(true)
 await page.locator(`[data-count-present="${a}"]`).check()
 await page.locator('[data-count-save-status]').filter({hasText:'保存未完成'}).waitFor()
 assert.equal((await savedCount(offlineCount)).lines.find(l=>l.assetId===a).counted,null)
 await page.context().setOffline(false);await action('count-retry').click();await waitProgress(offlineCount,a,1)
 assert.match(await page.locator('[data-count-save-status]').innerText(),/已保存/)
 await action('count-exit').click()
 note('R22','离线失败保留草稿，联网显式重试后保存',{passed:true})
 const post=async(type,payload,actor='回归测试员',requestId=`regression-${++seq}`)=>{
  const current=await db.read();const response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,actor,requestId,revision:current.revision})})
  return {status:response.status,result:await response.json()}
 }
 // A stale count version must not overwrite another operator even with a fresh app revision.
 const beforeConcurrency=await savedCount(offlineCount),rev=beforeConcurrency.progressRevision||0
 assert.equal((await post('COUNT_PROGRESS',{id:offlineCount,progressRevision:rev,lines:[{assetId:a,counted:0}]})).status,200)
 const stale=await post('COUNT_PROGRESS',{id:offlineCount,progressRevision:rev,lines:[{assetId:a,counted:1}]})
 assert.equal(stale.status,400);assert.match(stale.result.message,/其他页面/)
 assert.equal((await savedCount(offlineCount)).lines.find(l=>l.assetId===a).counted,0)
 note('R23','并发盘点拒绝旧版，不覆盖他人进度',{passed:true})
 // Full PostgreSQL and browser chain: count discrepancy -> application -> review -> exactly one write-off.
 const created=await post('COUNT_CREATE',{warehouseId:wh.id});assert.equal(created.status,200)
 const closedId=created.result.id,closed=await savedCount(closedId)
 const lines=closed.lines.map(l=>({assetId:l.assetId,counted:l.assetId===bulk?l.expected-1:l.expected}))
 assert.equal((await post('COUNT_FINISH',{id:closedId,lines,reason:'回归盘点差异'})).status,200)
 assert.equal((await db.read()).snapshot.data.toolManagement.assets.find(x=>x.id===bulk).quantity,6)
 await page.reload();await action('tool-data').waitFor();await openCount(closedId)
 await action('count-loss').click();await modal().locator('[data-f="actor"]').fill('差异申请员')
 await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'})
 let management=(await db.read()).snapshot.data.toolManagement
 const disposal=management.disposals.find(x=>x.countId===closedId);assert.ok(disposal);assert.equal(disposal.status,'PENDING')
 assert.equal(management.assets.find(x=>x.id===bulk).quantity,6)
 await action('count-exit').click();await action('records').click();await modal().locator('[data-record-kind]').selectOption('disposals')
 await modal().locator(`[data-record-id="${disposal.id}"]`).check();await modal().locator('[data-record-action="disposal-review"]').click()
 await modal().locator('[data-f="actor"]').fill('独立审核员');await modal().locator('[data-f="opinion"]').fill('独立核实盘亏')
 await modal().locator('[data-modal-confirm]').click();await modal().locator('[data-record-kind]').waitFor();await close()
 management=(await db.read()).snapshot.data.toolManagement
 assert.equal(management.assets.find(x=>x.id===bulk).quantity,5)
 assert.equal(management.disposals.find(x=>x.id===disposal.id).status,'APPROVED')
 const duplicate=await post('DISPOSAL_REQUEST',{assetId:bulk,quantity:1,kind:'LOST',countId:closedId,reason:'不得重复申请'})
 assert.equal(duplicate.status,400);assert.match(duplicate.result.message,/盘亏数量/)
 note('R24','盘点只存差异，关联申请与独立审核后扣一次，重复申请拒绝',{passed:true})
 await page.reload();await action('tool-data').waitFor();await openCount(offlineCount)
 const currentProgress=await savedCount(offlineCount)
 await page.locator(`[data-count-verified="${a}"]`).selectOption('FOUND')
 assert.equal((await post('COUNT_PROGRESS',{id:offlineCount,progressRevision:currentProgress.progressRevision,lines:[{assetId:a,counted:0}]})).status,200)
 await page.locator('[data-count-save-status]').filter({hasText:'保存未完成'}).waitFor()
 await action('count-retry').click();await page.locator('[data-count-save-status]').filter({hasText:'其他页面'}).waitFor()
 assert.equal((await savedCount(offlineCount)).lines.find(l=>l.assetId===a).counted,0)
 page.once('dialog',dialog=>dialog.accept());await action('count-reload').click()
 await page.waitForFunction(id=>document.querySelector(`[data-count-verified="${id}"]`)?.value==='MISSING',a)
 assert.equal(await page.locator(`[data-count-present="${a}"]`).isChecked(),false)
 note('R25','旧进度冲突显式提示，读取最新后重新核对',{passed:true})
 assert.equal(errors.length,0)

 await fs.writeFile(new URL('local_observations.json',out),JSON.stringify({date:'2026-11-08',method:'Isolated PostgreSQL schema + synthetic fixtures + pure-memory boundary reproduction; no production writes',findings,errors},null,2))
 console.log(JSON.stringify({observations:findings.length,errors,findings},null,2))
}finally{
 await browser?.close();if(server)await new Promise(r=>server.close(r))
 if(!/^ux_round2_\d+_\d+$/.test(schema))throw Error('Unexpected schema')
 await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
