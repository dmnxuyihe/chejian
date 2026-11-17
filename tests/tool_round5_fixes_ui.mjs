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
const out=new URL('../test-artifacts/tool-rounds/round5/',import.meta.url),schema=`tool_round5_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),sources=['src/core/tool-management.js','src/shared/tool-table-controller.js','src/shared/tool-table-state.js','src/shared/tool-records.js','src/shared/tool-overview.js','src/roles/system-admin/pages/tools.js','src/core/ui.js']
const fingerprints=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await fs.readFile(new URL('../'+p,import.meta.url),'utf8'))])))
let server,before,sourceBefore
try{
 await fs.mkdir(out,{recursive:true});sourceBefore=await fingerprints();if(process.env.TOOL_FORMAL_BASE){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();before={revision:formal.revision,hash:hash(formal.snapshot.data)}}
 await db.init();const snap=await db.read(),s=snap.snapshot.data;let seq=0
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'第五轮准备员',requestId:`round5-${++seq}`},{now:'2026-11-11T02:30:00.000Z'})
 run('WAREHOUSE_STANDARDIZE',{});const [wh,wh2]=s.toolManagement.warehouses
 const thresholdTool=run('TOOL_SAVE',{code:'R5-THRESHOLD',name:'分库阈值验证扳手',lowStock:2})
 run('ASSET_CREATE',{toolId:thresholdTool.id,warehouseId:wh.id,code:'R5-THRESHOLD-BATCH',quantity:3,mode:'BULK'})
 run('TOOL_SAVE',{id:thresholdTool.id,code:'R5-THRESHOLD',name:'分库阈值验证扳手',lowStockWarehouseId:wh.id,lowStock:6})
 const other=run('TOOL_SAVE',{code:'R5-OTHER',name:'盘点与流转验证工具'})
 const add=(code,warehouseId=wh.id,quantity=1)=>run('ASSET_CREATE',{toolId:other.id,warehouseId,code,quantity,mode:quantity===1?'NUMBERED':'BULK'})
 const short=add('R5-SHORT',wh2.id,3),surplus=add('R5-SURPLUS',wh2.id,3),serviceAsset=add('R5-SERVICE'),transferAsset=add('R5-TRANSFER')
 const c=run('COUNT_CREATE',{warehouseId:wh2.id}),count=s.toolManagement.counts.find(x=>x.id===c.id)
 run('COUNT_FINISH',{id:c.id,lines:count.lines.map(l=>({assetId:l.assetId,counted:l.assetId===short.id?1:4})),reason:'负数与正数差异导出检查'})
 const service=run('SERVICE_SEND',{assetId:serviceAsset.id,quantity:1,kind:'INSPECTION',provider:'计量中心',reason:'同单并发检查'})
 const transfer=run('TRANSFER',{assetId:transferAsset.id,quantity:1,toWarehouseId:wh2.id})
 const unusedCategory=run('CATEGORY_SAVE',{code:'R5-CAT-DELETE',name:'待删除的备用分类'})
 const usedCategory=run('CATEGORY_SAVE',{code:'R5-CAT-USED',name:'已被工具引用的分类'})
 run('TOOL_SAVE',{code:'R5-REFERENCED',name:'分类引用验证品种',categoryId:usedCategory.id})
 const disposableTool=run('TOOL_SAVE',{code:'R5-DICT-DELETE',name:'待删除的空工具品种'})
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const f={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),warehouse:wh.id,thresholdTool:thresholdTool.id,count:c.id,short:short.id,surplus:surplus.id,service:service.id,transfer:transfer.id,unusedCategory:unusedCategory.id,usedCategory:usedCategory.id,disposableTool:disposableTool.id}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_round5_fixes_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Walk stopped: ${code}`)));child.stdin.end(JSON.stringify(f))})
}finally{
 if(server)await new Promise(r=>server.close(r));if(!/^tool_round5_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()
 const afterSources=await fingerprints();if(sourceBefore)assert.deepEqual(afterSources,sourceBefore)
 let after=null;if(before){const formal=await(await fetch(process.env.TOOL_FORMAL_BASE+'/api/state',{signal:AbortSignal.timeout(5000)})).json();after={revision:formal.revision,hash:hash(formal.snapshot.data)};assert.deepEqual(before,after)}
 await fs.writeFile(new URL('safety-evidence.json',out),JSON.stringify({formalBefore:before,formalAfter:after,applicationSourcesUnchanged:sourceBefore?JSON.stringify(afterSources)===JSON.stringify(sourceBefore):null,sources:afterSources},null,2))
}
