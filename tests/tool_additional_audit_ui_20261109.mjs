// Discovery audit: success means the suspected defects were reproduced.
import assert from 'node:assert/strict'
import http from 'node:http'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const out=new URL('../../outputs/工具管理追加审查_20261109/',import.meta.url)
await fs.mkdir(out,{recursive:true})
const schema=`tools_discovery_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),findings=[],errors=[]
let server,browser,seq=0
const liveBefore=await(await fetch('http://127.0.0.1:5193/api/state')).json()
try{
 await db.init();const snapshot=await db.read(),s=snapshot.snapshot.data
 const run=(type,payload={},actor='合成审查员')=>applyToolCommand(s,{type,payload,actor,requestId:`ui-discovery-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const w=s.toolManagement.warehouses[0].id
 const t=run('TOOL_SAVE',{code:'ADDITIONAL-UI',name:'合成审查扳手'}).id
 const add=(code,quantity=10)=>run('ASSET_CREATE',{toolId:t,warehouseId:w,code,mode:'BULK',quantity,tag:code}).id
 const a=add('AUDIT-REPAIR'),b=add('AUDIT-COUNTS'),c=add('AUDIT-FAIL')
 const device=run('DEVICE_SAVE',{code:'AUDIT-DEVICE',name:'合成审查工具柜',warehouseId:w,kind:'CABINET'}).id
 const error=run('DEVICE_EVENT',{deviceId:device,eventId:'unknown',eventType:'CHECKOUT',tag:'DOES-NOT-EXIST',employeeId:s.employees[0].id,dueAt:'2099-01-01'})
 run('EVENT_RESOLVE',{id:error.id,resolution:'已人工检查并处理'})
 await db.save(snapshot.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:900}})
 page.on('pageerror',e=>errors.push(e.message))
 const modal=()=>page.locator('.modal'),action=k=>page.locator(`[data-tool-table-action="${k}"]`)
 const close=()=>modal().locator('[data-modal-cancel]').click()
 await page.goto(base+'/#/functions/assets/tool-register');await action('tool-data').waitFor()
 await page.locator(`[data-tool-check="asset:${a}"]`).check();await action('repair').click()
 for(const [key,value] of Object.entries({provider:'合成维修单位',reason:'检查维修回执',actor:'合成送修员'}))await modal().locator(`[data-f="${key}"]`).fill(value)
 await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'})
 const service=(await db.read()).snapshot.data.toolManagement.services.at(-1);assert.equal(service.kind,'REPAIR')
 await action('receipt').click();const sentKind=await modal().locator('[data-record-kind]').inputValue(),sentRows=await modal().locator('[data-record-id]').count()
 assert.equal(sentKind,'inspection');assert.equal(sentRows,0)
 await page.screenshot({path:fileURLToPath(new URL('07-维修回执打开送检.png',out))});await close()
 await action('service-finish').click();await modal().locator('[data-f="result"]').selectOption('PASS');await modal().locator('[data-f="certificate"]').fill('AUDIT-REPAIR-PASS');await modal().locator('[data-f="actor"]').fill('合成校验员')
 await modal().locator('[data-modal-confirm]').click();await modal().waitFor({state:'detached'});await action('receipt').click()
 const finishedKind=await modal().locator('[data-record-kind]').inputValue(),finishedRows=await modal().locator('[data-record-id]').count();assert.equal(finishedKind,'inspection');assert.equal(finishedRows,0);await close()
 findings.push({id:'N07',priority:'P2',title:'维修办理成功后，“查看本次记录”进入送检记录，显示空清单',method:'isolated PostgreSQL + browser',observed:{actualBusiness:'REPAIR',sendReceiptKind:sentKind,sendReceiptRows:sentRows,finishReceiptKind:finishedKind,finishReceiptRows:finishedRows},impact:'数据已经保存，但回执打开错类型，让操作员误以为办理未成功。',evidence:'07-维修回执打开送检.png',suggestion:'从实际命令/单据确定回执类型，批量时读取每条子指令，不读取不存在的顶层kind。'})
 await action('records').click();await modal().locator('[data-record-kind]').selectOption('events')
 await modal().locator('[data-record-scope]').selectOption('todo');const pending=await modal().locator(`[data-record-id="${error.id}"]`).count()
 assert.equal(pending,1)
 await page.screenshot({path:fileURLToPath(new URL('08-已处置仍在待办.png',out))})
 await modal().locator('[data-record-scope]').selectOption('done');const done=await modal().locator(`[data-record-id="${error.id}"]`).count();assert.equal(done,0);await close()
 findings.push({id:'N08',priority:'P2',title:'已经处置的设备异常仍在待办理，已办结反而找不到',method:'isolated PostgreSQL + browser',observed:{resolvedEvent:error.id,visibleInTodo:pending,visibleInDone:done,resolution:'已人工检查并处理'},impact:'待办无法清空，管理人员可能反复检查已处理问题。',evidence:'08-已处置仍在待办.png',suggestion:'待办判断结合resolvedAt/处置状态；错误结果与是否已处置分别表达。'})
 await browser.close();browser=null
 const post=async(type,payload,actor='合成审查员')=>{
  const state=await db.read(),response=await fetch(base+'/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,actor,requestId:`pg-discovery-${++seq}`,revision:state.revision})}),data=await response.json()
  assert.equal(response.status,200,JSON.stringify(data));return data
 }
 const count=async()=>{const {id}=await post('COUNT_CREATE',{warehouseId:w}),row=(await db.read()).snapshot.data.toolManagement.counts.find(r=>r.id===id);await post('COUNT_FINISH',{id,reason:'同基准重复盘点审查',lines:row.lines.map(l=>({assetId:l.assetId,counted:l.assetId===b?9:l.expected}))});return id}
 const counts=[await count(),await count()]
 for(const countId of counts){const {id}=await post('DISPOSAL_REQUEST',{assetId:b,quantity:1,kind:'LOST',countId,reason:'同一实物差异'});await post('DISPOSAL_REVIEW',{id,decision:'APPROVED',opinion:'合成独立审核'},'合成审核员')}
 let persisted=(await db.read()).snapshot.data.toolManagement;assert.equal(persisted.assets.find(a=>a.id===b).quantity,8)
 const repair=await post('SERVICE_SEND',{assetId:c,quantity:1,kind:'REPAIR',provider:'合成维修方',reason:'部分维修'})
 const fail=await post('SERVICE_FINISH',{id:repair.id,result:'FAIL',certificate:'其中1件不合格'})
 await post('DISPOSAL_REVIEW',{id:fail.disposalId,decision:'REJECTED',opinion:'需补充资料'},'合成审核员')
 persisted=(await db.read()).snapshot.data.toolManagement;assert.equal(persisted.assets.find(a=>a.id===c).status,'DISABLED')
 const databaseEvidence={N02:{countIds:counts,finalQuantity:8,physicalQuantity:9},N03:{total:10,failed:1,finalStatus:'DISABLED'}}
 assert.equal(errors.length,0)
 const liveAfter=await(await fetch('http://127.0.0.1:5193/api/state')).json();assert.equal(liveAfter.revision,liveBefore.revision)
 const result={date:'2026-11-09',purpose:'New defect discovery, not passing acceptance',productionWrites:false,productionRevisionBefore:liveBefore.revision,productionRevisionAfter:liveAfter.revision,findings,databaseEvidence,browserErrors:errors}
 await fs.writeFile(new URL('浏览器与数据库新增问题.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}finally{
 await browser?.close();if(server)await new Promise(r=>server.close(r))
 if(!/^tools_discovery_\d+_\d+$/.test(schema))throw Error('Unexpected schema')
 await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
