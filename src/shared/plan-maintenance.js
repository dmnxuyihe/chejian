import { escapeHtml as esc, openModal, toast } from '../core/ui.js'
import { dateKey } from '../core/planning-view.js'
import { editablePlanError, editUnscheduledPlan, deleteUnscheduledPlan } from '../core/vehicle-operations.js'
import { saveVehicleOperation } from './vehicle-details.js'
import { requestMonthlyPlanRevision,requestMonthlyPlanAdjustment } from '../core/planning-json-workflow.js'

export function planMaintenanceActions(state,id,{showHelp=true}={}) {
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(id))
  if(['SUBMITTED','REVIEWED'].includes(vehicle?.approvalStatus))return `<div class="plan-maintenance-actions"><a class="btn btn-sm" href="#/scheduling/workforce" data-pc1-open-single="${id}">查看排程计划</a><button class="btn btn-sm btn-primary" type="button" data-plan-revise="${id}">确认修改</button>${showHelp?'<p class="pc-help">当前审批中的排程只读；确认修改并填写原因后才可重新编排。</p>':''}</div>`
  if(vehicle?.approvalStatus==='PUBLISHED')return `<div class="plan-maintenance-actions"><a class="btn btn-sm" href="#/scheduling/workforce" data-pc1-open-single="${id}">查看排程计划</a><button class="btn btn-sm btn-primary" type="button" data-plan-adjust-published="${id}">申请调整</button>${showHelp?'<p class="pc-help">已发布排程只读；申请调整并填写原因后才能生成新版本。</p>':''}</div>`
  const reason=editablePlanError(state,id)
  return `<div class="plan-maintenance-actions"><button class="btn btn-sm" type="button" data-plan-edit="${id}" ${reason?'disabled':''}>修改计划</button><button class="btn btn-sm btn-danger" type="button" data-plan-delete="${id}" aria-describedby="plan-maintenance-help-${id}">删除计划</button>${reason&&showHelp?`<p class="pc-help" id="plan-maintenance-help-${id}">当前不能直接修改或删除：${esc(reason)}</p>`:''}</div>`
}
export function mountPlanMaintenance(ctx,afterSaved) {
  document.querySelector('[data-plan-revise]')?.addEventListener('click',event=>{const id=Number(event.currentTarget.dataset.planRevise),vehicle=ctx.state.vehicleRepairs.find(row=>row.id===id);if(!vehicle)return;openModal({title:`确认修改 · ${vehicle.locomotiveNo}`,body:'<p>确认后将撤回当前审批，保留原审批历史，并进入待修改状态。修改排程完成后需要重新提交审核。</p><div class="field"><label>修改原因 *</label><textarea class="textarea" maxlength="500" data-plan-revise-reason></textarea></div><p role="alert" class="pc-error-text" data-plan-edit-error></p>',confirmText:'确认进入修改',async onConfirm(wrap){const result=await saveVehicleOperation(ctx,state=>requestMonthlyPlanRevision(state,id,wrap.querySelector('[data-plan-revise-reason]').value));if(!result.ok){wrap.querySelector('[data-plan-edit-error]').textContent=result.message;return false}await afterSaved();toast('计划已进入待修改状态','请重新排程并再次提交审核')}})})
  document.querySelector('[data-plan-adjust-published]')?.addEventListener('click',event=>{const id=Number(event.currentTarget.dataset.planAdjustPublished),vehicle=ctx.state.vehicleRepairs.find(row=>row.id===id);if(!vehicle)return;openModal({title:`申请调整 · ${vehicle.locomotiveNo}`,body:'<p>已发布排程不会直接改变。确认后进入待修改状态，完成新排程后重新提交审核。</p><div class="field"><label>调整原因 *</label><textarea class="textarea" maxlength="500" data-plan-revise-reason></textarea></div><p role="alert" class="pc-error-text" data-plan-edit-error></p>',confirmText:'确认申请调整',async onConfirm(wrap){const result=await saveVehicleOperation(ctx,state=>requestMonthlyPlanAdjustment(state,id,wrap.querySelector('[data-plan-revise-reason]').value));if(!result.ok){wrap.querySelector('[data-plan-edit-error]').textContent=result.message;return false}await afterSaved();toast('已进入待修改状态','请重新排程并再次提交审核')}})})
  document.querySelector('[data-plan-edit]')?.addEventListener('click',event=>{
    const id=Number(event.currentTarget.dataset.planEdit),vehicle=ctx.state.vehicleRepairs.find(row=>row.id===id)
    if(!vehicle)return
    const field=(key,label,type='text',value=vehicle[key])=>`<div class="field"><label for="edit-${key}">${label}</label><input class="input" id="edit-${key}" data-plan-edit-field="${key}" type="${type}" value="${esc(value??'')}"></div>`
    const form=`<div class="grid grid-2">${field('locomotiveNo','机车编号')}
    <div class="field"><label for="edit-program">机型 / 修程</label><select class="select" id="edit-program" data-plan-edit-field="repairProgramId">${ctx.state.repairPrograms.filter(row=>row.status==='ENABLED').map(row=>`<option value="${row.id}" ${row.id===vehicle.repairProgramId?'selected':''}>${esc(ctx.state.locomotiveModels.find(model=>model.id===row.modelId)?.name||'')} / ${esc(row.name)}</option>`).join('')}</select></div>
    ${field('plannedEntryAt','计划入段日期','date',dateKey(vehicle.plannedEntryAt))}${field('repairSequence','修次（选填）','number')}${field('ownerBureau','配属局（选填）')}${field('ownerDepot','配属段（选填）')}${field('mileageKm','累计走行公里（选填）','text')}${field('remark','备注（选填）')}</div><p role="alert" class="pc-error-text" data-plan-edit-error></p>`
    openModal({title:`修改计划 · ${vehicle.locomotiveNo}`,wide:true,body:form,confirmText:'保存修改',async onConfirm(wrap){
      const input=Object.fromEntries([...wrap.querySelectorAll('[data-plan-edit-field]')].map(field=>[field.dataset.planEditField,field.value]))
      const result=await saveVehicleOperation(ctx,state=>editUnscheduledPlan(state,id,input))
      if(!result.ok){wrap.querySelector('[data-plan-edit-error]').textContent=result.message;return false}
      await afterSaved();toast('计划已修改','修改结果已保存到数据库')
    }})
  })
  document.querySelector('[data-plan-delete]')?.addEventListener('click',event=>{
    const id=Number(event.currentTarget.dataset.planDelete),vehicle=ctx.state.vehicleRepairs.find(row=>row.id===id)
    if(!vehicle)return
    const reason=editablePlanError(ctx.state,id)
    if(reason){
      openModal({title:'计划暂不能删除',body:`<p>计划 <strong>${esc(vehicle.locomotiveNo)}</strong> 已经进入后续流程，系统不会删除该计划。</p><p class="pc-help">${esc(reason)}</p><p class="pc-help">如需调整，请先结束当前排程或按后续调整流程处理。</p>`,confirmText:'知道了',cancelText:'关闭',onConfirm:()=>true})
      return
    }
    openModal({title:'删除未提交计划',body:`<p>确定删除 ${esc(vehicle.locomotiveNo)} 在 ${esc(dateKey(vehicle.plannedEntryAt))} 的检修计划？</p><p class="pc-help">已有排程、历史版本、接车记录或正在模拟的车辆不能删除。</p><p role="alert" class="pc-error-text" data-plan-edit-error></p>`,confirmText:'确认删除',async onConfirm(wrap){
      const result=await saveVehicleOperation(ctx,state=>deleteUnscheduledPlan(state,id))
      if(!result.ok){wrap.querySelector('[data-plan-edit-error]').textContent=result.message;return false}
      await afterSaved();toast('计划已删除')
    }})
  })
}
