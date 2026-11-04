import { escapeHtml as esc, openModal, toast } from '../core/ui.js'
import { fmtFullDateTime, formatLocalDateTime } from '../core/derived.js'
import { vehicleFacts, recordVehicleMilestones } from '../core/vehicle-operations.js'
import { exportDemoSnapshot } from '../core/demo-persistence.js'
import { contextIcon } from './workspace-art.js'

const value=item=>item==null||item===''?'未填写':esc(item)
export function vehicleDetails(state,vehicle,rows,day,{milestones=false}={}) {
  const facts=vehicleFacts(state,vehicle,rows,day)
  return `<section class="card vehicle-facts" data-vehicle-facts="${vehicle.id}"><div class="card-title-row"><h2 class="section-title-graphic">${contextIcon('机车',22)}车辆与检修信息</h2>${milestones?`<button type="button" class="btn btn-sm" data-vehicle-milestones="${vehicle.id}">记录入段 / 上台</button>`:''}</div><dl class="vehicle-facts-grid">${[
    ['机型 / 机号',`${facts.model} / ${vehicle.locomotiveNo}`],['配属局 / 配属段',`${vehicle.ownerBureau||'未填写'} / ${vehicle.ownerDepot||'未填写'}`],['修程 / 修次',`${facts.program} / ${vehicle.repairSequence==null?'未填写':`第${vehicle.repairSequence}次`}`],['计划入段',fmtFullDateTime(vehicle.plannedEntryAt)],['实际入段',vehicle.actualEntryAt?fmtFullDateTime(vehicle.actualEntryAt):'未填写'],['上台日期',vehicle.onStandAt?fmtFullDateTime(vehicle.onStandAt):'未填写'],['当前天数 / 天数',facts.dayProgress],['查询日期',day||'未选择'],
  ].map(([label,text])=>`<div><dt>${label}</dt><dd>${value(text)}</dd></div>`).join('')}</dl></section>`
}
// Save the candidate with the existing revision check; failure never replaces the UI state.
export async function saveVehicleOperation(ctx,operation) {
  const flushed=await ctx.demoPersistence.save()
  if(!flushed.ok) return flushed
  const candidate=structuredClone(ctx.state),result=operation(candidate)
  if(!result.ok)return result
  return await ctx.demoPersistence.restore(JSON.stringify(exportDemoSnapshot(candidate)))
}
export function mountVehicleMilestones(ctx) {
  document.querySelectorAll('[data-vehicle-milestones]').forEach(button=>button.addEventListener('click',()=>{
    const vehicle=ctx.state.vehicleRepairs.find(row=>row.id===Number(button.dataset.vehicleMilestones))
    if(!vehicle)return
    const input=value=>value?formatLocalDateTime(value):''
    openModal({title:`${vehicle.locomotiveNo} · 记录实际时间`,body:`<p class="pc-help">请填写现场实际发生的时间。计划入段、任务开始时间不会代替入段或上台记录。</p><div class="field"><label for="actual-entry">实际入段时间</label><input class="input" id="actual-entry" type="datetime-local" step="1" value="${input(vehicle.actualEntryAt)}"></div><div class="field"><label for="on-stand">上台时间（选填）</label><input class="input" id="on-stand" type="datetime-local" step="1" value="${input(vehicle.onStandAt)}"></div><div class="field"><label for="milestone-note">记录说明 / 更正原因</label><textarea class="textarea" id="milestone-note" maxlength="500"></textarea></div><p role="alert" data-vehicle-operation-error class="pc-error-text"></p>`,confirmText:'保存实际时间',async onConfirm(wrap){
      const result=await saveVehicleOperation(ctx,state=>recordVehicleMilestones(state,vehicle.id,{actualEntryAt:wrap.querySelector('#actual-entry').value,onStandAt:wrap.querySelector('#on-stand').value,note:wrap.querySelector('#milestone-note').value}))
      if(!result.ok){wrap.querySelector('[data-vehicle-operation-error]').textContent=result.message;return false}
      ctx.rerender(false);toast('实际时间已保存','日历、车辆详情和监控使用同一份记录')
    }})
  }))
}
