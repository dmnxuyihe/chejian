const cancelled = value => ['CANCELLED', 'CANCELED'].includes(String(value || '').toUpperCase())

export function monthlyPlanVehicles(state, month) {
  return (state.vehicleRepairs || []).filter(row => row.planSource !== 'ANNUAL' && !cancelled(row.status) && String(row.plannedEntryAt || '').startsWith(month))
}

const taskMapFor = (state, vehicle) => new Map((state.tasks || []).filter(row => row.repairProgramId === vehicle.repairProgramId).map(row => [row.id, row]))
const currentSchedule = (state, vehicle, taskId) => (state.schedules || []).find(row => row.vehicleRepairId === vehicle.id && row.taskId === taskId && row.versionId === vehicle.currentVersionId && !cancelled(row.status))

export function buildComponentDownPlan(state, month, filters = {}) {
  const vehicles = monthlyPlanVehicles(state, month).filter(row => !filters.vehicleId || row.id === Number(filters.vehicleId))
  const types = new Map((state.componentTypes || []).map(row => [row.id, row]))
  const groups = new Map()
  for (const vehicle of vehicles) {
    const tasks = taskMapFor(state, vehicle)
    for (const requirement of state.componentRequirements || []) {
      if (!tasks.has(requirement.taskId) || !['REMOVE', 'REPAIR'].includes(requirement.action)) continue
      if (filters.typeId && requirement.componentTypeId !== Number(filters.typeId)) continue
      const type = types.get(requirement.componentTypeId)
      const group = groups.get(requirement.componentTypeId) || { typeId: requirement.componentTypeId, name: type?.name || `配件类型${requirement.componentTypeId}`, specification: type?.specification || '—', unit: type?.unit || '件', calculated: 0, assigned: 0, vehicles: new Set(), actions: new Set() }
      group.calculated += Number(requirement.quantity) || 0
      group.vehicles.add(vehicle.locomotiveNo)
      group.actions.add(requirement.action)
      const schedule = currentSchedule(state, vehicle, requirement.taskId)
      if (schedule) group.assigned += (state.componentAssignments || []).filter(row => row.scheduleTaskId === schedule.id && row.action === requirement.action && !cancelled(row.status) && types.get(requirement.componentTypeId)?.id === (state.componentInstances || []).find(item => item.id === row.componentInstanceId)?.typeId).length
      groups.set(requirement.componentTypeId, group)
    }
  }
  return { vehicles, rows: [...groups.values()].map(row => ({ ...row, planned: row.calculated, vehicles: [...row.vehicles], actions: [...row.actions] })).sort((a, b) => a.typeId - b.typeId) }
}

const readiness = { QUALIFIED: 0, AVAILABLE: 1, REPAIRING: 2, WAIT_REPAIR: 3, INSTALLED: 4 }
const candidatesFor = (state, typeId, locomotiveNo) => (state.componentInstances || [])
  .filter(row => row.typeId === typeId && !['SCRAPPED', 'DISABLED'].includes(row.status))
  .sort((a, b) => (readiness[a.status] ?? 9) - (readiness[b.status] ?? 9) || Number(b.locomotiveNo === locomotiveNo) - Number(a.locomotiveNo === locomotiveNo) || String(a.serialNo).localeCompare(String(b.serialNo), 'zh-CN'))

export function buildComponentUpPlan(state, month, filters = {}) {
  const vehicles = monthlyPlanVehicles(state, month).filter(row => !filters.vehicleId || row.id === Number(filters.vehicleId))
  const types = new Map((state.componentTypes || []).map(row => [row.id, row]))
  const instances = new Map((state.componentInstances || []).map(row => [row.id, row]))
  const rows = []
  for (const vehicle of vehicles) {
    const tasks = taskMapFor(state, vehicle)
    for (const requirement of state.componentRequirements || []) {
      if (!tasks.has(requirement.taskId) || requirement.action !== 'INSTALL') continue
      if (filters.typeId && requirement.componentTypeId !== Number(filters.typeId)) continue
      const schedule = currentSchedule(state, vehicle, requirement.taskId)
      const assignments = schedule ? (state.componentAssignments || []).filter(row => row.scheduleTaskId === schedule.id && row.action === 'INSTALL' && !cancelled(row.status) && instances.get(row.componentInstanceId)?.typeId === requirement.componentTypeId).sort((a, b) => a.id - b.id) : []
      const candidates = candidatesFor(state, requirement.componentTypeId, vehicle.locomotiveNo)
      const used = new Set(assignments.map(row => row.componentInstanceId))
      for (let slot = 0; slot < Number(requirement.quantity || 0); slot += 1) {
        const assignment = assignments[slot]
        const assigned = assignment && instances.get(assignment.componentInstanceId)
        const recommended = assigned || candidates.find(row => !used.has(row.id)) || null
        if (recommended) used.add(recommended.id)
        rows.push({ vehicle, requirement, task: tasks.get(requirement.taskId), schedule, slot, type: types.get(requirement.componentTypeId), assignment, assigned, recommended, candidates })
      }
    }
  }
  return { vehicles, rows }
}

export function adjustInstalledComponent(state, { vehicleId, requirementId, slot, componentInstanceId }) {
  const vehicle = (state.vehicleRepairs || []).find(row => row.id === Number(vehicleId))
  const requirement = (state.componentRequirements || []).find(row => row.id === Number(requirementId) && row.action === 'INSTALL')
  const component = (state.componentInstances || []).find(row => row.id === Number(componentInstanceId))
  if (!vehicle || !requirement || !component) return { ok: false, message: '车辆、装车需求或配件不存在' }
  if (component.typeId !== requirement.componentTypeId || ['SCRAPPED', 'DISABLED'].includes(component.status)) return { ok: false, message: '所选配件类型或状态不符合装车要求' }
  const schedule = currentSchedule(state, vehicle, requirement.taskId)
  if (!schedule) return { ok: false, message: '该装车工序尚未形成当前排程，暂不能保存调整' }
  const instances = new Map((state.componentInstances || []).map(row => [row.id, row]))
  const rows = (state.componentAssignments || []).filter(row => row.scheduleTaskId === schedule.id && row.action === 'INSTALL' && !cancelled(row.status) && instances.get(row.componentInstanceId)?.typeId === requirement.componentTypeId).sort((a, b) => a.id - b.id)
  const current = rows[Number(slot)]
  if (rows.some(row => row !== current && row.componentInstanceId === component.id)) return { ok: false, message: '同一装车工序不能重复使用同一件配件' }
  if (current) Object.assign(current, { componentInstanceId: component.id, source: 'MANUAL', status: 'ASSIGNED' })
  else (state.componentAssignments ||= []).push({ id: Math.max(0, ...state.componentAssignments.map(row => Number(row.id) || 0)) + 1, scheduleTaskId: schedule.id, componentInstanceId: component.id, action: 'INSTALL', source: 'MANUAL', status: 'ASSIGNED' })
  return { ok: true }
}
