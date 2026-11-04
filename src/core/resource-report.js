import { planningTasks } from './planning-view.js'
import { supplyCoverageTaskIds, toolRequirements as sourceTools, materialRequirements as sourceMaterials } from '../data/task-supplies.js'

const overlaps = (a,b) => a.start < b.end && b.start < a.end
const validQuantity = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
const active = row => row.status !== 'CANCELLED'
const rounded = n => Math.round(n * 1000) / 1000

// At each interval use simultaneous demand; touching endpoints do not overlap.
function capacityCheck(uses, capacity) {
  const selected = uses.filter(u => u.selected)
  const points = [...new Set(uses.filter(u=>u.timed).flatMap(u=>[u.start,u.end]))].sort((a,b)=>a-b)
  let peak = 0, gap = 0, minimum = Infinity
  const affected = new Set()
  function inspect(current, at, end) {
    if (!current.some(u=>u.selected)) return
    const available = capacity(at,end), demand = current.reduce((n,u)=>n+u.quantity,0)
    minimum = Math.min(minimum,available);peak=Math.max(peak,demand)
    if (demand>available) {gap=Math.max(gap,demand-available);current.filter(u=>u.selected).forEach(u=>affected.add(u.key))}
  }
  for(let i=0;i<points.length-1;i++)inspect(uses.filter(u=>u.timed&&u.start<points[i+1]&&u.end>points[i]),points[i],points[i+1])
  // Before scheduling, only the largest individual requirement is known. Do not
  // invent simultaneous starts or claim a completed joint resource check.
  for(const use of selected.filter(u=>!u.timed))inspect([use],null,null)
  return { peak:rounded(peak),gap:rounded(gap),available:minimum===Infinity?capacity(null,null):minimum,affected }
}

