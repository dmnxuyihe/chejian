import assert from 'node:assert/strict'
import {createState} from '../src/core/state.js'
import {applyToolCommand,toolAlerts,validateToolManagement} from '../src/core/tool-management.js'

// Deterministic 1000-scenario matrix. Each case rebuilds an isolated state and
// exercises a different combination of stock, flow, approval, device, and error paths.
const scenarios=1000
const stats=Object.fromEntries(['borrow-return','transfer','inspection','repair-disposal','disposal-review','count','heartbeat','device-checkout','invalid-atomicity','inventory-error'].map(k=>[k,0]))
let assertions=0, sequence=0
const check=(condition,message)=>{assert.ok(condition,message);assertions++}
const rng=seed=>{let x=(seed^0x9e3779b9)>>>0;return()=>{x=(Math.imul(x^x>>>16,2246822519)>>>0);x=(Math.imul(x^x>>>13,3266489917)>>>0);return ((x^x>>>16)>>>0)/4294967296}}

for(let scenario=1;scenario<=scenarios;scenario++){
  const random=rng(scenario),state=createState(),now=`2026-11-${String((scenario%27)+1).padStart(2,'0')}T08:00:00.000Z`
  let localSeq=0
  const cmd=(type,payload={},actor='场景经办人',options={})=>applyToolCommand(state,{type,payload,actor,requestId:`stress-${scenario}-${++localSeq}`},{now,...options})
  const w1=cmd('WAREHOUSE_SAVE',{code:`S${scenario}A`,name:`场景库A-${scenario}`}).id
  const w2=cmd('WAREHOUSE_SAVE',{code:`S${scenario}B`,name:`场景库B-${scenario}`}).id
  const legacy=state.tools.find(t=>Number(t.quantity)>0)
  check(!!legacy,`scenario ${scenario}: legacy fixture`)
  const adopted=cmd('ADOPT_LEGACY',{toolId:legacy.id,warehouseId:w1,code:`S${scenario}-LEGACY`}).id
  const tool=cmd('TOOL_SAVE',{code:`S${scenario}-BULK`,name:`场景批量工具${scenario}`,specification:`规格-${scenario%7}`,lowStock:scenario%5}).id
  const bulk=cmd('ASSET_CREATE',{toolId:tool,warehouseId:w1,code:`S${scenario}-BULK-01`,mode:'BULK',quantity:5+(scenario%5),tag:`S${scenario}-BULK-TAG`,inspectionCycleMonths:12,lastInspectionAt:now.slice(0,10)}).id
  const numbered=cmd('ASSET_CREATE',{toolId:tool,warehouseId:w1,code:`S${scenario}-NUM-01`,mode:'NUMBERED',quantity:1,tag:`S${scenario}-NUM-TAG`,inspectionCycleMonths:scenario%3?0:12,lastInspectionAt:now.slice(0,10)}).id
  const device=cmd('DEVICE_SAVE',{code:`S${scenario}-CAB`,name:`场景工具柜${scenario}`,kind:'CABINET',warehouseId:w1}).id
  check(validateToolManagement(state)===true,`scenario ${scenario}: setup valid`)

  const branch=scenario%10
  if(branch===0){
    stats['borrow-return']++
    const quantity=1+(scenario%Math.min(4,state.toolManagement.assets.find(a=>a.id===bulk).quantity))
    const loan=cmd('BORROW',{assetId:bulk,quantity,borrower:`借用人-${scenario}`,borrowType:scenario%2?'检修':'盘点',dueAt:'2099-01-01T18:00:00'}).id
    check(!!loan,`scenario ${scenario}: loan created`)
    const firstReturn=Math.max(1,quantity-(scenario%3===0?0:1))
    cmd('RETURN',{loanId:loan,assetId:bulk,quantity:firstReturn,returner:`归还人-${scenario}`})
    if(firstReturn<quantity)cmd('RETURN',{loanId:loan,assetId:bulk,quantity:quantity-firstReturn,returner:`代还人-${scenario}`})
  }else if(branch===1){
    stats.transfer++
    const transfer=cmd('TRANSFER',{assetId:numbered,toWarehouseId:w2,quantity:1}).id
    cmd('TRANSFER_FINISH',{id:transfer,decision:scenario%2?'RECEIVED':'CANCELLED'},'接收人')
    check(state.toolManagement.transfers.some(t=>t.id===transfer),`scenario ${scenario}: transfer retained`)
  }else if(branch===2){
    stats.inspection++
    const service=cmd('SERVICE_SEND',{assetId:numbered,quantity:1,kind:'INSPECTION',provider:`检定单位-${scenario%11}`,reason:'周期检定'}).id
    cmd('SERVICE_FINISH',{id:service,result:'PASS',certificate:`CERT-${scenario}`},'检定员')
    check(state.toolManagement.services.find(r=>r.id===service).status==='CLOSED',`scenario ${scenario}: inspection closed`)
  }else if(branch===3){
    stats['repair-disposal']++
    const service=cmd('SERVICE_SEND',{assetId:numbered,quantity:1,kind:'REPAIR',provider:`维修单位-${scenario%13}`,reason:scenario%2?'故障维修':'预防性维修'}).id
    const result=cmd('SERVICE_FINISH',{id:service,result:'FAIL',certificate:'无法修复'},'维修员')
    const disposal=result.disposalId
    check(!!disposal,`scenario ${scenario}: disposal generated`)
    cmd('DISPOSAL_REVIEW',{id:disposal,decision:scenario%2?'APPROVED':'REJECTED',opinion:scenario%2?'批准退出':'驳回并返修'},'审核人')
  }else if(branch===4){
    stats['disposal-review']++
    const disposal=cmd('DISPOSAL_REQUEST',{assetId:bulk,quantity:1,kind:scenario%2?'LOST':'SCRAPPED',reason:`场景处置-${scenario}`}).id
    cmd('DISPOSAL_REVIEW',{id:disposal,decision:scenario%3?'REJECTED':'APPROVED',opinion:scenario%3?'核查后继续使用':'批准处置'},'审核人')
    check(state.toolManagement.disposals.find(r=>r.id===disposal).status!=='PENDING',`scenario ${scenario}: disposal reviewed`)
  }else if(branch===5){
    stats.count++
    const count=cmd('COUNT_CREATE',{warehouseId:w1,reason:`场景盘点-${scenario}`}).id
    const row=state.toolManagement.counts.find(r=>r.id===count)
    const lines=row.lines.map(line=>({assetId:line.assetId,counted:Math.max(0,line.expected-(scenario%3===0?1:0))}))
    cmd('COUNT_FINISH',{id:count,reason:scenario%3===0?'发现差异':'实盘相符',lines},'盘点人')
    check(state.toolManagement.counts.find(r=>r.id===count).status==='CLOSED',`scenario ${scenario}: count closed`)
  }else if(branch===6){
    stats.heartbeat++
    const simulated=cmd('DEVICE_EVENT',{deviceId:device,eventId:`HB-SIM-${scenario}`,eventType:'HEARTBEAT'})
    check(simulated.eventStatus==='ACCEPTED',`scenario ${scenario}: simulated heartbeat accepted`)
    const real=cmd('DEVICE_EVENT',{deviceId:device,eventId:`HB-REAL-${scenario}`,eventType:'HEARTBEAT'},'设备网关',{hardware:true})
    check(real.eventStatus==='ACCEPTED'&&!!state.toolManagement.devices.find(d=>d.id===device).lastSeenAt,`scenario ${scenario}: real heartbeat updates last seen`)
  }else if(branch===7){
    stats['device-checkout']++
    const person=state.employees.find(e=>e.status==='ACTIVE')
    const known=scenario%2===0
    const result=cmd('DEVICE_EVENT',{deviceId:device,eventId:`CO-${scenario}`,eventType:'CHECKOUT',tag:known?state.toolManagement.assets.find(a=>a.id===numbered).tag:`UNKNOWN-${scenario}`,employeeId:person.id,dueAt:'2099-01-01T18:00:00'})
    check(result.eventStatus=== (known?'ACCEPTED':'ERROR'),`scenario ${scenario}: device checkout result`)
  }else if(branch===8){
    stats['invalid-atomicity']++
    const before=JSON.stringify(state.toolManagement)
    assert.throws(()=>cmd('BORROW',{assetId:bulk,quantity:-1,borrower:'非法',dueAt:'2099-01-01T18:00:00'}))
    check(JSON.stringify(state.toolManagement)===before,`scenario ${scenario}: invalid command atomic`)
    cmd('TOOL_SAVE',{id:tool,code:`S${scenario}-BULK`,name:`场景批量工具${scenario}`,lowStock:(scenario+3)%7})
  }else{
    stats['inventory-error']++
    const result=cmd('DEVICE_EVENT',{deviceId:device,eventId:`INV-${scenario}`,eventType:'INVENTORY',tags:[]})
    check(result.eventStatus==='ERROR',`scenario ${scenario}: empty inventory result`)
    const event=state.toolManagement.events.find(e=>e.eventId===`INV-${scenario}`)
    if(event)cmd('EVENT_RESOLVE',{id:event.id,resolution:'空盘点结果，待重新采集'},'处置人')
  }
  check(validateToolManagement(state)===true,`scenario ${scenario}: final valid`)
  check(Array.isArray(toolAlerts(state,now)),`scenario ${scenario}: alerts readable`)
  assertions++
  if(scenario%100===0)console.log(`tool stress ${scenario}/${scenarios}; assertions=${assertions}`)
}
console.log(JSON.stringify({passed:true,scenarios,assertions,branches:stats,scope:'isolated deterministic combinations of tool stock, circulation, service, disposal approval, counts, device events, invalid atomic writes, and alert recomputation'},null,2))
