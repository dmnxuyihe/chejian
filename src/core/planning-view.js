// Read-only adapter shared by the monthly, vehicle and workshop views.
// The scheduling owner may supply pc1SchedulePreview without changing formal data.
export function dateKey(value) {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthDays(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const [year, m] = month.split('-').map(Number)
  if (year < 1900 || year > 2199 || m < 1 || m > 12) return []
  const first = new Date(year, m - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const count = Math.ceil((offset + new Date(year, m, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, i) => dateKey(new Date(year, m - 1, 1 - offset + i)))
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  return dateKey(new Date(y, m - 1 + delta, 1)).slice(0, 7)
}

function drawable(row) {
  return row.status !== 'CANCELLED' && Number.isFinite(new Date(row.plannedStartAt).getTime()) &&
    new Date(row.plannedEndAt) > new Date(row.plannedStartAt)
}

export function planningTasks(state, vehicleId = null) {
  const preview = state.pc1SchedulePreview
  const previewIds = new Set((preview?.vehicleRepairIds || []).map(Number))
  const rows = (state.schedules || []).filter(s => !previewIds.has(s.vehicleRepairId)).map(s => {
    const vehicle = state.vehicleRepairs.find(v => v.id === s.vehicleRepairId)
    const version = state.scheduleVersions.find(v => v.id === vehicle?.currentVersionId)
    return { ...s, planKind: version?.status === 'PUBLISHED' ? 'formal' : 'draft' }
  })
  if (preview) rows.push(...(preview.schedules || []).filter(s => previewIds.has(s.vehicleRepairId)).map(s => ({ ...s, planKind: 'preview' })))
  return rows.filter(s => drawable(s) && state.vehicleRepairs.some(v => v.id === s.vehicleRepairId) &&
    (vehicleId == null || s.vehicleRepairId === Number(vehicleId)))
    .sort((a, b) => new Date(a.plannedStartAt) - new Date(b.plannedStartAt) || a.id - b.id)
}

// A requested handover date or a pending simulation is never an "already scheduled" exit.
export function confirmedExit(state, vehicleId) {
  const vehicle = state.vehicleRepairs.find(v => v.id === Number(vehicleId))
  if (!state.scheduleVersions.some(v => v.id === vehicle?.currentVersionId && v.status === 'PUBLISHED')) return null
  const rows = state.schedules.filter(s => s.vehicleRepairId === Number(vehicleId) && drawable(s))
  return rows.length ? rows.reduce((last, s) => s.plannedEndAt > last ? s.plannedEndAt : last, rows[0].plannedEndAt) : null
}

export function tasksOnDay(rows, day) {
  const start = new Date(`${day}T00:00:00`)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  // End is exclusive: a task ending at midnight does not occupy the next day.
  return rows.filter(s => new Date(s.plannedStartAt) < end && new Date(s.plannedEndAt) > start)
}

export function plansInMonth(state, month) {
  const ids = new Set(planningTasks(state).filter(s =>
    monthDays(month).filter(d => d.startsWith(month)).some(d => tasksOnDay([s], d).length)).map(s => s.vehicleRepairId))
  return state.vehicleRepairs.filter(v => dateKey(v.plannedEntryAt).startsWith(month) ||
    dateKey(confirmedExit(state, v.id)).startsWith(month) || ids.has(v.id))
}

export function ensurePlanningView(state) {
  state.planningView ||= { tab: 'monthly', month: dateKey(state.demoClock).slice(0, 7), vehicleFilter: '', day: '' }
  return state.planningView
}
