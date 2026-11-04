import { createState } from './state.js'
import { commitImport, parseCsv, templateCsv } from './plan-import.js'
import { runAutoSchedule, submitPlan } from './actions.js'
import { exportDemoSnapshot } from './demo-persistence.js'

// Generate an isolated rehearsal file; never replace the operator's live state.
export function createResourceDemo(shortages = false) {
  const demo=createState()
  for(const key of ['vehicleRepairs','scheduleVersions','schedules','employeeAssignments','equipmentAssignments','componentAssignments','exceptions','qualityRecords','activityLog'])demo[key]=[]
  demo.demoClock='2026-10-27T08:00:00'
  const {ids}=commitImport(demo,parseCsv(templateCsv))
  for(const id of ids){submitPlan(demo,id);runAutoSchedule(demo,id)}
  demo.selectedVehicleRepairId=ids[0]
  demo.planningView={tab:'vehicle',month:'2026-10',vehicleFilter:'',day:'',resourceVehicleIds:ids}
  demo.pc1SchedulePreview={vehicleRepairIds:ids,schedules:structuredClone(demo.schedules),employeeAssignments:structuredClone(demo.employeeAssignments)}
  if(shortages){
    demo.tools.find(t=>t.id===1).quantity=0
    demo.materials.find(m=>m.name==='螺栓').quantity=20
    demo.employees.filter(e=>e.teamId===1).slice(2).forEach(e=>e.status='INACTIVE')
  }
  return exportDemoSnapshot(demo)
}
