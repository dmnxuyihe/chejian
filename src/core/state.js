import { teams, employees, employeeLeaves, workstations, equipment, componentTypes, componentInstances, workCalendar } from '../data/resources.js'
import { tools, materials, spareParts } from '../data/simple-resources.js'
import { repairPrograms, locomotiveModels, tasks, dependencies, teamRequirements, equipmentRequirements, componentRequirements, taskStepHints } from '../data/process.js'
import { vehicleRepairs, scheduleVersions, schedules, initialEmployeeAssignments, initialEquipmentAssignments, initialComponentAssignments, initialExceptions } from '../data/schedule.js'

const clone = (v) => structuredClone(v)

export function createState() {
  return {
    demoClock: '2026-10-01T08:00:00',
    selectedWorkerId: 1,
    selectedTeamId: 1,
    published: true,
    lastScheduleRunAt: '2026-09-23T19:30:00',
    teams: clone(teams),
    employees: clone(employees),
    employeeLeaves: clone(employeeLeaves),
    workstations: clone(workstations),
    equipment: clone(equipment),
    tools: clone(tools),
    materials: clone(materials),
    spareParts: clone(spareParts),
    componentTypes: clone(componentTypes),
    componentInstances: clone(componentInstances),
    workCalendar: clone(workCalendar),
    repairPrograms: clone(repairPrograms),
    locomotiveModels: clone(locomotiveModels),
    tasks: clone(tasks),
    dependencies: clone(dependencies),
    teamRequirements: clone(teamRequirements),
    equipmentRequirements: clone(equipmentRequirements),
    componentRequirements: clone(componentRequirements),
    taskStepHints: clone(taskStepHints),
    vehicleRepairs: clone(vehicleRepairs),
    scheduleVersions: clone(scheduleVersions),
    schedules: clone(schedules),
    employeeAssignments: clone(initialEmployeeAssignments),
    equipmentAssignments: clone(initialEquipmentAssignments),
    componentAssignments: clone(initialComponentAssignments),
    exceptions: clone(initialExceptions),
    qualityRecords: [],
    activityLog: [
      { id: 1, time: '2026-09-23 19:30', type: '系统', text: '初始化构架与轮驱排程数据' },
      { id: 2, time: '2026-09-23 19:30', type: '配件', text: '补充配件类型、实例和排程占用演示数据' },
    ],
  }
}
