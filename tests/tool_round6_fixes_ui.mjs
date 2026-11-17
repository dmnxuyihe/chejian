import fs from 'node:fs/promises'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
const out=new URL('../test-artifacts/tool-rounds/round6/',import.meta.url),schema=`tool_round6_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),sources=['src/core/tool-management.js','src/shared/tool-table-controller.js','src/shared/tool-overview.js','src/shared/tool-records.js','src/shared/resource-lists.js','src/roles/system-admin/pages/tools.js']
const fingerprints=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await fs.readFile(new URL('../'+p,import.meta.url),'utf8'))])))
let server,before,sourceBefore
try{
 await fs.mkdir(out,{recursive:true});sourceBefore=await fingerprints();if(process.env.TOOL_FORMAL_BASE){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();before={revision:formal.revision,hash:hash(formal.snapshot.data)}}
 await db.init();const snap=await db.read(),s=snap.snapshot.data;let seq=0
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'第六轮准备员',requestId:`round6-${++seq}`})
 run('WAREHOUSE_STANDARDIZE',{});const wh=s.toolManagement.warehouses[0]
 const bindingTool=run('TOOL_SAVE',{code:'R6-BIND',name:'工序绑定维护验证工具'})
 const inspectionTool=run('TOOL_SAVE',{code:'R6-INSPECT',name:'检定到期验证工具'})
 const lastForDue=hours=>{const d=new Date(Date.now()+hours*3600000);d.setMonth(d.getMonth()-1);return d.toISOString()}
 const add=(code,lastInspectionAt)=>run('ASSET_CREATE',{toolId:inspectionTool.id,warehouseId:wh.id,code,quantity:1,mode:'NUMBERED',receivedAt:new Date(Date.now()-60*86400000).toISOString(),inspectionCycleMonths:lastInspectionAt?1:0,lastInspectionAt})
 const expired=add('R6-EXP',lastForDue(-3)),prefix=add('R6-EXP-EXTRA'),future20=add('R6-IN20',lastForDue(20*24)),tomorrow=add('R6-TOMORROW',lastForDue(24))
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const f={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),bindingTool:bindingTool.id,task:s.tasks[0].id,expired:expired.id,prefix:prefix.id,future20:future20.id,tomorrow:tomorrow.id}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_round6_fixes_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Walk stopped: ${code}`)));child.stdin.end(JSON.stringify(f))})
}finally{
 if(server)await new Promise(r=>server.close(r));if(!/^tool_round6_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()
 const afterSources=await fingerprints();if(sourceBefore)assert.deepEqual(afterSources,sourceBefore)
 let after=null;if(before){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();after={revision:formal.revision,hash:hash(formal.snapshot.data)};assert.deepEqual(before,after)}
 await fs.writeFile(new URL('safety-evidence.json',out),JSON.stringify({formalBefore:before,formalAfter:after,applicationSourcesUnchanged:sourceBefore?JSON.stringify(afterSources)===JSON.stringify(sourceBefore):null,sources:afterSources},null,2))
}
