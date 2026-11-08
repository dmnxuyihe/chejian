import assert from 'node:assert/strict'
import {createState} from '../src/core/state.js'
import {applyToolCommand,assetStock,toolAvailableQuantity,toolAlerts,validateToolManagement,taskToolCheck} from '../src/core/tool-management.js'
import {exportDemoSnapshot,parseDemoSnapshot} from '../src/core/demo-persistence.js'
import {pc1SourceSignature} from '../src/core/pc1-simulation.js'
import {updateResource,deleteResource} from '../src/core/actions.js'
import {toolsPage} from '../src/roles/system-admin/pages/tools.js'
const s=createState(),now='2026-11-05T08:00:00.000Z'
let sequence=0
const cmd=(type,payload={},actor='经办甲',extra={})=>applyToolCommand(s,{requestId:`unit-${++sequence}`,type,payload,actor},{now,...extra})
const rejected=(fn,pattern)=>{const before=structuredClone(s);assert.throws(fn,pattern);assert.deepEqual(s,before,'failure is atomic')}
const asset=id=>s.toolManagement.assets.find(a=>a.id===id)
const warehouse1=cmd('WAREHOUSE_SAVE',{code:'A',name:'构架工具库'}).id
const warehouse2=cmd('WAREHOUSE_SAVE',{code:'B',name:'轮驱工具库'}).id
const category=cmd('CATEGORY_SAVE',{code:'CL',name:'计量工具'}).id
rejected(()=>cmd('WAREHOUSE_SAVE',{code:'A',name:'重复'}),/重复/)
const original=s.tools[0].quantity
const legacy=cmd('ADOPT_LEGACY',{toolId:s.tools[0].id,warehouseId:warehouse1,code:'OLD-1'}).id
assert.equal(asset(legacy).quantity,original);assert.equal(s.tools[0].quantity,original)
rejected(()=>cmd('ADOPT_LEGACY',{toolId:s.tools[0].id,warehouseId:warehouse1,code:'OLD-2'}),/接管/)
assert.equal(updateResource(s,'tools',s.tools[0].id,{...s.tools[0],quantity:original+1}).ok,false)
assert.equal(deleteResource(s,'tools',s.tools[0].id).ok,false)
const tid=cmd('TOOL_SAVE',{code:'TQ',name:'扭力扳手',specification:'20–200Nm',categoryId:category,lowStock:1}).id
const one=cmd('ASSET_CREATE',{toolId:tid,warehouseId:warehouse1,code:'TQ-001',mode:'NUMBERED',quantity:1,tag:'RFID-1',inspectionCycleMonths:12,lastInspectionAt:'2026-01-01'}).id
const two=cmd('ASSET_CREATE',{toolId:tid,warehouseId:warehouse1,code:'TQ-002',mode:'NUMBERED',quantity:1,tag:'RFID-2',inspectionCycleMonths:12,lastInspectionAt:'2026-01-01'}).id
rejected(()=>cmd('ASSET_CREATE',{toolId:tid,warehouseId:warehouse1,code:'TQ-003',mode:'NUMBERED',quantity:2}),/单件/)
rejected(()=>cmd('ASSET_CREATE',{toolId:tid,warehouseId:warehouse1,code:'TQ-003',mode:'NUMBERED',quantity:1,tag:'RFID-1'}),/重复/)
assert.equal(toolAvailableQuantity(s,tid,now),2)
const signature=pc1SourceSignature(s)
const kit=cmd('KIT_SAVE',{code:'KIT-A',name:'扳手套装',lines:[{assetId:one,quantity:1},{assetId:two,quantity:1}]}).id
const loan=cmd('BORROW',{kitId:kit,borrower:'领用乙',dueAt:'2026-11-06T12:00:00'}).id
assert.equal(toolAvailableQuantity(s,tid,now),0)
rejected(()=>cmd('BORROW',{assetId:one,quantity:1,borrower:'重复借',dueAt:'2026-11-06T12:00:00'}),/不足/)
rejected(()=>cmd('KIT_SAVE',{id:kit,code:'KIT-A',name:'改套装',lines:[{assetId:one,quantity:1}]}),/借出/)
rejected(()=>cmd('RETURN',{loanId:loan,assetId:one,quantity:2,returner:'代还丙'}),/超过/)
cmd('RETURN',{loanId:loan,assetId:one,quantity:1,returner:'代还丙'})
assert.equal(s.toolManagement.loans[0].status,'OPEN')
cmd('RETURN',{loanId:loan,assetId:two,quantity:1,returner:'领用乙'})
assert.equal(s.toolManagement.loans[0].status,'CLOSED')
assert.equal(s.toolManagement.loans[0].returns[0].returner,'代还丙')
assert.equal(toolAvailableQuantity(s,tid,now),2)
// Release kit membership before a member moves warehouses.
cmd('KIT_SAVE',{id:kit,code:'KIT-A',name:'单扳手套装',lines:[{assetId:two,quantity:1}]})
const transfer=cmd('TRANSFER',{assetId:one,toWarehouseId:warehouse2,quantity:1}).id
assert.equal(assetStock(s.toolManagement,asset(one)),0)
cmd('TRANSFER_FINISH',{id:transfer,decision:'RECEIVED'},'调入人')
assert.equal(asset(one).warehouseId,warehouse2);assert.equal(assetStock(s.toolManagement,asset(one)),1)
rejected(()=>cmd('TRANSFER_FINISH',{id:transfer,decision:'RECEIVED'}),/处理/)
const transfer2=cmd('TRANSFER',{assetId:one,toWarehouseId:warehouse1,quantity:1}).id
cmd('TRANSFER_FINISH',{id:transfer2,decision:'CANCELLED'});assert.equal(asset(one).warehouseId,warehouse2)
const inspection=cmd('SERVICE_SEND',{assetId:one,quantity:1,kind:'INSPECTION',provider:'计量中心',reason:'周期检定'}).id
assert.equal(toolAvailableQuantity(s,tid,now),1)
cmd('SERVICE_FINISH',{id:inspection,result:'PASS',certificate:'CERT-1'},'检定办理人')
assert.equal(asset(one).lastInspectionAt,now)
const repair=cmd('SERVICE_SEND',{assetId:one,quantity:1,kind:'REPAIR',provider:'维修厂',reason:'损坏维修'}).id
const failed=cmd('SERVICE_FINISH',{id:repair,result:'FAIL',certificate:'无法修复'})
assert.ok(failed.disposalId)
rejected(()=>cmd('DISPOSAL_REVIEW',{id:failed.disposalId,decision:'APPROVED',opinion:'同意'}),/不能相同/)
cmd('DISPOSAL_REVIEW',{id:failed.disposalId,decision:'APPROVED',opinion:'审核同意报废'},'审核丁')
assert.equal(asset(one).status,'SCRAPPED');assert.equal(asset(one).quantity,0)
const disposal=cmd('DISPOSAL_REQUEST',{assetId:two,quantity:1,kind:'LOST',reason:'暂未找到'}).id
cmd('DISPOSAL_REVIEW',{id:disposal,decision:'REJECTED',opinion:'已找回'},'审核丁');assert.equal(assetStock(s.toolManagement,asset(two)),1)
assert.notEqual(pc1SourceSignature(s),signature)
// Quantity tools support partial return, partial service and split transfer.
const bulkTool=cmd('TOOL_SAVE',{code:'BULK',name:'普通扳手',lowStock:3}).id
const bulk=cmd('ASSET_CREATE',{toolId:bulkTool,warehouseId:warehouse1,code:'B-001',mode:'BULK',quantity:10}).id
const l2=cmd('BORROW',{assetId:bulk,quantity:3,borrower:'领用乙',dueAt:'2026-11-06T12:00:00'}).id
cmd('RETURN',{loanId:l2,assetId:bulk,quantity:1,returner:'领用乙'})
assert.equal(assetStock(s.toolManagement,asset(bulk)),8)
const check=cmd('COUNT_CREATE',{warehouseId:warehouse1}).id
cmd('RETURN',{loanId:l2,assetId:bulk,quantity:2,returner:'领用乙'})
const lines=s.toolManagement.counts.find(c=>c.id===check).lines.map(l=>({assetId:l.assetId,counted:l.expected}))
rejected(()=>cmd('COUNT_FINISH',{id:check,reason:'无差异',lines}),/库存已变化/)
cmd('COUNT_CANCEL',{id:check})
const count=cmd('COUNT_CREATE',{warehouseId:warehouse1}).id
const countRow=s.toolManagement.counts.find(c=>c.id===count)
const firstLine=countRow.lines[0]
cmd('COUNT_PROGRESS',{id:count,lines:[{assetId:firstLine.assetId,counted:firstLine.expected}]})
assert.equal(s.toolManagement.counts.find(c=>c.id===count).lines.find(l=>l.assetId===firstLine.assetId).counted,firstLine.expected)
const actual=s.toolManagement.counts.find(c=>c.id===count).lines.map(l=>({assetId:l.assetId,counted:l.expected-(l.assetId===bulk?1:0)}))
cmd('COUNT_FINISH',{id:count,reason:'实物少1件，确认盘亏',lines:actual})
assert.equal(asset(bulk).quantity,10)
const countLoss=cmd('DISPOSAL_REQUEST',{assetId:bulk,quantity:1,kind:'LOST',reason:'盘亏经核实',countId:count}).id
assert.equal(asset(bulk).quantity,10)
cmd('DISPOSAL_REVIEW',{id:countLoss,decision:'APPROVED',opinion:'独立复核盘点差异'},'盘点审核员')
assert.equal(asset(bulk).quantity,9)
const partialService=cmd('SERVICE_SEND',{assetId:bulk,quantity:2,kind:'INSPECTION',provider:'检定中心',reason:'部分送检'}).id
cmd('SERVICE_FINISH',{id:partialService,result:'PASS',certificate:'B-CERT'})
assert.equal(s.toolManagement.assets.filter(a=>a.toolId===bulkTool).reduce((n,a)=>n+a.quantity,0),9)
const partialMove=cmd('TRANSFER',{assetId:bulk,quantity:2,toWarehouseId:warehouse2}).id
cmd('TRANSFER_FINISH',{id:partialMove,decision:'RECEIVED'})
assert.equal(s.toolManagement.assets.filter(a=>a.toolId===bulkTool).reduce((n,a)=>n+a.quantity,0),9)
const expired=cmd('ASSET_CREATE',{toolId:tid,warehouseId:warehouse1,code:'EXPIRED',mode:'NUMBERED',quantity:1,inspectionCycleMonths:1,lastInspectionAt:'2026-01-01'}).id
rejected(()=>cmd('BORROW',{assetId:expired,quantity:1,borrower:'甲',dueAt:'2026-11-06T12:00:00'}),/检定/)
assert.equal(toolAvailableQuantity(s,tid,now),1)
assert.ok(toolAlerts(s,now).some(a=>a.type==='INSPECTION_DUE'))
// Facility events share business transactions, reject wrong labels and never fake online status.
const device=cmd('DEVICE_SAVE',{code:'CAB-1',name:'一号工具柜',kind:'CABINET',warehouseId:warehouse1}).id
cmd('DEVICE_EVENT',{deviceId:device,eventId:'sim-heartbeat',eventType:'HEARTBEAT'})
assert.equal(s.toolManagement.devices[0].lastSeenAt,undefined)
cmd('DEVICE_EVENT',{deviceId:device,eventId:'real-heartbeat',eventType:'HEARTBEAT'},'设备',{hardware:true})
assert.equal(s.toolManagement.devices[0].lastSeenAt,now)
const person=s.employees.find(e=>e.status==='ACTIVE')
const checkout=cmd('DEVICE_EVENT',{deviceId:device,eventId:'borrow-1',eventType:'CHECKOUT',tag:'RFID-2',employeeId:person.id,dueAt:'2026-11-06T12:00:00'})
assert.equal(checkout.eventStatus,'ACCEPTED');assert.equal(assetStock(s.toolManagement,asset(two)),0)
cmd('DEVICE_EVENT',{deviceId:device,eventId:'borrow-1',eventType:'CHECKOUT',tag:'RFID-2',employeeId:person.id,dueAt:'2026-11-06T12:00:00'})
assert.equal(s.toolManagement.loans.filter(l=>l.lines.some(r=>r.assetId===two)&&l.status==='OPEN').length,1)
const bad=cmd('DEVICE_EVENT',{deviceId:device,eventId:'bad',eventType:'CHECKOUT',tag:'UNKNOWN',employeeId:person.id})
assert.equal(bad.eventStatus,'ERROR')
assert.ok(toolAlerts(s,now).some(a=>a.type==='DEVICE_ERROR'))
cmd('EVENT_RESOLVE',{id:bad.id,resolution:'检查标签，未执行库存操作'})
assert.ok(!toolAlerts(s,now).some(a=>a.eventId===bad.id))
const returned=cmd('DEVICE_EVENT',{deviceId:device,eventId:'return-1',eventType:'RETURN',tag:'RFID-2',employeeId:person.id,loanId:checkout.loanId})
assert.equal(returned.eventStatus,'ACCEPTED');assert.equal(assetStock(s.toolManagement,asset(two)),1)
const inventory=cmd('DEVICE_EVENT',{deviceId:device,eventId:'inv-1',eventType:'INVENTORY',tags:[]})
assert.equal(inventory.eventStatus,'ERROR');assert.equal(assetStock(s.toolManagement,asset(two)),1)
const lostLoan=cmd('BORROW',{assetId:two,quantity:1,borrower:'领用乙',dueAt:'2026-11-06T12:00:00'}).id
const lostRequest=cmd('DISPOSAL_REQUEST',{assetId:two,loanId:lostLoan,quantity:1,kind:'LOST',reason:'使用中遗失'}).id
assert.equal(assetStock(s.toolManagement,asset(two)),0)
rejected(()=>cmd('RETURN',{loanId:lostLoan,assetId:two,quantity:1,returner:'乙'}),/待审核/)
cmd('DISPOSAL_REVIEW',{id:lostRequest,decision:'APPROVED',opinion:'已核查遗失'},'审核丁')
assert.equal(s.toolManagement.loans.find(l=>l.id===lostLoan).status,'CLOSED')
assert.equal(asset(two).quantity,0);assert.equal(asset(two).status,'LOST')
const task=s.schedules[0],wrong=cmd('CHECK_USE',{assetId:two,scheduleTaskId:task.id})
assert.equal(wrong.eventStatus,'ERROR')
cmd('TOOL_SAVE',{id:bulkTool,code:'BULK',name:'普通扳手',lowStock:99,lowStockWarehouseId:warehouse2})
assert.ok(toolAlerts(s,now).some(a=>a.type==='WAREHOUSE_LOW_STOCK'&&a.warehouseId===warehouse2))
cmd('ASSET_CONFIG',{assetId:bulk,status:'DISABLED'})
const disabledCount=cmd('COUNT_CREATE',{warehouseId:warehouse1}).id
assert.equal(s.toolManagement.counts.find(c=>c.id===disabledCount).lines.find(l=>l.assetId===bulk).expected,asset(bulk).quantity,'disabled stock remains physical inventory')
cmd('COUNT_CANCEL',{id:disabledCount})
const disabledRepair=cmd('SERVICE_SEND',{assetId:bulk,quantity:1,kind:'REPAIR',provider:'维修厂',reason:'停用工具维修'}).id
cmd('SERVICE_FINISH',{id:disabledRepair,result:'PASS',certificate:'维修合格'})
assert.ok(s.toolManagement.assets.some(a=>a.code===`B-001-S${disabledRepair}`&&a.status==='AVAILABLE'))
const taskFixture=createState(),taskNow=new Date().toISOString()
const taskRun=(type,payload)=>applyToolCommand(taskFixture,{type,payload,actor:'甲',requestId:crypto.randomUUID()},{now:taskNow})
const taskWarehouse=taskRun('WAREHOUSE_SAVE',{code:'TW',name:'作业库'}).id
const requiredTool=taskFixture.toolRequirements.find(r=>r.taskId===taskFixture.schedules[0].taskId)
const fixtureTool=taskFixture.tools.find(t=>t.id===requiredTool.toolId)
taskRun('ADOPT_LEGACY',{toolId:fixtureTool.id,warehouseId:taskWarehouse,code:'CHECK-ME',tag:'SCAN-ME'})
taskRun('REQUIREMENT_SAVE',{toolId:fixtureTool.id,taskId:requiredTool.taskId,quantity:1})
assert.equal(taskToolCheck(taskFixture,taskFixture.schedules[0].id,taskNow).ok,false)
const scan=taskRun('CHECK_USE',{tag:'SCAN-ME',scheduleTaskId:taskFixture.schedules[0].id,quantity:1})
assert.equal(scan.eventStatus,'ACCEPTED');assert.equal(taskToolCheck(taskFixture,taskFixture.schedules[0].id,taskNow).ok,true)
taskRun('CHECK_USE',{tag:'WRONG',scheduleTaskId:taskFixture.schedules[0].id,quantity:1})
assert.equal(taskToolCheck(taskFixture,taskFixture.schedules[0].id,taskNow).ok,false)
const taskDevice=taskRun('DEVICE_SAVE',{code:'TASK-CAB',name:'作业柜',kind:'CABINET',warehouseId:taskWarehouse}).id
const checkedLoan=taskRun('DEVICE_EVENT',{deviceId:taskDevice,eventId:'AUTO-CHECK',eventType:'CHECKOUT',tag:'SCAN-ME',employeeId:taskFixture.employees[0].id,scheduleTaskId:taskFixture.schedules[0].id,dueAt:'2099-01-01T18:00:00'})
assert.equal(checkedLoan.eventStatus,'ACCEPTED');assert.equal(taskToolCheck(taskFixture,taskFixture.schedules[0].id,taskNow).ok,true)
const input={requestId:'idempotency',actor:'甲',type:'CATEGORY_SAVE',payload:{code:'DUP-ID',name:'唯一'}}
const first=applyToolCommand(s,input,{now}),repeat=applyToolCommand(s,input,{now});assert.equal(repeat.id,first.id);assert.equal(repeat.duplicate,true)
rejected(()=>applyToolCommand(s,{...input,payload:{code:'DIFFERENT',name:'不同'}},{now}),/不同操作/)
assert.equal(validateToolManagement(s),true)
const snapshot=exportDemoSnapshot(s),restored=parseDemoSnapshot(JSON.stringify(snapshot));assert.deepEqual(restored.data.toolManagement,s.toolManagement)
const old=exportDemoSnapshot(createState());delete old.data.toolManagement;assert.equal(parseDemoSnapshot(JSON.stringify(old)).data.toolManagement.assets.length,0)
for(const page of ['resources','g1-p2','g2-p1','g3-p1','g4-p1','g5-p1','g5-p2']){
 const html=toolsPage.render({state:s,role:{id:'tool-management'},page});assert.equal((html.match(/<h1[\s>]/g)||[]).length,1);assert.match(html,/data-tool-workspace/);assert.doesNotMatch(html,/业务功能待开发/)
}
console.log(JSON.stringify({passed:true,commands:sequence,checks:['legacy stock adoption without duplication','numbered, bulk and kit inventory','partial and proxy returns','cross-warehouse transfer receipt and cancellation','inspection and repair outcomes','independent disposal review','stale count rejection and variance adjustment','calibration availability','low-stock and expiry alerts','device heartbeat provenance','shared idempotent device checkout and return','unknown label and wrong-tool alarms','tag inventory without automatic write-off','snapshot migration and roundtrip','tool route render'],limitations:['No physical cabinet, reader or access-control hardware connected; no browser visual verification.']},null,2))
