import assert from 'node:assert/strict'
import {createState} from '../src/core/state.js'
import {applyToolCommand,assetStock,assetCountShortage,assetBusinessHistory,countLossRemaining,validateToolManagement} from '../src/core/tool-management.js'
import {toolTableData,selectedToolActions,toolActionOptions} from '../src/shared/tool-table.js'
import {toolCommandReceipt} from '../src/shared/tool-receipt.js'
import {toolRecordData} from '../src/shared/tool-records.js'
import {exportDemoSnapshot,parseDemoSnapshot} from '../src/core/demo-persistence.js'
const checks=[]
function fixture(){
 const s=createState();let seq=0
 const run=(type,payload={},actor='追加复核员',requestId)=>applyToolCommand(s,{type,payload,actor,requestId:requestId||`regression-${++seq}`},{now:'2026-11-09T02:00:00.000Z'})
 run('WAREHOUSE_STANDARDIZE');const warehouse=s.toolManagement.warehouses[0].id,target=s.toolManagement.warehouses[1].id
 const tool=run('TOOL_SAVE',{code:'REGRESSION',name:'回归测试工具'}).id
 const asset=run('ASSET_CREATE',{toolId:tool,warehouseId:warehouse,code:'BULK-TEST',mode:'BULK',quantity:10,tag:'REGRESSION-TAG'}).id
 const item=()=>s.toolManagement.assets.find(a=>a.id===asset),m=()=>s.toolManagement
 const count=(actual=9)=>{const id=run('COUNT_CREATE',{warehouseId:warehouse}).id,row=m().counts.find(c=>c.id===id);run('COUNT_FINISH',{id,reason:'现场复核',lines:row.lines.map(l=>({assetId:l.assetId,counted:l.assetId===asset?actual:l.expected}))});return id}
 const request=(countId,quantity=1)=>run('DISPOSAL_REQUEST',{assetId:asset,quantity,kind:'LOST',countId,reason:'盘亏复核'}).id
 const review=(id,decision='APPROVED')=>run('DISPOSAL_REVIEW',{id,decision,opinion:'独立复核'},'审核员')
 return {s,run,warehouse,target,asset,tool,item,m,count,request,review}
}
{
 const f=fixture(),{s,run,asset,m,item,target}=f,id=f.count()
 assert.equal(item().quantity,10);assert.equal(assetStock(m(),item()),9);assert.equal(assetCountShortage(m(),asset),1)
 const row=toolTableData(s).find(e=>e.asset?.id===asset);assert.match(row.values.state,/盘亏待处理 1/)
 for(const [type,payload] of [['BORROW',{borrower:'领用人',dueAt:'2099-01-01'}],['TRANSFER',{toWarehouseId:target}],['SERVICE_SEND',{kind:'REPAIR',provider:'维修方',reason:'复核'}],['DISPOSAL_REQUEST',{kind:'SCRAPPED',reason:'复核'}]]){
  const before=structuredClone(m());assert.throws(()=>run(type,{assetId:asset,quantity:10,...payload}),/盘亏|不足/);assert.deepEqual(m(),before)
 }
 const loan=run('BORROW',{assetId:asset,quantity:9,borrower:'领用人',dueAt:'2099-01-01'}).id
 assert.equal(assetStock(m(),item()),0)
 const disposal=f.request(id);assert.equal(assetCountShortage(m(),asset),0);f.review(disposal)
 assert.equal(item().quantity,9);assert.equal(assetStock(m(),item()),0)
 run('RETURN',{loanId:loan,assetId:asset,quantity:9,returner:'领用人'});assert.equal(assetStock(m(),item()),9)
 checks.push('N01: confirmed shortage freezes borrowing/transfer/service/writeoff, approval deducts once, return restores only physical stock')
}
{
 const f=fixture(),first=f.count(),second=f.count(),id=f.request(first)
 assert.throws(()=>f.request(second),/尚未处理/)
 f.review(id,'REJECTED');assert.equal(assetStock(f.m(),f.item()),9)
 const resubmitted=f.request(second);f.review(resubmitted);assert.equal(f.item().quantity,9)
 assert.throws(()=>f.request(first),/尚未处理/);assert.throws(()=>f.request(second),/尚未处理/)
 const fresh=f.count(8),next=f.request(fresh);f.review(next);assert.equal(f.item().quantity,8)
 checks.push('N02: same-baseline cross-count duplicate blocked before and after approval; rejection resubmission and new losses work')
}
{
 const f=fixture(),first=f.count(7),second=f.count(7)
 const one=f.request(first),two=f.request(second);assert.equal(assetStock(f.m(),f.item()),7)
 f.review(one);f.review(two);assert.equal(f.item().quantity,8);assert.equal(assetStock(f.m(),f.item()),7)
 const three=f.request(first);f.review(three);assert.equal(f.item().quantity,7);assert.throws(()=>f.request(second),/尚未处理/)
 checks.push('N02: partial requests share a single cross-count shortage budget')
}
{
 const f=fixture(),old=f.count(),pending=f.request(old);f.count(10)
 assert.throws(()=>f.review(pending),/基准已变化/)
 f.review(pending,'REJECTED');assert.equal(assetStock(f.m(),f.item()),10);assert.throws(()=>f.request(old),/尚未处理/)
 checks.push('N01/N02: later physical reconciliation releases quarantine and invalidates stale loss approval')
}
{
 const f=fixture(),count=f.count(),pending=f.request(count);const newer=f.count(9)
 assert.equal(f.m().counts.find(c=>c.id===newer).lines[0].expected,10)
 f.review(pending,'REJECTED');assert.equal(assetStock(f.m(),f.item()),9)
 f.review(f.request(newer));assert.equal(f.item().quantity,9)
 checks.push('N02: count during pending loss retains accounting baseline and survives rejected application')
}
for(const kind of ['REPAIR','INSPECTION'])for(const decision of ['REJECTED','APPROVED']){
 const f=fixture(),service=f.run('SERVICE_SEND',{assetId:f.asset,quantity:1,kind,provider:'复核机构',reason:'部分检修'}).id
 const result=f.run('SERVICE_FINISH',{id:service,result:'FAIL',certificate:'不合格证据'})
 const failed=f.m().assets.find(a=>a.id===result.resultingAssetId)
 assert.notEqual(failed.id,f.asset);assert.equal(f.item().quantity,9);assert.equal(assetStock(f.m(),f.item()),9);assert.equal(failed.quantity,1);assert.equal(failed.status,'DISABLED')
 assert.equal(f.m().disposals.find(d=>d.id===result.disposalId).assetId,failed.id)
 f.review(result.disposalId,decision);assert.equal(assetStock(f.m(),f.item()),9)
 if(decision==='REJECTED'){
  assert.equal(failed.status,'DISABLED');const retry=f.run('SERVICE_SEND',{assetId:failed.id,quantity:1,kind:'REPAIR',provider:'复修方',reason:'复修'}).id
  f.run('SERVICE_FINISH',{id:retry,result:'PASS',certificate:'复修合格'});assert.equal(assetStock(f.m(),f.m().assets.find(a=>a.id===failed.id)),1)
 }else assert.equal(f.m().assets.find(a=>a.id===failed.id).quantity,0)
 validateToolManagement(f.s)
 checks.push(`N03: partial ${kind} failure isolates one unit, ${decision} preserves nine unaffected units and supports follow-up`)
}
{
 const f=fixture(),service=f.run('SERVICE_SEND',{assetId:f.asset,quantity:2,kind:'INSPECTION',provider:'来源检定机构',reason:'部分检定'}).id
 const result=f.run('SERVICE_FINISH',{id:service,result:'PASS',certificate:'CERT-SOURCE'}),child=result.resultingAssetId
 assert.equal(assetBusinessHistory(f.m(),child,'services')[0].certificate,'CERT-SOURCE')
 assert.equal(toolTableData(f.s).find(e=>e.asset?.id===child).values.provider,'来源检定机构')
 const transfer=f.run('TRANSFER',{assetId:child,quantity:1,toWarehouseId:f.target}).id
 f.run('TRANSFER_FINISH',{id:transfer,decision:'RECEIVED'})
 const grandchild=f.m().transfers.find(r=>r.id===transfer).resultingAssetId
 assert.equal(assetBusinessHistory(f.m(),grandchild,'services')[0].id,service)
 assert.equal(assetBusinessHistory(f.m(),grandchild,'transfers')[0].id,transfer)
 const unrelated=f.run('SERVICE_SEND',{assetId:f.asset,quantity:1,kind:'REPAIR',provider:'另一机构',reason:'另一部分'}).id
 f.run('SERVICE_FINISH',{id:unrelated,result:'PASS',certificate:'UNRELATED'})
 assert.deepEqual(assetBusinessHistory(f.m(),child,'services').map(r=>r.id),[service])
 assert.deepEqual(assetBusinessHistory(f.m(),grandchild,'services').map(r=>r.id),[service])
 const another=f.run('TRANSFER',{assetId:f.asset,quantity:1,toWarehouseId:f.target}).id;f.run('TRANSFER_FINISH',{id:another,decision:'RECEIVED'})
 const sibling=f.m().transfers.find(r=>r.id===another).resultingAssetId
 assert.equal(assetBusinessHistory(f.m(),sibling,'services').length,0,'unrelated partial services on other units are not inherited')
 const legacy=structuredClone(f.m());delete legacy.assets.find(a=>a.id===child).sourceRecordIds;delete legacy.assets.find(a=>a.id===child).parentAssetId;delete legacy.services.find(r=>r.id===service).resultingAssetId
 assert.equal(assetBusinessHistory(legacy,child,'services')[0].certificate,'CERT-SOURCE')
 assert.equal(f.m().services.length,2,'history projection never copies transactions')
 assert.throws(()=>f.run('ASSET_DELETE',{assetId:child}),/业务记录/)
 assert.equal(selectedToolActions(f.s,[toolTableData(f.s).find(e=>e.asset?.id===child)]).some(([k])=>k==='delete'),false)
 checks.push('N04: certificate/provider and transfer provenance survive multiple splits without unrelated sibling/future history; legacy suffixes readable')
}
{
 const f=fixture(),device=f.run('DEVICE_SAVE',{code:'CAB',name:'测试柜',warehouseId:f.warehouse,kind:'CABINET'}).id,person=f.s.employees.find(e=>e.status==='ACTIVE').id
 const event=(eventType,quantity,extra={})=>f.run('DEVICE_EVENT',{deviceId:device,eventId:`${eventType}-${f.m().events.length}`,eventType,tag:'REGRESSION-TAG',employeeId:person,dueAt:'2099-01-01',...(quantity===undefined?{}:{quantity}),...extra})
 for(const q of [0,-1,1.5,'',1000001])assert.equal(event('CHECKOUT',q).eventStatus,'ERROR')
 assert.equal(f.m().loans.length,0)
 const loan=event('CHECKOUT').loanId;assert.equal(f.m().loans[0].lines[0].quantity,1)
 for(const q of [0,-1,1.5,'',1000001])assert.equal(event('RETURN',q,{loanId:loan}).eventStatus,'ERROR')
 assert.equal(f.m().loans[0].lines[0].returned,0)
 assert.equal(event('RETURN',undefined,{loanId:loan}).eventStatus,'ACCEPTED');assert.equal(f.m().loans[0].status,'CLOSED')
 checks.push('N05: zero/negative/fraction/empty/oversized device checkout and return do not mutate loans; omitted quantity defaults to one')
}
{
 const f=fixture();f.run('KIT_SAVE',{code:'KIT',name:'测试套装',lines:[{assetId:f.asset,quantity:1}]})
 const row=toolTableData(f.s).find(e=>e.asset?.id===f.asset)
 assert.equal(selectedToolActions(f.s,[row]).some(([k])=>k==='transfer'),false)
 const option=toolActionOptions(f.s,[row]).find(o=>o.key==='transfer');assert.equal(option.enabled,false);assert.match(option.reason,/套装组成/)
 checks.push('N06: kit-member transfer disabled with actionable reason before form entry')
}
{
 const f=fixture(),payload={commands:[{type:'SERVICE_SEND',payload:{assetId:f.asset,quantity:1,kind:'REPAIR',provider:'修理所',reason:'维修'}},{type:'SERVICE_SEND',payload:{assetId:f.asset,quantity:1,kind:'INSPECTION',provider:'计量所',reason:'检定'}}]},result=f.run('BATCH',payload)
 const receipt=toolCommandReceipt(f.s,'BATCH',payload,result,'追加复核员')
 assert.deepEqual(receipt.groups,[{kind:'repair',ids:[result.results[0].id]},{kind:'inspection',ids:[result.results[1].id]}])
 for(const [i,kind] of ['repair','inspection'].entries()){
  const p={id:result.results[i].id,result:'PASS',certificate:'CERT'},r=f.run('SERVICE_FINISH',p)
  const done=toolCommandReceipt(f.s,'SERVICE_FINISH',p,r,'追加复核员');assert.equal(done.kind,kind);assert.deepEqual(done.ids,[p.id])
 }
 checks.push('N07: batch send and finish receipts select actual record kind; mixed batches retain separate IDs')
}
{
 const f=fixture(),id=f.run('CHECK_USE',{tag:'UNKNOWN',scheduleTaskId:f.s.schedules[0].id}).id
 let row=toolRecordData(f.s,'events').rows.find(r=>r.id===id);assert.equal(row.todo,true)
 f.run('EVENT_RESOLVE',{id,resolution:'已检查并处理'});row=toolRecordData(f.s,'events').rows.find(r=>r.id===id)
 assert.equal(row.todo,false);assert.equal(row.status,'ERROR');assert.match(row.cells[2],/异常 · 已处置/);assert.equal(row.actions.length,0)
 checks.push('N08: resolved errors leave todo while retaining original ERROR result and disposition evidence')
}
{
 const f=fixture();f.count();const backup=exportDemoSnapshot(f.s)
 delete backup.data.toolManagement.countAvailabilityVersion
 for(const c of backup.data.toolManagement.counts)for(const line of c.lines)delete line.lossAdjusted
 backup.data.tools.find(t=>t.id===f.tool).quantity=10
 const restored=parseDemoSnapshot(JSON.stringify(backup)).data
 assert.equal(restored.toolManagement.countAvailabilityVersion,1);assert.equal(restored.tools.find(t=>t.id===f.tool).quantity,9);assert.equal(restored.toolManagement.assets.find(a=>a.id===f.asset).quantity,10)
 assert.deepEqual(parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(restored))).data.toolManagement,restored.toolManagement)
 const pending=f.request(f.m().counts[0].id),command={type:'DISPOSAL_REVIEW',payload:{id:pending,decision:'APPROVED',opinion:'幂等审核'},actor:'审核员',requestId:'same-approval'}
 applyToolCommand(f.s,command);const repeated=applyToolCommand(f.s,command);assert.equal(repeated.duplicate,true);assert.equal(f.item().quantity,9)
 checks.push('Compatibility: legacy backup recalculates only available cache; accounting preserved; repeated approval is idempotent')
}
console.log(JSON.stringify({passed:true,groups:checks.length,checks,productionWrites:false},null,2))
