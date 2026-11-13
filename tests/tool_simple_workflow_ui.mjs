import fs from 'node:fs/promises'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
const schema=`tool_simple_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),out=new URL('../test-artifacts/tool-simple/',import.meta.url)
let server,before
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
try{
 await fs.mkdir(out,{recursive:true});if(process.env.TOOL_FORMAL_BASE){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state')).json();before={revision:formal.revision,hash:hash(formal.snapshot.data)}}
 await db.init();const snap=await db.read(),s=snap.snapshot.data;let seq=0
 const run=(type,payload,now=new Date().toISOString())=>applyToolCommand(s,{type,payload,actor:'精简流程准备员',requestId:`simple-${++seq}`},{now})
 run('WAREHOUSE_STANDARDIZE',{});const [wh,wh2]=s.toolManagement.warehouses
 const tool=run('TOOL_SAVE',{code:'SIMPLE-TYPE',name:'流程验证扳手',lowStock:1})
 const add=(code,n=1,extra={})=>run('ASSET_CREATE',{toolId:tool.id,warehouseId:wh.id,code,quantity:n,mode:n===1?'NUMBERED':'BULK',receivedAt:'2026-10-01',...extra})
 const a=add('SIMPLE-A'),b=add('SIMPLE-B',5),c=add('SIMPLE-C'),d=add('SIMPLE-D'),expired=add('SIMPLE-EXPIRED',1,{inspectionCycleMonths:1,lastInspectionAt:'2026-01-01'})
 const transfer=run('TRANSFER',{assetId:c.id,quantity:1,toWarehouseId:wh2.id}),service=run('SERVICE_SEND',{assetId:d.id,quantity:1,kind:'INSPECTION',provider:'验证计量中心',reason:'待登记结果'})
 const kitA=add('SIMPLE-KA'),kitB=add('SIMPLE-KB'),kit=run('KIT_SAVE',{code:'SIMPLE-KIT',name:'流程验证套装',lines:[{assetId:kitA.id,quantity:1},{assetId:kitB.id,quantity:1}]})
 const overdue=run('BORROW',{kitId:kit.id,borrower:'超期领用人',dueAt:'2026-02-01'},'2026-01-01T01:00:00+08:00')
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const fixture={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),a:a.id,b:b.id,c:c.id,d:d.id,expired:expired.id,transfer:transfer.id,service:service.id,overdue:overdue.id,kitA:kitA.id,kitB:kitB.id,warehouse2:wh2.id}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_simple_workflow_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Simple flow stopped: ${code}`)));child.stdin.end(JSON.stringify(fixture))})
}finally{
 if(server)await new Promise(r=>server.close(r));if(!/^tool_simple_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()
 if(before){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state')).json(),after={revision:formal.revision,hash:hash(formal.snapshot.data)};assert.deepEqual(before,after);await fs.writeFile(new URL('formal-data-check.json',out),JSON.stringify({before,after,unchanged:true},null,2))}
}
