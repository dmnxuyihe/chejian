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

const out=new URL('../test-artifacts/tool-rounds/round4/',import.meta.url),schema=`tool_round4_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex')
const sources=['src/core/tool-management.js','src/shared/tool-table-controller.js','src/shared/tool-table-state.js','src/shared/tool-workspace.js','src/shared/tool-overview.js','src/roles/system-admin/pages/tools.js','src/core/ui.js']
const fingerprints=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await fs.readFile(new URL('../'+p,import.meta.url),'utf8'))])))
let server,before,sourceBefore
try{
 await fs.mkdir(out,{recursive:true});sourceBefore=await fingerprints()
 if(process.env.TOOL_FORMAL_BASE){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();before={revision:formal.revision,hash:hash(formal.snapshot.data)}}
 await db.init();const snap=await db.read(),s=snap.snapshot.data;let seq=0
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'第四轮准备员',requestId:`round4-${++seq}`},{now:'2026-11-11T02:30:00.000Z'})
 run('WAREHOUSE_STANDARDIZE',{});const [wh,wh2]=s.toolManagement.warehouses
 const tool=run('TOOL_SAVE',{code:'R4-TYPE',name:'第四轮检测工具'})
 const add=(code,warehouseId=wh.id)=>run('ASSET_CREATE',{toolId:tool.id,warehouseId,code,mode:'NUMBERED',quantity:1,receivedAt:'2026-11-11T02:30:00.000Z'})
 const a=add('R4-A'),b=add('R4-B'),unused=add('R4-UNUSED'),good=add('R4-GOOD'),bad=add('R4-DELETE'),counter=add('R4-COUNT',wh2.id)
 const kit=run('KIT_SAVE',{code:'R4-KIT',name:'日常工具包',lines:[{assetId:a.id,quantity:1},{assetId:b.id,quantity:1}]})
 const serviceIds=[]
 for(let i=0;i<100;i++)serviceIds.push(add(`R4-SERVICE-${String(i).padStart(3,'0')}`).id)
 const largeIds=[...serviceIds]
 for(let i=0;i<201;i++)largeIds.push(add(`R4-LARGE-${String(i).padStart(3,'0')}`).id)
 const largeKit=run('KIT_SAVE',{code:'R4-LARGE-KIT',name:'301件规模边界工具包',lines:largeIds.map(assetId=>({assetId,quantity:1}))})
 const count1=run('COUNT_CREATE',{warehouseId:wh2.id}),count2=run('COUNT_CREATE',{warehouseId:wh2.id})
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const fixture={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),tool:tool.id,a:a.id,b:b.id,unused:unused.id,good:good.id,bad:bad.id,counter:counter.id,kit:kit.id,largeKit:largeKit.id,count1:count1.id,count2:count2.id,serviceIds}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_round4_fixes_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Walk stopped: ${code}`)));child.stdin.end(JSON.stringify(fixture))})
}finally{
 if(server)await new Promise(r=>server.close(r));if(!/^tool_round4_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()
 const sourceAfter=await fingerprints();if(sourceBefore)assert.deepEqual(sourceAfter,sourceBefore)
 let after=null
 if(before){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();after={revision:formal.revision,hash:hash(formal.snapshot.data)};assert.deepEqual(after,before)}
 await fs.writeFile(new URL('safety-evidence.json',out),JSON.stringify({formalBefore:before,formalAfter:after,applicationSourcesUnchanged:sourceBefore?JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter):null,sources:sourceAfter},null,2))
}
