import fs from 'node:fs/promises'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
const schema=`tool_followup_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),out=new URL('../test-artifacts/tool-followup-fixes/',import.meta.url)
let server
try{
 await fs.mkdir(out,{recursive:true});await db.init();const snap=await db.read(),s=snap.snapshot.data;let seq=0
 const stamp='2026-11-11T02:30:00.000Z'
 const run=(type,payload,at=stamp)=>applyToolCommand(s,{type,payload,actor:'第三轮检测员',requestId:`followup-${++seq}`},{now:at})
 run('WAREHOUSE_STANDARDIZE',{});const [wh,wh2]=s.toolManagement.warehouses
 const tool=run('TOOL_SAVE',{code:'R3-TOOL',name:'第三轮检测工具'})
 const add=(code,quantity=1,extra={})=>run('ASSET_CREATE',{toolId:tool.id,warehouseId:wh.id,code,quantity,mode:quantity===1?'NUMBERED':'BULK',receivedAt:stamp,...extra})
 const bulk=add('R3-PARTIAL',12),counter=add('R3-COUNT'),future=add('R3-RETRY'),late=add('R3-LATE')
 const l1=run('BORROW',{assetId:bulk.id,quantity:5,borrower:'甲领用人',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 const l2=run('BORROW',{assetId:bulk.id,quantity:3,borrower:'乙领用人',borrowType:'检修使用',dueAt:'2099-01-01T10:00:00+08:00'})
 run('BORROW',{assetId:late.id,quantity:1,borrower:'已超期人员',borrowType:'智能设施领用',dueAt:'2026-11-12T00:00:00+08:00'})
 // The second warehouse can be empty, so add an explicit export fixture.
 const exportAsset=run('ASSET_CREATE',{toolId:tool.id,warehouseId:wh2.id,code:'R3-EXPORT',quantity:1,mode:'NUMBERED',receivedAt:stamp})
 const countForExport=run('COUNT_CREATE',{warehouseId:wh2.id})
 const countRow=s.toolManagement.counts.find(c=>c.id===countForExport.id)
 run('COUNT_FINISH',{id:countForExport.id,lines:countRow.lines.map(l=>({assetId:l.assetId,counted:l.expected})),reason:'导出时间检测'},'2026-11-11T03:45:00.000Z')
 const inFlight=run('COUNT_CREATE',{warehouseId:wh.id})
 // This is deliberately the highest live ID, to exercise deletion/recreation.
 const replacement=add('R3-ORIGINAL')
 await db.save(snap.revision,exportDemoSnapshot(s));server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const fixture={base:`http://127.0.0.1:${server.address().port}`,out:fileURLToPath(out),stamp,tool:tool.id,warehouse:wh.id,bulk:bulk.id,loans:[l1.id,l2.id],counter:counter.id,inFlight:inFlight.id,exportCount:countForExport.id,replacement:replacement.id,retry:future.id}
 await new Promise((resolve,reject)=>{const child=spawn('python',[fileURLToPath(new URL('./tool_followup_fixes_ui.py',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Walk stopped: ${code}`)));child.stdin.end(JSON.stringify(fixture))})
 console.log(JSON.stringify({completed:true,productionWrites:false}))
}finally{if(server)await new Promise(r=>server.close(r));if(!/^tool_followup_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
