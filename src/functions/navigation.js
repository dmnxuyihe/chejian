import { functionEntries } from './catalog.js'
import { requirementNames,requirementEntryNames } from './requirement-names.js'

export const withheldPlanEntries = new Set(['annual-plan','annual-stats','monthly-verification','component-down-plan','component-up-plan','temporary-repair','planning-completion','component-temporary','monthly-plan-approval','vehicle-temp-approval','component-temp-approval'])

// Navigation is independent of source modules and legacy URLs.
// These four routes share ledger implementations; retain every route.
export const navigationAliases = {
  'annual-stats':'annual-plan',
  'plan-import':'monthly-calendar',
  'monthly-verification':'monthly-calendar',
  'component-up-plan':'component-down-plan',
  'material-inventory':'resources',
  'equipment-register':'resources',
  'component-register':'component-ledger',
  'progress-monitor':'vehicle-control',
}
export const navigationGroups = [
  {id:'planning',...requirementNames.monthly,icon:'calendar',entries:['monthly-calendar']},
  {id:'production',...requirementNames.production,icon:'schedule',entries:['schedule','dispatch','workshop-calendar','vehicle','vehicle-control']},
  {id:'operations',...requirementNames.work,icon:'worker',entries:['process','assignment','execution','inspection','acceptance']},
  {id:'components',...requirementNames.components,icon:'package',entries:['component-ledger']},
  {id:'tools',...requirementNames.tools,icon:'wrench',entries:['tool-register']},
  {id:'digital',...requirementNames.digital,icon:'chart',entries:['execution-tracking']},
  // Supporting pages have no single counterpart in the requirements table.
  {id:'resources',label:'基础资源',icon:'settings',supporting:true,entries:['resources','station-resources','resource-overview']},
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
export const navigationLabel = entry => requirementEntryNames[navigationId(entry)]?.label || labels[navigationId(entry)] || entry?.label || ''
export const navigationGroup = entry => navigationGroups.find(group=>group.entries.includes(navigationId(entry)))
export const navigationEntries = group => group.entries.map(id=>functionEntries.find(entry=>entry.id===id&&entry.status==='implemented')).filter(Boolean)
export const navigationSearchText = entry => [entry.label,navigationLabel(entry),...functionEntries.filter(alias=>navigationId(alias)===entry.id).map(alias=>alias.label),entry.id==='resources'?'人员 班组 工位 设备 物料 备件':'',entry.id==='tool-register'?'借还 调拨 送检 送修 遗失 报废 盘点 RFID 工具柜 无人工具室 字典 分类 套装 审核 检定 预警':''].join(' ')
