import fs from 'node:fs/promises'
import http from 'node:http'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const schema=`tool_context_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),out=new URL('../test-artifacts/tool-context-fixes/',import.meta.url)
let server
try{
 await fs.mkdir(out,{recursive:true});await db.init();const snap=await db.read(),s=snap.snapshot.data
 const stamp='2026-11-11T18:30:37.123Z';let seq=0
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'上下文测试员',requestId:`context-${++seq}`},{now:stamp})
 run('WAREHOUSE_STANDARDIZE',{});const [wh,other]=s.toolManagement.warehouses
 const t=run('TOOL_SAVE',{code:'CONTEXT-TOOL',name:'上下文验证工具'})
 const add=(code,warehouseId=wh.id,quantity=1,extra={})=>run('ASSET_CREATE',{code,warehouseId,toolId:t.id,quantity,mode:quantity===1?'NUMBERED':'BULK',receivedAt:stamp,...extra})
 const edit=add('CONTEXT-EDIT',wh.id,1,{lastRepairAt:'2026-11-11',lastInspectionAt:stamp}),del=add('CONTEXT-DELETE'),bulk=add('CONTEXT-BULK',wh.id,10),member=add('CONTEXT-MEMBER'),remote=add('CONTEXT-REMOTE',other.id),closedAsset=add('CONTEXT-CLOSED')
 const kit=run('KIT_SAVE',{code:'CONTEXT-KIT',name:'上下文套装',lines:[{assetId:member.id,quantity:1}]})
 const loan=run('BORROW',{assetId:bulk.id,quantity:8,borrower:'借出八件',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 const kitLoan=run('BORROW',{kitId:kit.id,borrower:'套装领用人',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 run('BORROW',{assetId:remote.id,quantity:1,borrower:'整备库领用人',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 const closed=run('BORROW',{assetId:closedAsset.id,quantity:1,borrower:'已归还人员',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 run('RETURN',{loanId:closed.id,assetId:closedAsset.id,quantity:1,returner:'已归还人员'})
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const fixture={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),stamp,edit:edit.id,del:del.id,bulk:bulk.id,loan:loan.id,kitLoan:kitLoan.id,warehouse:wh.id}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_context_fixes_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Python UI checks failed: ${code}`)));child.stdin.end(JSON.stringify(fixture))})
 const saved=(await db.read()).snapshot.data,m=saved.toolManagement
 assert.equal(m.assets.find(a=>a.id===edit.id).receivedAt,stamp,'unchanged precise UTC instant preserved through editing')
 assert.equal(m.assets.find(a=>a.id===edit.id).lastInspectionAt,stamp,'date editor must preserve unchanged timestamp precision')
 assert.equal(m.assets.find(a=>a.id===edit.id).lastRepairAt,'2026-11-11','date-only fact unchanged')
 const deleted=m.audit.find(a=>a.action==='ASSET_DELETE'&&JSON.parse(a.detail).assetId===del.id)
 assert.equal(deleted.objects[0].before.code,'CONTEXT-DELETE');assert.equal(deleted.objects[0].after,null)
 assert.equal(deleted.objects[0].before.name,'上下文验证工具');assert.equal(deleted.objects[0].before.warehouseName,'检修工具库')
 assert.equal(m.loans.filter(l=>l.borrower==='数量错误不应保存').length,0)
 console.log(JSON.stringify({passed:true,postgresSnapshotRetained:true,productionWrites:false}))
}finally{if(server)await new Promise(r=>server.close(r));if(!/^tool_context_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
