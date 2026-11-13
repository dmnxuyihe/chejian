import assert from 'node:assert/strict'
import http from 'node:http'
import {createState} from '../src/core/state.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
import {toolTestSession} from './tool_auth_fixture.mjs'
const s=createState(),checks=[]
let seq=0
const run=(type,payload={},actor='测试员')=>applyToolCommand(s,{type,payload,actor,requestId:`table-${++seq}`})
const rejects=(fn,re)=>{const before=structuredClone(s);assert.throws(fn,re);assert.deepEqual(s,before)}
const original=run('WAREHOUSE_SAVE',{code:'OLD',name:'构架工具库'}).id
const category=run('CATEGORY_SAVE',{code:'CAT',name:'分类'}).id
run('CATEGORY_SAVE',{id:category,code:'CAT',name:'修改分类'})
const t=run('TOOL_SAVE',{code:'CRUD',name:'工具',categoryId:category}).id
const a=run('ASSET_CREATE',{toolId:t,warehouseId:original,code:'CRUD-1',mode:'NUMBERED',quantity:1,tag:'1001',receivedAt:'2026-10-01',lastRepairAt:'2026-10-02'}).id
run('WAREHOUSE_STANDARDIZE')
assert.equal(s.toolManagement.warehousePolicy,'FIXED_TWO');assert.deepEqual(s.toolManagement.warehouses.map(w=>w.name),['检修工具库','整备工具库']);assert.equal(s.toolManagement.assets[0].warehouseId,original)
rejects(()=>run('WAREHOUSE_SAVE',{code:'EXTRA',name:'第三库'}),/不可新增/)
run('WAREHOUSE_STANDARDIZE');assert.equal(s.toolManagement.warehouses.length,2)
rejects(()=>run('CATEGORY_DELETE',{id:category}),/引用/)
rejects(()=>run('TOOL_DELETE',{id:t}),/引用/)
run('ASSET_EDIT',{assetId:a,code:'CRUD-EDIT',tag:'1002',receivedAt:'2026-09-01',lastRepairAt:'2026-10-03'})
assert.equal(s.toolManagement.assets[0].receivedAt,'2026-09-01')
const b=run('ASSET_CREATE',{toolId:t,warehouseId:original,code:'CRUD-2',mode:'BULK',quantity:3}).id
const before=structuredClone(s)
rejects(()=>run('BATCH',{commands:[{type:'BORROW',payload:{assetId:a,quantity:1,borrower:'甲',dueAt:'2099-01-01'}},{type:'BORROW',payload:{assetId:b,quantity:100,borrower:'甲',dueAt:'2099-01-01'}}]}),/不足/)
assert.deepEqual(s,before)
rejects(()=>run('BATCH',{commands:[{type:'BATCH',payload:{commands:[]}}]}),/不支持/)
const batchInput={type:'BATCH',actor:'领用员',requestId:'table-repeat',payload:{commands:[a,b].map(assetId=>({type:'BORROW',payload:{assetId,quantity:1,borrower:'甲',dueAt:'2099-01-01'}}))}}
const borrowed=applyToolCommand(s,batchInput);const commandCount=s.toolManagement.commands.length
assert.equal(applyToolCommand(s,batchInput).duplicate,true);assert.equal(s.toolManagement.commands.length,commandCount)
rejects(()=>run('ASSET_DELETE',{assetId:a}),/业务记录/)
run('BATCH',{commands:borrowed.results.map((result,i)=>({type:'RETURN',payload:{loanId:result.id,assetId:[a,b][i],quantity:1,returner:'甲'}}))})
checks.push('固定两库初始化保留引用；重复初始化幂等；批量任一失败无部分写入，重复请求不重复扣减')
const tempTool=run('TOOL_SAVE',{code:'TEMP',name:'临时品种'}).id
const tempAsset=run('ASSET_CREATE',{toolId:tempTool,warehouseId:original,code:'TEMP-1',mode:'NUMBERED',quantity:1}).id
const kit=run('KIT_SAVE',{code:'TEMP-K',name:'临时套装',lines:[{assetId:tempAsset,quantity:1}]}).id
run('KIT_SAVE',{id:kit,code:'TEMP-K',name:'修改套装',lines:[{assetId:tempAsset,quantity:1}]})
rejects(()=>run('ASSET_DELETE',{assetId:tempAsset}),/套装引用/)
run('KIT_DELETE',{id:kit});run('ASSET_DELETE',{assetId:tempAsset});assert.equal(s.tools.find(t=>t.id===tempTool).quantity,0)
run('TOOL_DELETE',{id:tempTool})
const unusedCategory=run('CATEGORY_SAVE',{code:'DEL',name:'删除分类'}).id;run('CATEGORY_DELETE',{id:unusedCategory})
const device=run('DEVICE_SAVE',{code:'D',name:'工具柜',warehouseId:original,kind:'CABINET'}).id
run('DEVICE_SAVE',{id:device,code:'D',name:'修改工具柜',warehouseId:original,kind:'CABINET',enabled:false})
run('DEVICE_DELETE',{id:device})
assert.ok(!s.toolManagement.kits.length);assert.ok(!s.toolManagement.devices.length)
checks.push('工具字典、分类、套装、设施和实物增改删可执行，历史引用受保护')

const schema=`tool_table_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
let server
try{
 await db.init();const snap=await db.read();await db.save(snap.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 const current=await db.read()
 const payload={type:'BATCH',actor:'数据库领用员',requestId:'db-batch',revision:current.revision,payload:{commands:[a,b].map(assetId=>({type:'BORROW',payload:{assetId,quantity:1,borrower:'乙',dueAt:'2099-01-01'}}))}}
 const cookie=await toolTestSession(db,base,'数据库领用员')
 const post=async p=>{const response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(p)});return {status:response.status,body:await response.json()}}
 const saved=await post(payload);assert.equal(saved.status,200)
 const retry=await post(payload);assert.equal(retry.body.duplicate,true)
 const loaded=await db.read();assert.equal(loaded.revision,current.revision+1);assert.equal(loaded.snapshot.data.toolManagement.loans.length,current.snapshot.data.toolManagement.loans.length+2)
 assert.equal(loaded.snapshot.data.toolManagement.assets.find(x=>x.id===a).lastRepairAt,'2026-10-03')
 const invalid=await post({...payload,requestId:'db-fail',revision:loaded.revision,payload:{commands:[{type:'RETURN',payload:{loanId:saved.body.results[0].id,assetId:a,quantity:1,returner:'乙'}},{type:'BORROW',payload:{assetId:b,quantity:100,borrower:'丙',dueAt:'2099-01-01'}}]}})
 assert.equal(invalid.status,400);assert.deepEqual(await db.read(),loaded)
 checks.push('PostgreSQL批量一笔事务、一笔版本修订、幂等恢复；末项失败回滚前项及日期字段持久化')
 console.log(JSON.stringify({passed:true,checks},null,2))
}finally{if(server)await new Promise(r=>server.close(r));if(!/^tool_table_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
