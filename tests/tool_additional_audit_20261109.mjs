// Discovery audit: assertions confirm reproducible defects, NOT passing acceptance.
// Only synthetic in-memory state is changed in this phase.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createState} from '../src/core/state.js'
import {applyToolCommand,assetStock} from '../src/core/tool-management.js'
import {toolTableData,selectedToolActions} from '../src/shared/tool-table.js'
const out=new URL('../../outputs/工具管理追加审查_20261109/',import.meta.url)
await fs.mkdir(out,{recursive:true})
const findings=[]
function fixture(){
 const s=createState();let seq=0
 const run=(type,payload={},actor='追加审查员')=>applyToolCommand(s,{type,payload,actor,requestId:`additional-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const warehouse=s.toolManagement.warehouses[0].id
 const tool=run('TOOL_SAVE',{code:'ADDITIONAL',name:'合成检查工具'}).id
 const asset=run('ASSET_CREATE',{toolId:tool,warehouseId:warehouse,code:'BULK-AUDIT',mode:'BULK',quantity:10,tag:'ADDITIONAL-TAG'}).id
 const item=()=>s.toolManagement.assets.find(a=>a.id===asset)
 const count=()=>{const id=run('COUNT_CREATE',{warehouseId:warehouse}).id;const row=s.toolManagement.counts.find(c=>c.id===id);run('COUNT_FINISH',{id,reason:'现场实有9件，少1件',lines:row.lines.map(l=>({assetId:l.assetId,counted:9}))});return id}
 return {s,run,warehouse,asset,item,count}
}
{
 const {s,run,asset,item,count}=fixture();const id=count()
 const loan=run('BORROW',{assetId:asset,quantity:10,borrower:'合成领用人',dueAt:'2099-01-01'}).id
 assert.equal(s.toolManagement.loans.find(l=>l.id===loan).lines[0].quantity,10)
 findings.push({id:'N01',priority:'P1',title:'实盘少1件但尚未申请时，系统仍允许借出账面10件',method:'in-memory domain commands',observed:{countId:id,expected:10,physical:9,account:item().quantity,loanQuantity:10},impact:'缺失工具仍被计为可领用，盘点事实与借出校验脱节。',reproduction:['应有10，实盘9，完成盘点','先不提交遗失申请，借出10','借出成功'],suggestion:'差异待处理期间明确限制不实可借量；遗失审核前账面不扣减，但也不能把已确认短缺的实物当作可领用。'})
}
{
 const {run,asset,item,count}=fixture();const first=count(),second=count()
 for(const id of [first,second]){const req=run('DISPOSAL_REQUEST',{assetId:asset,quantity:1,kind:'LOST',countId:id,reason:'同一基准10、实盘9'}).id;run('DISPOSAL_REVIEW',{id:req,decision:'APPROVED',opinion:'独立复核'},'独立审核员')}
 assert.equal(item().quantity,8)
 findings.push({id:'N02',priority:'P1',title:'同一库存基准的两张盘点单可把同一差异扣两次',method:'in-memory domain commands',observed:{countIds:[first,second],physical:9,finalAccount:8},impact:'每张盘点内部有防重复，但跨盘点单没有关联基准校验，账面会继续少扣。',reproduction:['调整前连续完成两次应有10/实盘9的盘点','分别关联两张盘点申请遗失1件并批准','数量10→9→8，现场仍为9'],suggestion:'处置时核对盘点基准与已生效调整；同一差异不能因换盘点号重复处置。'})
}
{
 const {s,run,asset,item}=fixture()
 const service=run('SERVICE_SEND',{assetId:asset,quantity:1,kind:'REPAIR',provider:'合成维修单位',reason:'其中1件维修'}).id
 const fail=run('SERVICE_FINISH',{id:service,result:'FAIL',certificate:'其中1件不合格'})
 const before=assetStock(s.toolManagement,item())
 run('DISPOSAL_REVIEW',{id:fail.disposalId,decision:'REJECTED',opinion:'退回补充依据'},'独立审核员')
 assert.equal(item().status,'DISABLED');assert.equal(assetStock(s.toolManagement,item()),0)
 findings.push({id:'N03',priority:'P1',title:'部分送修失败后驳回报废申请，会停用整个数量批次',method:'in-memory domain commands',observed:{total:10,failed:1,unaffectedAvailableBeforeReview:before,statusAfterRejection:item().status,availableAfterRejection:0},impact:'其余9件未送修工具也不能借出，失败件与正常件没有分别管理。',reproduction:['10件中送修1件，结果不合格','自动生成报废申请，审核驳回','全批10件状态变停用'],suggestion:'隔离失败数量及状态，不把单件结果套到整批；驳回后保留失败件的后续处理入口。'})
}
{
 const {s,run,asset}=fixture()
 const service=run('SERVICE_SEND',{assetId:asset,quantity:2,kind:'INSPECTION',provider:'合成检定单位',reason:'部分检定'}).id
 run('SERVICE_FINISH',{id:service,result:'PASS',certificate:'ADDITIONAL-CERT'})
 const split=s.toolManagement.assets.find(a=>a.id!==asset)
 const table=toolTableData(s).find(e=>e.asset?.id===split.id)
 assert.equal(s.toolManagement.services.filter(r=>r.assetId===split.id).length,0);assert.equal(table.values.provider,'—')
 const t=fixture();const target=t.s.toolManagement.warehouses[1].id,move=t.run('TRANSFER',{assetId:t.asset,quantity:2,toWarehouseId:target}).id
 t.run('TRANSFER_FINISH',{id:move,decision:'RECEIVED'})
 const moved=t.s.toolManagement.assets.find(a=>a.id!==t.asset)
 assert.equal(t.s.toolManagement.transfers.filter(r=>r.assetId===moved.id).length,0)
 findings.push({id:'N04',priority:'P1',title:'部分检定或调拨拆出的新台账没有关联原业务履历',method:'in-memory domain and table projection',observed:{inspectionSplitCode:split.code,newInspectionHistory:0,displayedProvider:table.values.provider,transferSplitCode:moved.code,newTransferHistory:0},impact:'新台账确实刚检定/调入，但查询其档案看不到原证书、单位或来源单，只在旧台账中有记录。',reproduction:['批次中取2件完成检定或调拨','系统生成-S或-T新台账','按新台账ID查询业务履历为空'],suggestion:'保存来源资产/原单与拆出数量，档案贯通来源链；不能仅复制日期。'})
}
{
 const {s,run,warehouse,asset}=fixture()
 const device=run('DEVICE_SAVE',{code:'AUDIT-CAB',name:'合成工具柜',warehouseId:warehouse,kind:'CABINET'}).id
 const employee=s.employees.find(e=>e.status==='ACTIVE').id
 const result=run('DEVICE_EVENT',{deviceId:device,eventId:'zero-quantity',eventType:'CHECKOUT',tag:'ADDITIONAL-TAG',quantity:0,employeeId:employee,dueAt:'2099-01-01'})
 assert.equal(result.eventStatus,'ACCEPTED');const actual=s.toolManagement.loans.at(-1).lines[0].quantity;assert.equal(actual,1)
 findings.push({id:'N05',priority:'P1',title:'设备事件明确传数量0，会被当成1件办理',method:'simulated device domain command; no physical device',observed:{requestedQuantity:0,eventStatus:result.eventStatus,actualLoanQuantity:actual},impact:'错误输入被默认为真实领用，软件接口记录与设备请求数量不同。',reproduction:['软件模拟设备CHECKOUT，显式quantity=0','事件返回ACCEPTED','实际借出1件'],suggestion:'仅对未传数量使用默认值，显式0应按无效数量拒绝；同时验证RETURN分支。'})
}
{
 const {s,run,asset}=fixture()
 run('KIT_SAVE',{code:'AUDIT-KIT',name:'合成套装',lines:[{assetId:asset,quantity:1}]})
 const row=toolTableData(s).find(e=>e.asset?.id===asset)
 const enabled=selectedToolActions(s,[row]).some(([key])=>key==='transfer')
 let error;try{run('TRANSFER',{assetId:asset,quantity:1,toWarehouseId:s.toolManagement.warehouses[1].id})}catch(e){error=e.message}
 assert.equal(enabled,true);assert.match(error,/套装/)
 findings.push({id:'N06',priority:'P2',title:'套装成员的调拨按钮启用，但提交必然被后端拒绝',method:'domain and frontend action predicate',observed:{transferButtonEnabled:enabled,error},impact:'用户填完经办人才能知道要先修改套装，事先没有说明。',suggestion:'前端适用条件与后端一致，选择时就显示套装引用与处理办法。'})
}
await fs.writeFile(new URL('领域新增问题.json',out),JSON.stringify({date:'2026-11-09',purpose:'Defect discovery; reproduced findings, not acceptance passes',productionWrites:false,findings},null,2))
console.log(JSON.stringify({reproduced:findings.length,findings},null,2))
