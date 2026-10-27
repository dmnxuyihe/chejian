// Maps the application's existing camelCase state to the 30 table definitions
// in docs/数据库.xlsx. Database column names remain the canonical storage names.
const tableRows = [
  ['team','teams','team_id',{team_id:'id',team_name:'name'}],
  ['employee','employees','employee_id',{employee_id:'id',employee_no:'no',employee_name:'name'}],
  ['employee_leave','employeeLeaves','leave_id',{leave_id:'id'}],
  ['tool','tools','tool_id',{tool_id:'id',tool_code:'code',tool_name:'name'}],
  ['spare_part','spareParts','part_id',{part_id:'id',part_code:'code',part_name:'name',wastage_tate:'wastageRate'}],
  ['material','materials','material_id',{material_id:'id',material_code:'code',material_name:'name'}],
  ['workstation','workstations','workstation_id',{workstation_id:'id',workstation_code:'code',workstation_name:'name',production_line:'line'}],
  ['locomotive_model','locomotiveModels','model_id',{model_id:'id',model_code:'code',model_name:'name'}],
  ['repair_program','repairPrograms','repair_program_id',{repair_program_id:'id',repair_program_code:'code',repair_program_name:'name'}],
  ['maintenance_task','tasks','task_id',{task_id:'id',task_name:'name',standard_duration_min:'duration',sequence_no:'sequence'}],
  ['task_dependency','dependencies','dependency_id',{dependency_id:'id',dependency_type:'type'}],
  ['task_team_requirement','teamRequirements','operation_id',{operation_id:'operationId'}],
  ['task_tool_requirement','toolRequirements',['task_id','tool_id']],
  ['task_part_requirement','partRequirements',['task_id','part_id']],
  ['task_material_requirement','materialRequirements',['task_id','material_id']],
  ['equipment','equipment','equipment_id',{equipment_id:'id',equipment_code:'code',equipment_name:'name',equipment_type:'type'}],
  ['task_equipment_requirement','equipmentRequirements','requirement_id',{requirement_id:'id'}],
  ['work_calendar','workCalendar','calendar_date',{calendar_date:'date',calendar_type:'type'}],
  ['vehicle_repair','vehicleRepairs','vehicle_repair_id',{vehicle_repair_id:'id'}],
  ['schedule_version','scheduleVersions','version_id',{version_id:'id'}],
  ['vehicle_repair_schedule','schedules','schedule_task_id',{schedule_task_id:'id'}],
  ['schedule_employee_assignment','employeeAssignments','assignment_id',{assignment_id:'id',assignment_source:'source'}],
  ['schedule_equipment_assignment','equipmentAssignments','allocation_id',{allocation_id:'id'}],
  ['schedule_exception','exceptions','exception_id',{exception_id:'id'}],
  ['approval_record','approvalRecords','approval_id',{approval_id:'id'}],
  ['component_type','componentTypes','component_type_id',{component_type_id:'id',component_code:'code',component_name:'name'}],
  ['component_instance','componentInstances','component_instance_id',{component_instance_id:'id',component_type_id:'typeId',serial_no:'serialNo',asset_code:'assetCode',qr_code:'qrCode',lifecycle_status:'status',current_workstation_id:'workstationId',current_locomotive_no:'locomotiveNo',location_text:'location'}],
  ['task_component_requirement','componentRequirements','requirement_id',{requirement_id:'id',component_action:'action',is_mandatory:'mandatory'}],
  ['schedule_component_assignment','componentAssignments','allocation_id',{allocation_id:'id',component_action:'action',assignment_source:'source'}],
  ['component_movement_record','componentMovements','movement_id',{movement_id:'id'}],
]
export const stateTables = tableRows.map(([table, collection, primaryKey, aliases = {}]) => ({ table, collection, primaryKey, aliases }))
export const databaseBusinessCollections = new Set(stateTables.map(row => row.collection))

export function toDatabaseStatus(table, value) {
  return table === 'schedule_version' && value === 'PUBLISHED' ? 'CURRENT' : value
}
export function fromDatabaseStatus(table, value) {
  return table === 'schedule_version' && value === 'CURRENT' ? 'PUBLISHED' : value
}
