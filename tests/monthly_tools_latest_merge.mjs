import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const schema=`monthly_tools_merge_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),checks=[]
let server,seq=0,cookie=''
try{
 await db.init();await db.init()
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 const request=async(path,method='GET',payload,role='PLANNER',expected=200)=>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-PC1-Simulated-Role':role,...(cookie?{Cookie:cookie}:{})},...(payload?{body:JSON.stringify(payload)}:{})})
  const setCookie=response.headers.getSetCookie?.()[0];if(setCookie)cookie=setCookie.split(';')[0]
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data
 }
 const tool=async(type,payload,actor='合版工具经办')=>db.toolCommand({type,payload,actor,requestId:`latest-merge-${++seq}`,revision:(await db.read()).revision})
 await tool('WAREHOUSE_STANDARDIZE');let state=(await db.read()).snapshot.data
 const w=state.toolManagement.warehouses[0].id,t=(await tool('TOOL_SAVE',{code:'LATEST-MERGE',name:'合版回归工具'})).id,a=(await tool('ASSET_CREATE',{toolId:t,warehouseId:w,code:'LATEST-MERGE-A',mode:'BULK',quantity:10})).id
 const csv='\uFEFF机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\r\nLATEST-MERGE-01,HXD1C,HXD1C高级修,1,2199-01-01,测试局,测试段,100,原备注\r\nLATEST-MERGE-02,HXD1C,HXD1C高级修,1,2199-01-02,测试局,测试段,200,保留草稿\r\n'
 const beforePreview=await db.read(),preview=await request('/api/planning/import/preview','POST',{filename:'2199年1月合版演示.csv',contentBase64:Buffer.from(csv).toString('base64'),importType:'MONTHLY',month:'2199-01'})
 await request(`/api/planning/import/preview/${preview.id}/rows/${preview.rows[0].line}`,'PATCH',{values:{remark:'编辑预览后的备注'}})
 assert.equal((await db.read()).revision,beforePreview.revision)
 await request('/api/planning/import/confirm','POST',{previewId:preview.id,titleOverwriteChoice:'KEEP'})
 state=(await db.read()).snapshot.data;assert.equal(state.vehicleRepairs.find(v=>v.locomotiveNo==='LATEST-MERGE-01').remark,'编辑预览后的备注')
 checks.push('实际CSV导入预览可编辑、零写入；确认后新月度草稿与工具台账共存')
 const period={year:2199,month:1},read=role=>request('/api/monthly-plans/month?year=2199&month=1','GET',undefined,role),monthly=(path,payload={},role='PLANNER')=>request('/api/monthly-plans/'+path,'POST',{...period,...payload},role)
 let plan=await read('PLANNER');assert.equal(plan.draftItems.length,2)
 const first=plan.draftItems[0],second=plan.draftItems[1],stale=await db.read()
 await monthly('submit',{selectedItemKeys:[first.stableItemKey],note:'只提交第一车'})
 assert.ok((await db.read()).revision>stale.revision)
 await assert.rejects(()=>db.save(stale.revision,stale.snapshot),e=>e.status===409)
 const loan=await tool('BORROW',{assetId:a,quantity:2,borrower:'合版领用人',dueAt:'2199-02-01'})
 assert.equal((await db.read()).snapshot.data.approvalRecords.filter(r=>r.businessType==='MONTHLY_PLAN_APPLICATION').length,1)
 checks.push('月度提交推进共用版本；旧快照保存被拒绝；工具借出不覆盖月度待审记录')
 const chief=await read('SECTION_CHIEF'),pending=chief.items.find(v=>v.isPending)
 await request(`/api/monthly-plans/items/${pending.vehicleRepairId}`,'PATCH',{...period,values:{...pending,plannedEntryAt:'2199-01-03',remark:'审核时修订'},changeReason:'合版修订依据'},'SECTION_CHIEF')
 await monthly('decision',{action:'APPROVE'},'SECTION_CHIEF')
 const loss=await tool('DISPOSAL_REQUEST',{assetId:a,quantity:1,kind:'LOST',reason:'工具遗失审核与月度审核并存'})
 const reviewed=await read('SECTION_CHIEF');assert.ok(reviewed.items.some(v=>v.isReviewedPending))
 await monthly('request-publish',{selectedItemKeys:[first.stableItemKey],note:'仅发布第一车'},'SECTION_CHIEF')
 await tool('DISPOSAL_REVIEW',{id:loss.id,decision:'APPROVED',opinion:'独立审核'},'合版独立审核员')
 await monthly('decision',{action:'APPROVE'},'DEPUTY_DIRECTOR')
 const published=await read('PLANNER');assert.equal(published.items.filter(v=>v.isPublished).length,1);assert.equal(published.draftItems.length,1)
 assert.equal(published.items.find(v=>v.isPublished).remark,'审核时修订')
 assert.equal((await db.read()).snapshot.data.toolManagement.assets.find(x=>x.id===a).quantity,9)
 checks.push('月度审核修订→选中申请发布→副段长发布，与工具遗失独立审核交替操作均保留记录')
 const sameRevision=(await db.read()).revision
 const returnCommand={type:'RETURN',payload:{assetId:a,loanId:loan.id,quantity:1,returner:'合版领用人'},actor:'合版工具经办',requestId:'concurrent-monthly-return',revision:sameRevision}
 const [submitted,returned]=await Promise.all([monthly('submit',{selectedItemKeys:[second.stableItemKey],adjustReason:'第二车后续申请'}),db.toolCommand(returnCommand).then(r=>({ok:true,result:r}),e=>({ok:false,error:e}))])
 assert.equal(submitted.selectedCount,1)
 if(!returned.ok){assert.equal(returned.error.status,409);await db.toolCommand({...returnCommand,revision:(await db.read()).revision})}
 await monthly('withdraw')
 await tool('RETURN',{assetId:a,loanId:loan.id,quantity:1,returner:'合版领用人'})
 let stored=(await db.read()).snapshot.data
 assert.equal(stored.toolManagement.loans.find(l=>l.id===loan.id).status,'CLOSED')
 assert.equal(stored.tools.find(x=>x.id===t).quantity,9)
 assert.ok(stored.approvalRecords.some(r=>r.businessType==='MONTHLY_PLAN_APPLICATION'&&r.approvalStatus==='WITHDRAWN'))
 assert.ok(stored.approvalRecords.some(r=>r.businessType==='TOOL_DISPOSAL'&&r.approvalStatus==='APPROVED'))
 checks.push('月度申请与工具归还并发写入串行化；冲突重试后不丢业务；撤回状态与工具校验兼容')
 const countRows=async table=>(await db.pool.query(`SELECT count(*)::int n FROM "${schema}"."${table}"`)).rows[0].n
 const histories={revision:await countRows('monthly_plan_revision_history'),publication:await countRows('monthly_plan_publication_history')}
 assert.ok(histories.revision>0);assert.ok(histories.publication>0)
 const saved=await db.read();await db.save(saved.revision,exportDemoSnapshot(saved.snapshot.data))
 assert.equal(await countRows('monthly_plan_revision_history'),histories.revision);assert.equal(await countRows('monthly_plan_publication_history'),histories.publication)
 const beforeRestart=await db.read();await db.init();const afterRestart=await db.read()
 assert.equal(afterRestart.revision,beforeRestart.revision);assert.deepEqual(afterRestart.snapshot.data.toolManagement,beforeRestart.snapshot.data.toolManagement)
 checks.push('全量快照保存及重复初始化保留新月度版本、修订和发布历史，以及完整工具记录')
 const report={passed:true,upstream:'07676d4',checks,productionWrites:false}
 await fs.mkdir('test-artifacts/latest-merge',{recursive:true});await fs.writeFile('test-artifacts/latest-merge/monthly-tools.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{
 if(server)await new Promise(r=>server.close(r));assert.match(schema,/^monthly_tools_merge_\d+_\d+$/);await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
