import { createState } from '../src/core/state.js'
import { runAutoSchedule } from '../src/core/actions.js'

const state=createState()
const result=runAutoSchedule(state)
const scheduleByTask=new Map(state.schedules.map(s=>[s.taskId,s]))
const ms=v=>new Date(v).getTime()
const overlaps=(a,b)=>ms(a.plannedStartAt)<ms(b.plannedEndAt)&&ms(b.plannedStartAt)<ms(a.plannedEndAt)
const errors=[]

for(const d of state.dependencies){
  const p=scheduleByTask.get(d.parentTaskId),c=scheduleByTask.get(d.childTaskId)
  if(!p||!c) continue
  if(ms(c.plannedStartAt)<ms(p.plannedEndAt)+(d.lagMinutes||0)*60000) errors.push(`FS violation ${d.parentTaskId}->${d.childTaskId}`)
}

for(const emp of state.employees){
  const rows=state.employeeAssignments.filter(a=>a.employeeId===emp.id&&a.status!=='CANCELLED').map(a=>state.schedules.find(s=>s.id===a.scheduleTaskId)).filter(Boolean)
  for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) if(overlaps(rows[i],rows[j])) errors.push(`employee overlap ${emp.name}`)
}

for(const eq of state.equipment){
  const rows=state.equipmentAssignments.filter(a=>a.equipmentId===eq.id&&a.status!=='CANCELLED')
  for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) if(ms(rows[i].startAt)<ms(rows[j].endAt)&&ms(rows[j].startAt)<ms(rows[i].endAt)) errors.push(`equipment overlap ${eq.name}`)
}

for(const req of state.teamRequirements){
  const s=scheduleByTask.get(req.taskId); if(!s) continue
  const count=state.employeeAssignments.filter(a=>a.scheduleTaskId===s.id&&a.status!=='CANCELLED'&&state.employees.find(e=>e.id===a.employeeId)?.teamId===req.teamId).length
  if(count<req.headcount) errors.push(`team shortage task ${req.taskId}`)
}

for(const req of state.componentRequirements){
  const s=scheduleByTask.get(req.taskId); if(!s) continue
  const count=state.componentAssignments.filter(a=>a.scheduleTaskId===s.id&&a.status!=='CANCELLED'&&state.componentInstances.find(c=>c.id===a.componentInstanceId)?.typeId===req.componentTypeId).length
  if(count<req.quantity) errors.push(`component shortage task ${req.taskId}`)
}

const report={passed:errors.length===0, generatedVersion:result.versionNo, exceptionCount:result.exceptionCount, checks:{dependencies:state.dependencies.length,employees:state.employees.length,equipment:state.equipment.length,teamRequirements:state.teamRequirements.length,componentRequirements:state.componentRequirements.length}, errors}
console.log(JSON.stringify(report,null,2))
if(errors.length) process.exit(1)
