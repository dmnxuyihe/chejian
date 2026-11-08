import assert from 'node:assert/strict'
import http from 'node:http'
import {createState} from '../src/core/state.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {toolLedgerEntries,assetBalance,returnableQuantity} from '../src/shared/tool-ledger.js'
import {createDatabase} from '../server/database.js'
import {createHandler} from '../server/http.js'
import {loadConfig} from '../server/config.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const s=createState(),checks=[]
let sequence=0
const now=new Date().toISOString()
const run=(type,payload,actor='登记员')=>applyToolCommand(s,{type,payload,actor,requestId:`ledger-${++sequence}`},{now})
const reject=(fn,pattern)=>{const before=structuredClone(s);assert.throws(fn,pattern);assert.deepEqual(s,before,'失败时不得部分更新成员')}
const warehouse=run('WAREHOUSE_SAVE',{code:'LEDGER-W',name:'检修工具库'}).id
const legacy=s.tools.find(t=>Number(t.quantity)>0)
legacy.quantity=3
assert.ok(toolLedgerEntries(s).entries.some(e=>e.key===`legacy:${legacy.id}`))
const adopted=run('ADOPT_LEGACY',{toolId:legacy.id,warehouseId:warehouse,mode:'NUMBERED',code:'REG'})
assert.equal(adopted.assetIds.length,3)
assert.deepEqual(s.toolManagement.assets.map(a=>[a.code,a.quantity,a.mode]),[['REG-001',1,'NUMBERED'],['REG-002',1,'NUMBERED'],['REG-003',1,'NUMBERED']])
assert.equal(s.tools.find(t=>t.id===legacy.id).quantity,3)
assert.ok(!toolLedgerEntries(s).entries.some(e=>e.key===`legacy:${legacy.id}`))
checks.push('原库存逐件编号登记，数量保持不变，待登记项转为有编号台账')

const tool2=s.tools.find(t=>t.id!==legacy.id&&Number(t.quantity)>0)
tool2.quantity=2
reject(()=>run('ADOPT_LEGACY',{toolId:tool2.id,warehouseId:warehouse,mode:'NUMBERED',code:'REG'}),/重复/)
const assets=s.toolManagement.assets
const kit=run('KIT_SAVE',{code:'KIT-REG',name:'检修套装',lines:assets.map(a=>({assetId:a.id,quantity:1}))}).id
const borrow=()=>run('BORROW',{kitId:kit,borrower:'领用人',borrowType:'抢修',dueAt:'2099-01-01T17:00'})
const loan=borrow().id
for(const a of s.toolManagement.assets){assert.deepEqual(assetBalance(s,a).states,['借出 1件']);assert.equal(assetBalance(s,a).stock,0)}
assert.equal(toolLedgerEntries(s,{ledgerType:'KIT',borrowType:'抢修',quickFilter:'borrowed'}).rows.length,1)
reject(()=>run('KIT_RETURN',{loanId:loan,returner:'归还人',lines:[{assetId:assets[0].id,quantity:1},{assetId:assets[1].id,quantity:2}]}),/超过/)
reject(()=>run('KIT_RETURN',{loanId:loan,returner:'归还人',lines:[{assetId:assets[0].id,quantity:1},{assetId:assets[0].id,quantity:1}]}),/重复/)
run('RETURN',{loanId:loan,assetId:assets[0].id,quantity:1,returner:'代还人'})
run('KIT_RETURN',{loanId:loan,returner:'归还人'})
let l=s.toolManagement.loans.find(l=>l.id===loan)
assert.equal(l.status,'CLOSED');assert.equal(l.returns.length,3)
checks.push('部分先归还后整套结清；超量和重复成员归还整体回滚，实际状态与数量一致')

const second=borrow().id
const disposal=run('DISPOSAL_REQUEST',{assetId:assets[0].id,loanId:second,kind:'LOST',quantity:1,reason:'借用中遗失'}).id
run('KIT_RETURN',{loanId:second,returner:'归还人'})
l=s.toolManagement.loans.find(l=>l.id===second)
assert.equal(l.status,'OPEN');assert.equal(l.returns.length,2)
assert.equal(returnableQuantity(s.toolManagement,l,l.lines[0]),0)
reject(()=>run('KIT_RETURN',{loanId:second,returner:'归还人'}),/可归还/)
run('DISPOSAL_REVIEW',{id:disposal,decision:'REJECTED',opinion:'已找回'},'审核员')
run('KIT_RETURN',{loanId:second,returner:'归还人'})
assert.equal(s.toolManagement.loans.find(l=>l.id===second).status,'CLOSED')
checks.push('待审核成员不重复归还，其他成员正常入库；申请驳回后可结清剩余成员')

const schema=`tool_ledger_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
let server,closed=false
try{
 await db.init();let snap=await db.read();await db.save(snap.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const base=`http://127.0.0.1:${server.address().port}`
 let revision=(await db.read()).revision
 const post=async(type,payload,requestId)=>{
  const response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,requestId,actor:'入库员',revision})})
  const body=await response.json();if(response.ok)revision=body.revision
  return {status:response.status,body}
 }
 const loan3=await post('BORROW',{kitId:kit,borrower:'数据库借用人',dueAt:'2099-01-01T17:00'},'kit-db-borrow')
 assert.equal(loan3.status,200)
 const before=await db.read()
 const failed=await post('KIT_RETURN',{loanId:loan3.body.id,returner:'归还人',lines:[{assetId:assets[0].id,quantity:1},{assetId:assets[1].id,quantity:2}]},'kit-db-invalid')
 assert.equal(failed.status,400);assert.deepEqual(await db.read(),before)
 const payload={loanId:loan3.body.id,returner:'归还人'}
 assert.equal((await post('KIT_RETURN',payload,'kit-db-return')).status,200)
 const returned=await db.read()
 assert.equal((await post('KIT_RETURN',payload,'kit-db-return')).body.duplicate,true)
 assert.equal((await db.read()).revision,returned.revision)
 assert.equal(returned.snapshot.data.toolManagement.loans.find(l=>l.id===loan3.body.id).status,'CLOSED')
 assert.equal(returned.snapshot.data.toolManagement.loans.find(l=>l.id===loan3.body.id).returns.length,3)
 await db.close();closed=true
 const reopened=createDatabase({...loadConfig(),schema})
 try{assert.deepEqual((await reopened.read()).snapshot.data.toolManagement,returned.snapshot.data.toolManagement)}finally{await reopened.close()}
 checks.push('PostgreSQL整套归还事务、错误回滚、重复请求幂等与重连恢复通过')
 console.log(JSON.stringify({passed:true,checks},null,2))
}finally{
 if(server)await new Promise(r=>server.close(r))
 // Reopen only the test connection if it was closed for the persistence check.
 const cleanup=createDatabase({...loadConfig(),schema})
 try{if(!/^tool_ledger_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await cleanup.pool.query(`DROP SCHEMA "${schema}" CASCADE`)}finally{await cleanup.close();if(!closed)await db.close()}
}