export function buildResourceReport(state, vehicleIds) {
  const ids = new Set(vehicleIds.map(Number))
  const vehicles=state.vehicleRepairs.filter(v=>ids.has(v.id)&&v.status!=='CANCELLED')
  const selectedIds=new Set(vehicles.map(v=>v.id)), issues=[]
  const tasks=new Map(state.tasks.map(t=>[t.id,t]))
  const vehicleMap=new Map(state.vehicleRepairs.map(v=>[v.id,v]))
  let incompletePlan=false
  let rows=planningTasks(state)
  for(const v of vehicles){
    const preview=state.pc1SchedulePreview
    const previewOwnsVehicle=(preview?.vehicleRepairIds||[]).map(Number).includes(v.id)
    // A preview replaces the formal plan for this vehicle. Missing preview
    // tasks remain explicit unscheduled requirements; old schedules are never borrowed.
    const sourceRows=previewOwnsVehicle
      ? (preview.schedules||[]).filter(s=>Number(s.vehicleRepairId)===v.id)
      : (state.schedules||[]).filter(s=>Number(s.vehicleRepairId)===v.id)
    const expected=state.tasks.filter(t=>t.status!=='DISABLED'&&t.repairProgramId===v.repairProgramId)
    const present=new Set(rows.filter(s=>s.vehicleRepairId===v.id).map(s=>s.taskId))
    const explicitlyCancelled=new Set(sourceRows.filter(s=>!active(s)).map(s=>s.taskId))
    // For a newly selected vehicle with no existing or preview rows, show the
    // expected resource load as unscheduled placeholders. A partial/empty
    // preview remains scoped to exactly the preview rows supplied by dispatch.
    if(!previewOwnsVehicle&&!sourceRows.length&&!present.size){
      for(const task of expected)rows.push({id:null,vehicleRepairId:v.id,taskId:task.id,plannedStartAt:null,plannedEndAt:null,planKind:'unscheduled',status:'NOT_STARTED'})
    }
    if(expected.some(t=>!present.has(t.id)&&!explicitlyCancelled.has(t.id)))incompletePlan=true
  }
  rows=rows.filter(s=>tasks.has(s.taskId)&&vehicleMap.has(s.vehicleRepairId)).map(s=>{
    const start=new Date(s.plannedStartAt).getTime(),end=new Date(s.plannedEndAt).getTime()
    const timed=!!s.plannedStartAt&&!!s.plannedEndAt&&Number.isFinite(start)&&end>start
    return {...s,key:`${s.vehicleRepairId}:${s.taskId}:${s.id??'unplanned'}`,task:tasks.get(s.taskId),vehicle:vehicleMap.get(s.vehicleRepairId),selected:selectedIds.has(s.vehicleRepairId),start,end,timed,minutes:timed?(end-start)/60000:tasks.get(s.taskId).duration}
  })
  const selectedRows=rows.filter(s=>s.selected)
  const complain=(message,row)=>issues.push({message,vehicleRepairId:row?.vehicleRepairId,taskId:row?.taskId})
  for(const row of selectedRows){
    if(!supplyCoverageTaskIds.includes(row.taskId))complain(`${row.task.name}的工具物料需求尚未核对`,row)
    if(!(row.minutes>0))complain(`${row.task.name}的工作时长尚未明确`,row)
    if(!(state.teamRequirements||[]).some(r=>r.taskId===row.taskId))complain(`${row.task.name}的用工需求尚未核对`,row)
    for(const [source,key,name] of [[sourceTools,'toolRequirements','工具'],[sourceMaterials,'materialRequirements','物料']])if((state[key]||[]).filter(r=>r.taskId===row.taskId).length<source.filter(r=>r.taskId===row.taskId).length)complain(`${row.task.name}的${name}用量资料不完整`,row)
  }
  const teamUses=[],toolUses=[],materialUses=[],personRows=[]
  for(const row of rows){
    for(const req of (state.teamRequirements||[]).filter(r=>r.taskId===row.taskId)){
      if(!Number.isInteger(req.headcount)||req.headcount<=0||!state.teams.some(t=>t.id===req.teamId)){if(row.selected)complain(`${row.task.name}的班组需求无效`,row);continue}
      const workMinutes=req.workDurationMin??row.minutes
      if(!Number.isFinite(workMinutes)||workMinutes<=0){if(row.selected)complain(`${row.task.name}的班组工作时长无效`,row)}
      teamUses.push({...row,quantity:req.headcount,teamId:req.teamId,workMinutes:Number.isFinite(workMinutes)&&workMinutes>0?workMinutes:0})
    }
    for(const [kind,collection,idField,target] of [['工具','toolRequirements','toolId',toolUses],['物料','materialRequirements','materialId',materialUses]]){
      for(const req of (state[collection]||[]).filter(r=>r.taskId===row.taskId)){
        if(!validQuantity(req.quantity)||req.quantity<=0||(kind==='工具'&&!Number.isInteger(req.quantity))){if(row.selected)complain(`${row.task.name}的${kind}需求数量无效`,row);continue}
        target.push({...row,requirementId:req.id,resourceId:req[idField],quantity:req.quantity,basis:req.quantityBasis,sourceSheet:req.sourceSheet,sourceRow:req.sourceRow})
      }
    }
    const assignments=row.planKind==='preview'?state.pc1SchedulePreview?.employeeAssignments:state.employeeAssignments
    const seen=new Set()
    for(const a of (assignments||[]).filter(a=>a.scheduleTaskId===row.id&&row.id!=null&&active(a))){
      if(a.vehicleRepairId!=null&&a.vehicleRepairId!==row.vehicleRepairId)continue
      const e=state.employees.find(e=>e.id===a.employeeId)
      if(!e||seen.has(a.employeeId)){if(row.selected)complain(`${row.task.name}的人员安排重复或人员资料缺失`,row);continue}
      seen.add(a.employeeId)
      const team=state.teams.find(t=>t.id===e.teamId)
      const unavailable=e.status!=='ACTIVE'||team?.status==='DISABLED'||(row.timed&&(state.employeeLeaves||[]).some(l=>l.employeeId===e.id&&active(l)&&overlaps(row,{start:new Date(l.startAt).getTime(),end:new Date(l.endAt).getTime()})))
      if(unavailable&&row.selected)complain(`${e.name}在${row.task.name}的作业时段不可用`,row)
      const req=state.teamRequirements.find(r=>r.taskId===row.taskId&&r.teamId===e.teamId)
      if(!req&&row.selected)complain(`${e.name}的班组与${row.task.name}的用工需求不符`,row)
      const workMinutes=req?.workDurationMin??row.minutes
      personRows.push({...row,employee:e,teamName:team?.name||'未登记班组',workMinutes:Number.isFinite(workMinutes)&&workMinutes>0?workMinutes:0,unavailable})
    }
  }
  const staffing=state.teams.filter(t=>teamUses.some(u=>u.teamId===t.id&&u.selected)).map(team=>{
    const uses=teamUses.filter(u=>u.teamId===team.id), own=uses.filter(u=>u.selected)
    const availability=(at,end)=>team.status==='DISABLED'?0:state.employees.filter(e=>e.teamId===team.id&&e.status==='ACTIVE'&&!(at!=null&&(state.employeeLeaves||[]).some(l=>l.employeeId===e.id&&active(l)&&new Date(l.startAt).getTime()<end&&new Date(l.endAt).getTime()>at))).length
    const check=capacityCheck(uses,availability)
    return {team,personMinutes:rounded(own.reduce((n,u)=>n+u.quantity*u.workMinutes,0)),...check,affectedTasks:own.filter(u=>check.affected.has(u.key))}
  })
  // Detect named-person collisions even if total team headcount is sufficient.
  for(let i=0;i<personRows.length;i++)for(let j=i+1;j<personRows.length;j++){
    const a=personRows[i],b=personRows[j]
    if((a.selected||b.selected)&&a.employee.id===b.employee.id&&a.timed&&b.timed&&overlaps(a,b))complain(`${a.employee.name}的${a.task.name}与${b.task.name}时间重叠`,a.selected?a:b)
  }
  const tools=[...new Set(toolUses.filter(u=>u.selected).map(u=>u.resourceId))].map(id=>{
    const resource=state.tools.find(t=>t.id===id)
    const stock=resource?.status==='AVAILABLE'&&validQuantity(resource.quantity)&&Number.isInteger(resource.quantity)?resource.quantity:0
    if(!resource||!validQuantity(resource.quantity)||!Number.isInteger(resource.quantity))complain(`${resource?.name||'工具'}的可用数量未登记`)
    const uses=toolUses.filter(u=>u.resourceId===id).sort((a,b)=>(a.timed?0:1)-(b.timed?0:1)||a.start-b.start||a.vehicleRepairId-b.vehicleRepairId||a.taskId-b.taskId)
    const allocated=[]
    for(const use of uses){
      const events=use.timed?allocated.filter(a=>overlaps(a,use)).flatMap(a=>[[Math.max(a.start,use.start),a.usedQuantity],[Math.min(a.end,use.end),-a.usedQuantity]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]):[]
      let busy=0,current=0;for(const [,delta]of events){current+=delta;busy=Math.max(busy,current)}
      use.usedQuantity=use.timed?Math.max(0,Math.min(use.quantity,stock-busy)):null;if(use.timed)allocated.push(use)
    }
    const check=capacityCheck(uses,()=>stock)
    return {resource,name:resource?.name||'未登记工具',unit:'件',...check,uses:uses.filter(u=>u.selected),affectedTasks:uses.filter(u=>u.selected&&check.affected.has(u.key))}
  })
  const materials=[...new Set(materialUses.filter(u=>u.selected).map(u=>u.resourceId))].map(id=>{
    const resource=state.materials.find(m=>m.id===id),uses=materialUses.filter(u=>u.resourceId===id&&u.selected)
    const total=rounded(uses.reduce((n,u)=>n+u.quantity,0)),available=resource?.status==='AVAILABLE'&&validQuantity(resource.quantity)?resource.quantity:0
    if(!resource||!validQuantity(resource.quantity)||!resource.unit)complain(`${resource?.name||'物料'}的库存数量或计量单位未登记`)
    return {resource,name:resource?.name||'未登记物料',unit:resource?.unit||'单位待确认',quantity:total,available,gap:rounded(Math.max(0,total-available)),uses,affectedTasks:total>available?uses:[]}
  })
  const people=personRows.filter(p=>p.selected)
  const pendingAssignments=teamUses.filter(u=>u.selected&&u.timed&&people.filter(p=>p.key===u.key&&p.employee.teamId===u.teamId&&!p.unavailable).length<u.quantity)
  const shortageCount=[...staffing,...tools,...materials].filter(r=>r.gap>0).length
  const unscheduled=incompletePlan||selectedRows.some(r=>!r.timed)
  return {vehicles,rows:selectedRows,staffing,people,tools,materials,issues,shortageCount,unscheduled,pendingAssignments,personMinutes:rounded(staffing.reduce((n,r)=>n+r.personMinutes,0)),assignedMinutes:rounded(people.reduce((n,p)=>n+p.workMinutes,0)),hasDemoQuantities:[...toolUses,...materialUses].some(u=>u.selected&&u.basis==='demo'),ready:selectedRows.length>0&&!shortageCount&&!issues.length&&!unscheduled&&!pendingAssignments.length}
}
