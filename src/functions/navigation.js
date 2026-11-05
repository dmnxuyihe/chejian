import { functionEntries } from './catalog.js'

// Navigation is independent of source modules and legacy URLs.
// These four routes share ledger implementations; retain every route.
export const navigationAliases = {
  'annual-stats':'annual-plan',
  'plan-import':'monthly-calendar',
  'monthly-verification':'monthly-calendar',
  'component-up-plan':'component-down-plan',
  'vehicle-temp-approval':'monthly-plan-approval',
  'component-temp-approval':'monthly-plan-approval',
  'material-inventory':'resources',
  'equipment-register':'resources',
  'component-register':'component-ledger',
}
export const navigationGroups = [
  {id:'planning',label:'计划与排程',icon:'calendar',entries:['annual-plan','monthly-calendar','component-down-plan','temporary-repair','planning-completion','schedule','dispatch']},
  {id:'operations',label:'作业与验收',icon:'worker',entries:['monthly-plan-approval','assignment','execution','inspection','acceptance']},
  {id:'monitoring',label:'查询与管控',icon:'chart',entries:['vehicle','workshop-calendar','vehicle-control','execution-tracking','progress-monitor']},
  {id:'resources',label:'资源台账',icon:'package',entries:['resources','tool-register','component-ledger','station-resources','resource-overview']},
  {id:'process',label:'工艺配置',icon:'wrench',entries:['process']},
]
const labels = {
  'annual-plan':'年度计划', 'annual-stats':'年计划交验统计', 'monthly-calendar':'月度计划', 'monthly-verification':'月度计划交验统计', 'plan-import':'计划导入', dispatch:'任务下发',
  'component-down-plan':'配件计划', 'component-up-plan':'配件上车计划',
  'temporary-repair':'整车临修计划',
  'planning-completion':'计划完善与统计', 'monthly-plan-approval':'计划审核与审批', 'vehicle-temp-approval':'整车临修审核审批', 'component-temp-approval':'配件临修审核发布', 'component-temporary':'配件临修计划',
  assignment:'任务派工', inspection:'检修专检', acceptance:'检修验收',
  resources:'基础资源台账', 'component-ledger':'配件台账',
  'tool-register':'工具管理',
  'station-resources':'工位与资源占用', process:'修程与工序',
}
export const navigationId = entry => entry?.role==='tool-management'?'tool-register':navigationAliases[entry?.id] || entry?.id
export const navigationLabel = entry => labels[navigationId(entry)] || entry?.label || ''
export const navigationGroup = entry => navigationGroups.find(group=>group.entries.includes(navigationId(entry)))
export const navigationEntries = group => group.entries.map(id=>functionEntries.find(entry=>entry.id===id&&entry.status==='implemented')).filter(Boolean)
export const navigationSearchText = entry => [entry.label,navigationLabel(entry),...functionEntries.filter(alias=>navigationId(alias)===entry.id).map(alias=>alias.label),entry.id==='resources'?'人员 班组 工位 设备 物料 备件':'',entry.id==='tool-register'?'借还 调拨 送检 送修 遗失 报废 盘点 RFID 工具柜 无人工具室':''].join(' ')
