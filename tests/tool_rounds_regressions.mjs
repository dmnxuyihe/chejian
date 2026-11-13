import assert from 'node:assert/strict'
import {createState} from '../src/core/state.js'
import {applyToolCommand,expectedToolObjects,assertToolObjects,compactToolBatch,toolAlerts,toolDueAt} from '../src/core/tool-management.js'
import {toolOverviewData} from '../src/shared/tool-overview.js'
import {toolDateInput} from '../src/shared/tool-dates.js'
const s=createState(),checks=[];let sequence=0
const run=(type,payload,requestId=`rounds-${++sequence}`,now=new Date().toISOString())=>applyToolCommand(s,{type,payload,actor:'闭环回归员',requestId},{now})
run('WAREHOUSE_STANDARDIZE',{});const wh=s.toolManagement.warehouses[0].id
const tool=run('TOOL_SAVE',{code:'ROUNDS-TYPE',name:'闭环工具'})
const add=(code,extra={})=>run('ASSET_CREATE',{toolId:tool.id,warehouseId:wh,code,mode:'NUMBERED',quantity:1,...extra})
const ids=Array.from({length:301},(_,i)=>add(`ROUNDS-${i}`).id)
const kit=run('KIT_SAVE',{code:'ROUNDS-KIT',name:'301成员套装',lines:ids.map(assetId=>({assetId,quantity:1}))})
const guard=expectedToolObjects(s.toolManagement,'BORROW',{kitId:kit.id})
assert.equal(guard.length,1);assert.equal(guard[0].members.length,301)
const member=s.toolManagement.assets.find(a=>a.id===ids[0]),oldIdentity=member.identity
member.identity=crypto.randomUUID();assert.throws(()=>assertToolObjects(s.toolManagement,{expectedObjects:guard}),e=>e.toolTargetChanged);member.identity=oldIdentity
const loan=run('BORROW',{kitId:kit.id,borrower:'整套领用',dueAt:'2099-01-01',expectedObjects:guard})
const returnGuard=expectedToolObjects(s.toolManagement,'KIT_RETURN',{loanId:loan.id});assert.equal(returnGuard.length,1)
run('KIT_RETURN',{loanId:loan.id,returner:'整套归还',expectedObjects:returnGuard});assert.equal(s.toolManagement.loans.find(l=>l.id===loan.id).status,'CLOSED')
checks.push('301-member kit borrow/return; member replacement remains blocked')
const commands=ids.slice(0,100).map(assetId=>({type:'SERVICE_SEND',payload:{assetId,quantity:1,kind:'INSPECTION',provider:'检'.repeat(120),reason:'校'.repeat(500),expectedObjects:expectedToolObjects(s.toolManagement,'SERVICE_SEND',{assetId})}}))
const compact=compactToolBatch({commands});assert.ok(JSON.stringify(compact).length<64000)
const bad=structuredClone(compact);bad.commands[99].payload.quantity=2
const snapshot=JSON.stringify(s);assert.throws(()=>run('BATCH',bad));assert.equal(JSON.stringify(s),snapshot)
const result=run('BATCH',compact,'rounds-large-batch');assert.equal(result.results.length,100);assert.equal(run('BATCH',compact,'rounds-large-batch').duplicate,true);assert.equal(s.toolManagement.services.length,100)
checks.push('compact 100-item maximum text; final-item failure rolls back; retries remain idempotent')
for(const [type,collection] of [['CATEGORY_SAVE','categories'],['TOOL_SAVE','tools'],['DEVICE_SAVE','devices']]){
 const p={code:'AUDIT-'+collection,name:'原资料名称',...(type==='DEVICE_SAVE'?{warehouseId:wh,kind:'CABINET',enabled:true}:{})},r=run(type,p)
 run(type,{...p,id:r.id,name:'修改后资料名称'})
 const log=s.toolManagement.audit.at(-1);assert.equal(log.objects.at(-1).before.name,'原资料名称');assert.equal(log.objects.at(-1).after.name,'修改后资料名称')
 run(type.replace('_SAVE','_DELETE'),{id:r.id});assert.equal(s.toolManagement.audit.at(-1).objects[0].before.code,p.code);assert.equal(s.toolManagement.audit.at(-1).objects[0].after,null)
}
checks.push('category, dictionary and device create/edit/delete retain historical identity')
run('TOOL_SAVE',{id:tool.id,code:'ROUNDS-TYPE',name:'闭环工具',lowStock:2});run('TOOL_SAVE',{id:tool.id,code:'ROUNDS-TYPE',name:'闭环工具',lowStockWarehouseId:wh,lowStock:6});run('TOOL_SAVE',{id:tool.id,code:'ROUNDS-TYPE',name:'仅更名',lowStockWarehouseId:s.toolManagement.warehouses[1].id});const t=s.tools.find(t=>t.id===tool.id);assert.equal(t.lowStock,2);assert.equal(t.warehouseLowStock[wh],6);assert.equal(t.warehouseLowStock[s.toolManagement.warehouses[1].id],undefined)
checks.push('blank unconfigured warehouse threshold does not become an accidental zero')
const dated=add('ROUNDS-EXPIRY',{inspectionCycleMonths:1,lastInspectionAt:'2026-10-13T10:00:00+08:00'}),asset=s.toolManagement.assets.find(a=>a.id===dated.id),due=Date.parse(toolDueAt(asset))
for(const offset of [-31*86400000,-30*86400000,-20*86400000,-7*86400000,-3600000,0,3600000,25*3600000]){
 const at=new Date(due+offset),row=toolOverviewData(s,at).inspection.find(r=>r.a.id===asset.id),alert=toolAlerts(s,at).find(a=>a.assetId===asset.id)
 assert.equal(!!row,offset>=-30*86400000);assert.equal(!!alert,!!row)
 if(row){assert.equal(row.expired,offset>=0);assert.ok(alert.message.includes(toolDateInput(row.due)));if(offset<0)assert.ok(alert.message.includes('30天内到期'))}
}
checks.push('expiry -31/-30/-20/-7 days and -1/0/+1/+25 hours use matching state and date')
console.log(JSON.stringify({passed:true,checks},null,2))
