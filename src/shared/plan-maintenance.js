import { escapeHtml as esc, openModal, toast } from '../core/ui.js'
import { dateKey } from '../core/planning-view.js'
import { editablePlanError, editUnscheduledPlan, deleteUnscheduledPlan } from '../core/vehicle-operations.js'
import { saveVehicleOperation } from './vehicle-details.js'

export function planMaintenanceActions(state,id) {
  const reason=editablePlanError(state,id)
  return `<div class="plan-maintenance-actions"><button class="btn btn-sm" type="button" data-plan-edit="${id}" ${reason?'disabled':''}>修改计划</button><button class="btn btn-sm btn-danger" type="button" data-plan-delete="${id}" ${reason?'disabled':''}>删除计划</button>${reason?`<p class="pc-help">${esc(reason)}</p>`:''}</div>`
}
export function mountPlanMaintenance(ctx,afterSaved) {
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
    openModal({title:'删除未提交计划',body:`<p>确定删除 ${esc(vehicle.locomotiveNo)} 在 ${esc(dateKey(vehicle.plannedEntryAt))} 的检修计划？</p><p class="pc-help">已有排程、历史版本、接车记录或正在模拟的车辆不能删除。</p><p role="alert" class="pc-error-text" data-plan-edit-error></p>`,confirmText:'确认删除',async onConfirm(wrap){
      const result=await saveVehicleOperation(ctx,state=>deleteUnscheduledPlan(state,id))
      if(!result.ok){wrap.querySelector('[data-plan-edit-error]').textContent=result.message;return false}
      await afterSaved();toast('计划已删除')
    }})
  })
}
