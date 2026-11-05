import { functionEntries } from './catalog.js'

// Navigation is independent of source modules and legacy URLs.
// These four routes share ledger implementations; retain every route.
export const navigationAliases = {
  'material-inventory':'resources',
  'equipment-register':'resources',
  'component-register':'component-ledger',
}
export const navigationGroups = [
  {id:'planning',label:'计划与排程',icon:'calendar',entries:['monthly-calendar','plan-import','schedule','dispatch']},
  {id:'operations',label:'作业与验收',icon:'worker',entries:['assignment','execution','inspection','acceptance']},
  {id:'monitoring',label:'查询与管控',icon:'chart',entries:['vehicle','workshop-calendar','vehicle-control','execution-tracking','progress-monitor']},
  {id:'resources',label:'资源台账',icon:'package',entries:['resources','tool-register','component-ledger','station-resources','resource-overview']},
  {id:'process',label:'工艺配置',icon:'wrench',entries:['process']},
]
const labels = {
  'monthly-calendar':'月度计划', 'plan-import':'计划导入', dispatch:'任务下发',
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
