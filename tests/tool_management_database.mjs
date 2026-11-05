import assert from 'node:assert/strict'
import http from 'node:http'
import {randomBytes} from 'node:crypto'
import {createDatabase} from '../server/database.js'
import {createHandler} from '../server/http.js'
import {loadConfig} from '../server/config.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
const schema=`tool_test_${Date.now()}_${process.pid}`
let db=createDatabase({...loadConfig(),schema}),server,revision,seq=0
const priorToken=process.env.TOOL_DEVICE_TOKEN
try{
 await db.init();revision=(await db.read()).revision
 server=http.createServer(createHandler(db));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const post=async(path,data,headers={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:r.status,data:await r.json()}}
 const run=async(type,payload,actor='经办甲')=>{const result=await post('/api/tools/commands',{requestId:`db-${++seq}`,revision,type,payload,actor});assert.equal(result.status,200,JSON.stringify(result.data));revision=result.data.revision;return result.data}
 const w=await run('WAREHOUSE_SAVE',{code:'W',name:'测试工具库'})
 const t=await run('TOOL_SAVE',{code:'T',name:'测试扳手',lowStock:1})
 const a=await run('ASSET_CREATE',{toolId:t.id,warehouseId:w.id,code:'A',mode:'NUMBERED',quantity:1,tag:'TAG-1'})
 const before=await db.read()
 const request={requestId:'repeat',revision,type:'BORROW',payload:{assetId:a.id,quantity:1,borrower:'借用乙',dueAt:'2099-01-01T12:00:00'},actor:'经办甲'}
 const loan=await post('/api/tools/commands',request);assert.equal(loan.status,200);revision=loan.data.revision
 const retry=await post('/api/tools/commands',request);assert.equal(retry.status,200);assert.equal(retry.data.duplicate,true);assert.equal(retry.data.revision,revision)
 const changed=await post('/api/tools/commands',{...request,payload:{...request.payload,quantity:2}});assert.equal(changed.status,400)
 const invalid=await post('/api/tools/commands',{...request,requestId:'new-but-stale'});assert.equal(invalid.status,409)
 const after=await db.read();assert.equal(after.snapshot.data.tools.find(x=>x.id===t.id).quantity,0);assert.equal(after.snapshot.data.toolManagement.loans.length,1)
 assert.equal(before.snapshot.data.toolManagement.loans.length,0)
 const origin=await post('/api/tools/commands',{...request,requestId:'cross-origin',revision},{Origin:'https://untrusted.example'});assert.equal(origin.status,403)
 const alerts=await fetch(base+'/api/tools/alerts');assert.equal(alerts.status,200);assert.ok((await alerts.json()).alerts.some(a=>a.type==='LOW_STOCK'))
 const returned=await run('RETURN',{loanId:loan.data.id,assetId:a.id,quantity:1,returner:'归还丙'});assert.equal(returned.ok,true)
 const parallel=await Promise.all([1,2].map(i=>post('/api/tools/commands',{requestId:`race-${i}`,revision,type:'BORROW',payload:request.payload,actor:'并发经办'})))
 assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);revision=Math.max(...parallel.map(r=>r.data.revision||0))
 const active=(await db.read()).snapshot.data.toolManagement.loans.find(l=>l.status==='OPEN');await run('RETURN',{loanId:active.id,assetId:a.id,quantity:1,returner:'借用乙'})
 const device=await run('DEVICE_SAVE',{code:'CAB',name:'测试柜',kind:'CABINET',warehouseId:w.id})
 const event={requestId:'hardware-1',actor:'设备网关',payload:{deviceId:device.id,eventId:'hw-1',eventType:'HEARTBEAT'}}
 delete process.env.TOOL_DEVICE_TOKEN
 assert.equal((await post('/api/tools/device-events',event)).status,503)
 process.env.TOOL_DEVICE_TOKEN=randomBytes(24).toString('hex')
 assert.equal((await post('/api/tools/device-events',event,{'X-Tool-Device-Token':'wrong'})).status,401)
 const real=await post('/api/tools/device-events',event,{'X-Tool-Device-Token':process.env.TOOL_DEVICE_TOKEN});assert.equal(real.status,200)
 const repeatEvent=await post('/api/tools/device-events',event,{'X-Tool-Device-Token':process.env.TOOL_DEVICE_TOKEN});assert.equal(repeatEvent.data.duplicate,true)
 let current=await db.read();assert.ok(current.snapshot.data.toolManagement.devices[0].lastSeenAt)
 const rejected=await post('/api/tools/commands',{requestId:'negative',revision:current.revision,actor:'甲',type:'BORROW',payload:{...request.payload,quantity:-1}});assert.equal(rejected.status,400)
 assert.deepEqual((await db.read()).snapshot.data,current.snapshot.data,'failed business commands do not change database')
 const corrupt=structuredClone(current.snapshot);corrupt.data.toolManagement.loans[0].lines[0].returned=100
 await assert.rejects(()=>db.save(current.revision,corrupt),/超过/)
 await db.close();db=createDatabase({...loadConfig(),schema});await db.init()
 const reopened=await db.read();assert.deepEqual(reopened.snapshot.data.toolManagement,current.snapshot.data.toolManagement)
 assert.equal(exportDemoSnapshot(reopened.snapshot.data).data.toolManagement.assets.length,1)
 const raw=await db.pool.query(`SELECT payload->'appState'->'toolManagement' AS tools FROM "${schema}".application_state WHERE singleton`)
 assert.equal(raw.rows[0].tools.assets.length,1,'tool module is persisted in PostgreSQL, not local storage')
 console.log(JSON.stringify({passed:true,checks:['PostgreSQL roundtrip and restart','HTTP commands and low-stock alerts','borrow/return quantity updates shared tool table','idempotent retries and payload mismatch','optimistic concurrent-write guard','cross-origin write rejection','device token required','real heartbeat provenance','invalid command rollback','invalid restore rejection','existing JSONB state persistence']},null,2))
}finally{
 if(priorToken===undefined)delete process.env.TOOL_DEVICE_TOKEN;else process.env.TOOL_DEVICE_TOKEN=priorToken
 if(server)await new Promise(resolve=>server.close(resolve))
 if(!/^tool_test_\d+_\d+$/.test(schema))throw Error('Unexpected test schema')
 await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
