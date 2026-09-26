export const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export const fmtFullDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export const minutesBetween = (start, end) => Math.max(0, (new Date(end) - new Date(start)) / 60000)
export const addMinutes = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString().slice(0,19)

export function taskOf(state, taskId) { return state.tasks.find(t => t.id === Number(taskId)) }
export function scheduleOf(state, scheduleTaskId) { return state.schedules.find(s => s.id === Number(scheduleTaskId)) }
export function employeeOf(state, employeeId) { return state.employees.find(e => e.id === Number(employeeId)) }
export function workstationOf(state, workstationId) { return state.workstations.find(w => w.id === Number(workstationId)) }
export function componentTypeOf(state, typeId) { return state.componentTypes.find(c => c.id === Number(typeId)) }
export function componentOf(state, instanceId) { return state.componentInstances.find(c => c.id === Number(instanceId)) }

export function assignmentsForSchedule(state, scheduleTaskId) {
  return state.employeeAssignments.filter(a => a.scheduleTaskId === Number(scheduleTaskId) && a.status !== 'CANCELLED')
}

export function equipmentForSchedule(state, scheduleTaskId) {
  return state.equipmentAssignments.filter(a => a.scheduleTaskId === Number(scheduleTaskId) && a.status !== 'CANCELLED')
}

export function componentsForSchedule(state, scheduleTaskId) {
  return state.componentAssignments.filter(a => a.scheduleTaskId === Number(scheduleTaskId) && a.status !== 'CANCELLED')
}

export function employeeLoad(state, employeeId) {
  const rows = state.employeeAssignments.filter(a => a.employeeId === Number(employeeId) && a.status !== 'CANCELLED')
  return rows.reduce((sum,a) => {
    const s = scheduleOf(state,a.scheduleTaskId)
    return sum + (s ? minutesBetween(s.plannedStartAt,s.plannedEndAt) : 0)
  },0)
}

export function employeeTasks(state, employeeId) {
  return state.employeeAssignments
    .filter(a => a.employeeId === Number(employeeId) && a.status !== 'CANCELLED')
    .map(a => {
      const schedule = scheduleOf(state,a.scheduleTaskId)
      return { assignment:a, schedule, task: schedule ? taskOf(state,schedule.taskId) : null }
    })
    .filter(x => x.schedule && x.task)
    .sort((a,b) => new Date(a.schedule.plannedStartAt)-new Date(b.schedule.plannedStartAt))
}

export function componentStats(state) {
  return state.componentTypes.map(type => {
    const instances = state.componentInstances.filter(i => i.typeId === type.id)
    return {
      ...type,
      total: instances.length,
      available: instances.filter(i => ['AVAILABLE','QUALIFIED'].includes(i.status)).length,
      repairing: instances.filter(i => ['WAIT_REPAIR','REPAIRING'].includes(i.status)).length,
      installed: instances.filter(i => i.status === 'INSTALLED').length,
    }
  })
}

export function taskStatusLabel(status) {
  return ({ NOT_STARTED:'未开始', IN_PROGRESS:'进行中', COMPLETED:'已完成', CANCELLED:'已取消' })[status] || status
}

export function statusBadge(status) {
  if (['COMPLETED','AVAILABLE','QUALIFIED','PASS','APPROVED','ACTIVE','ENABLED'].includes(status)) return 'badge-green'
  if (['IN_PROGRESS','REPAIRING','ASSIGNED','SCHEDULED'].includes(status)) return 'badge-indigo'
  if (['WAIT_REPAIR','PENDING','NOT_STARTED','DRAFT'].includes(status)) return 'badge-amber'
  if (['FAILED','SCRAPPED','CANCELLED','DISABLED'].includes(status)) return 'badge-red'
  return 'badge-slate'
}

export function processTaskRows(state) {
  return state.tasks.map(task => {
    const schedule = state.schedules.find(s => s.taskId === task.id)
    const assignments = schedule ? assignmentsForSchedule(state,schedule.id) : []
    return { task, schedule, assignments }
  })
}
