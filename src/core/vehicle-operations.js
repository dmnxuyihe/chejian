import { dateKey } from './planning-view.js'
import { formatLocalDateTime } from './derived.js'

const stamp = value => value ? new Date(value).getTime() : NaN
const terminal = new Set(['COMPLETED','FINISHED','CANCELLED','CANCELED','CLOSED'])
const fail = message => ({ ok:false, message })
function audit(state,type,text) {
  state.activityLog.unshift({id:Math.max(0,...state.activityLog.map(row=>row.id))+1,time:formatLocalDateTime(new Date()),type,text})
}
export function formalVehicleTasks(state,id) {
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(id))
  if (!vehicle || !state.scheduleVersions.some(row=>row.id===vehicle.currentVersionId && row.vehicleRepairId===vehicle.id && row.status==='PUBLISHED')) return []
  return state.schedules.filter(row=>row.vehicleRepairId===vehicle.id && row.versionId===vehicle.currentVersionId && row.status!=='CANCELLED').sort((a,b)=>stamp(a.plannedStartAt)-stamp(b.plannedStartAt)||a.id-b.id)
}
export function vehicleFacts(state,vehicle,rows,day=dateKey(new Date())) {
  const program=state.repairPrograms.find(row=>row.id===vehicle.repairProgramId)
  const model=state.locomotiveModels.find(row=>row.id===program?.modelId)
  const end=rows.length ? Math.max(...rows.map(row=>stamp(row.plannedEndAt))) : stamp(vehicle.plannedExitAt)
  const dayNumber=value=>{const key=dateKey(value);return key ? Date.parse(key+'T00:00:00Z')/86400000 : NaN}
  const start=vehicle.actualEntryAt || vehicle.plannedEntryAt
  // Midnight is an exclusive task end, consistent with the daily calendar.
  const total=Number.isFinite(end) ? Math.max(1,dayNumber(end-1)-dayNumber(vehicle.plannedEntryAt)+1) : null
  const current=dayNumber(day)-dayNumber(start)+1
  return {model:model?.name||'未填写',program:program?.name||'未填写',dayProgress:`${vehicle.actualEntryAt?'实际':'计划'}${current<1?'未入段':`第${current}天`} / ${total==null?'总天数待排程':`计划${total}天`}`}
}
export function taskTiming(row,now=new Date()) {
  const started=stamp(row.actualStartAt),ended=stamp(row.actualEndAt),clock=stamp(now)
  return {
    workMinutes:Number.isFinite(started) && (row.status!=='COMPLETED'||Number.isFinite(ended))?Math.max(0,((Number.isFinite(ended)?ended:clock)-started)/60000):null,
    overdueMinutes:row.status!=='COMPLETED' && clock>stamp(row.plannedEndAt)?Math.ceil((clock-stamp(row.plannedEndAt))/60000):0,
    lateMinutes:row.status==='COMPLETED' && ended>stamp(row.plannedEndAt)?Math.floor((ended-stamp(row.plannedEndAt))/60000):0,
  }
}
export function milestoneError(vehicle,entry,stand,rows) {
  if (entry!=null && !Number.isFinite(stamp(entry))) return '实际入段时间无效'
  if (stand!=null && (!Number.isFinite(stamp(stand)) || !entry)) return '上台前必须先记录实际入段时间'
  if (stand && stamp(stand)<stamp(entry)) return '上台时间不能早于实际入段时间'
  if (vehicle.actualExitAt && entry && stamp(vehicle.actualExitAt)<stamp(stand||entry)) return '入段、上台时间不能晚于实际出段时间'
  const starts=rows.filter(row=>row.actualStartAt).map(row=>stamp(row.actualStartAt))
  if (starts.length && (!entry || stamp(entry)>Math.min(...starts) || (stand && stamp(stand)>Math.min(...starts)))) return '入段、上台时间不能晚于已记录的首次作业时间，且作业后不能清空入段时间'
  return ''
}
export function recordVehicleMilestones(state,id,input,now=new Date()) {
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(id))
  if (!vehicle || terminal.has(vehicle.status)) return fail('该车辆不存在或已结束检修')
  const entry=input.actualEntryAt?formatLocalDateTime(input.actualEntryAt):null
  const stand=input.onStandAt?formatLocalDateTime(input.onStandAt):null
  const rows=state.schedules.filter(row=>row.vehicleRepairId===vehicle.id)
  const error=milestoneError(vehicle,entry,stand,rows)
  if(error) return fail(error)
  if (!entry) return fail('请记录真实的实际入段时间')
  if ([entry,stand].some(value=>value && stamp(value)>stamp(now))) return fail('实际时间不能填写未来时间')
  const note=String(input.note||'').trim()
  if(note.length>500) return fail('说明最多500字')
  if ((vehicle.actualEntryAt && stamp(vehicle.actualEntryAt)!==stamp(entry)) || (vehicle.onStandAt && stamp(vehicle.onStandAt)!==stamp(stand))) {
    if(!note) return fail('修改已有实际时间时，请填写更正原因')
  }
  if (stamp(vehicle.actualEntryAt)===stamp(entry) && (vehicle.onStandAt||null)===stand) return {ok:true}
  vehicle.lifecycleHistory ||= []
  vehicle.lifecycleHistory.push({at:formatLocalDateTime(now),previous:{actualEntryAt:vehicle.actualEntryAt||null,onStandAt:vehicle.onStandAt||null},actualEntryAt:entry,onStandAt:stand,note})
  vehicle.actualEntryAt=entry;vehicle.onStandAt=stand
  audit(state,'接车',`${vehicle.locomotiveNo} 记录实际入段与上台时间${note?`：${note}`:''}`)
  return {ok:true}
}
export function editablePlanError(state,id) {
  const row=state.vehicleRepairs.find(row=>row.id===Number(id))
  if (!row) return '计划不存在'
  if (!['DRAFT','UNSCHEDULED'].includes(row.status) || (row.approvalStatus && row.approvalStatus!=='DRAFT') || row.actualEntryAt || row.onStandAt) return '仅未提交、未接车的计划可以修改或删除'
  if (state.schedules.some(item=>item.vehicleRepairId===row.id) || state.scheduleVersions.some(item=>item.vehicleRepairId===row.id)) return '计划已有排程或历史版本，不能直接修改或删除'
  if (state.approvalRecords.some(item=>item.vehicleRepairId===row.id) || state.pc1Dispatches?.some(item=>item.vehicleRepairId===row.id)) return '计划已有审批或下发记录，不能直接修改或删除'
  if (state.pc1SchedulePreview?.vehicleRepairIds?.includes(row.id)) return '本车正在模拟排程，请先取消模拟'
  return ''
}
export function editUnscheduledPlan(state,id,input) {
  const error=editablePlanError(state,id);if(error)return fail(error)
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(id))
  const text=key=>String(input[key]??'').trim()
  const name=text('locomotiveNo'),program=state.repairPrograms.find(row=>row.id===Number(input.repairProgramId)&&row.status==='ENABLED')
  if(!name || name.length>64 || !program) return fail('请填写64字以内车号并选择有效修程')
  const date=text('plannedEntryAt')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1900-01-01'||date>'2199-12-31'||dateKey(date+'T00:00:00')!==date) return fail('计划入段日期无效')
  const entry=date+'T'+formatLocalDateTime(vehicle.plannedEntryAt).slice(11)
  if(vehicle.plannedExitAt && stamp(entry)>=stamp(vehicle.plannedExitAt)) return fail('计划入段不能晚于原要求交车时间')
  if(state.vehicleRepairs.some(row=>row.id!==vehicle.id && row.locomotiveNo.toUpperCase()===name.toUpperCase() && row.repairProgramId===program.id && (!terminal.has(row.status)||dateKey(row.plannedEntryAt)===date))) return fail('同车同修程存在相同日期或未完成计划')
  const sequence=text('repairSequence')===''?null:Number(input.repairSequence),mileage=text('mileageKm')===''?null:Number(input.mileageKm)
  if(sequence!==null && (!Number.isSafeInteger(sequence)||sequence<1)) return fail('修次必须是正整数')
  if(mileage!==null && (!/^\d+(\.\d)?$/.test(text('mileageKm'))||mileage>99999999999.9)) return fail('公里数必须为非负数，最多一位小数')
  if(text('ownerBureau').length>64||text('ownerDepot').length>64||text('remark').length>500) return fail('配属局、配属段最多64字，备注最多500字')
  Object.assign(vehicle,{locomotiveNo:name,repairProgramId:program.id,plannedEntryAt:entry,repairSequence:sequence,mileageKm:mileage,ownerBureau:text('ownerBureau'),ownerDepot:text('ownerDepot'),remark:text('remark')})
  audit(state,'计划',`修改未提交计划 ${name}`)
  return {ok:true}
}
export function deleteUnscheduledPlan(state,id) {
  const error=editablePlanError(state,id);if(error)return fail(error)
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(id))
  state.vehicleRepairs=state.vehicleRepairs.filter(row=>row.id!==vehicle.id)
  if(state.selectedVehicleRepairId===vehicle.id)state.selectedVehicleRepairId=state.vehicleRepairs[0]?.id||null
  if(state.planningView?.resourceVehicleIds)state.planningView.resourceVehicleIds=state.planningView.resourceVehicleIds.filter(value=>value!==vehicle.id)
  audit(state,'计划',`删除未提交计划 ${vehicle.locomotiveNo}`)
  return {ok:true}
}
