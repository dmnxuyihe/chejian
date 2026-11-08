import { roles } from '../roles/index.js'
import { demoRoute } from '../demo/index.js'

// Source folders are implementation details; the public navigation uses functions.
export const functionGroups = [
  {id:'plans',label:'检修计划',icon:'calendar',hint:'年度计划、计划导入、月度日历与交验统计'},
  {id:'schedule',label:'检修排程',icon:'schedule',hint:'模拟排程、时间调整、锁定与任务发布'},
  {id:'execution',label:'现场作业',icon:'worker',hint:'任务派工、检修作业与数据记录'},
  {id:'quality',label:'质量与验收',icon:'inspection',hint:'检查、验收、审批与质量追溯'},
  {id:'process',label:'工艺配置',icon:'wrench',hint:'修程、工序、资源绑定与技术资料'},
  {id:'components',label:'配件管理',icon:'package',hint:'配件档案、库存与检修周转'},
  {id:'materials',label:'物料仓储',icon:'warehouse',hint:'物料库存、领料、备料与出入库'},
  {id:'assets',label:'工具与设备',icon:'equipment',hint:'工具字典、设备台账与维护'},
  {id:'monitor',label:'车间管控',icon:'chart',hint:'单车查询、车间日历与检修进度'},
  {id:'service',label:'安全与服务',icon:'shield',hint:'安全监控、售后与回访'},
  {id:'settings',label:'基础配置',icon:'settings',hint:'基础资源、组织、账号与权限配置'},
]
const groupForSource={planning:'plans',scheduling:'schedule',foreman:'execution',worker:'execution',approval:'quality',inspector:'quality',acceptance:'quality','delivery-foreman':'quality','quality-management':'quality',technical:'process','component-management':'components','material-warehouse':'materials','tool-management':'assets','equipment-management':'assets','workshop-management':'monitor','safety-management':'service','after-sales':'service','system-admin':'settings'}
const shortLabels={
  'planning/plans':'计划导入与管理','planning/g2-p2':'月度计划日历',
  'planning/monthly-stats':'月度计划交验统计',
  'planning/annual-plan':'年度计划管理','planning/annual-stats':'年计划交验统计',
  'planning/component-down-plan':'配件下车计划','planning/component-up-plan':'配件上车计划',
  'planning/temporary-repair':'整车临修计划',
  'planning/planning-completion':'计划完善与统计',
  'approval/monthly-plan-approval':'月度计划审核审批','approval/vehicle-temp-approval':'整车临修审核审批','approval/component-temp-approval':'配件临修审核发布',
  'technical/component-temporary':'配件临修计划',
  'scheduling/dashboard':'检修排程','scheduling/gantt':'任务发布与下发',
  'scheduling/workforce':'单车查询','scheduling/workshop-calendar':'车间日历',
  'scheduling/exceptions':'执行跟踪','foreman/team-tasks':'任务派工与人员调整',
  'worker/my-tasks':'检修作业','workshop-management/control':'车间进度监控',
}
const publicIds={
  'planning/plans':'plan-import','planning/g2-p2':'monthly-calendar',
  'planning/monthly-stats':'monthly-verification',
  'planning/annual-plan':'annual-plan','planning/annual-stats':'annual-stats',
  'planning/component-down-plan':'component-down-plan','planning/component-up-plan':'component-up-plan',
  'planning/temporary-repair':'temporary-repair',
  'planning/planning-completion':'planning-completion',
  'approval/monthly-plan-approval':'monthly-plan-approval','approval/vehicle-temp-approval':'vehicle-temp-approval','approval/component-temp-approval':'component-temp-approval',
  'technical/component-temporary':'component-temporary',
  'scheduling/dashboard':'schedule','scheduling/gantt':'dispatch','scheduling/workforce':'vehicle',
  'scheduling/workshop-calendar':'workshop-calendar','scheduling/exceptions':'execution-tracking',
  'foreman/team-tasks':'assignment','worker/my-tasks':'execution','inspector/inspections':'inspection','acceptance/inspections':'acceptance',
  'technical/process':'process','component-management/components':'component-register','material-warehouse/resources':'material-inventory',
  'tool-management/resources':'tool-register','equipment-management/resources':'equipment-register','workshop-management/control':'progress-monitor',
  'system-admin/dashboard':'resource-overview','system-admin/resources':'resources','system-admin/components':'component-ledger',
}
let sequence=0
export const functionEntries=Object.values(roles).flatMap(role=>role.nav.map(item=>{
  const source=`${role.id}/${item.id}`
  const group=role.id==='scheduling'&&['workforce','workshop-calendar','exceptions'].includes(item.id)?'monitor':groupForSource[role.id]
  return {id:publicIds[source]||`${group}-${++sequence}`,group,label:shortLabels[source]||item.label,section:item.section==='我的检修任务'?'检修任务':item.section,role:role.id,page:item.id,status:item.status,source}
}))
functionEntries.push({id:'vehicle-control',group:'monitor',label:'整车管控',section:'检修进度与记录',role:'scheduling',page:'control',status:'implemented',source:'scheduling/control'})
functionEntries.push({id:'station-resources',group:'settings',label:'工位与资源占用',section:'基础资源',role:'scheduling',page:'resources',status:'implemented',source:'scheduling/resources'})
export const primaryFunctions=[
  ['monthly-calendar','月度计划','calendar'],['schedule','检修排程','schedule'],
  ['vehicle','单车查询','train'],['workshop-calendar','车间日历','equipment'],['vehicle-control','整车管控','inspection'],
].map(([id,label,icon])=>({id,label,icon}))
const aliases={'planning/calendar':'monthly-calendar','scheduling/vehicle':'vehicle','scheduling/legacy-exceptions':'execution-tracking'}
export const presentationViews={schedule:'schedule',dispatch:'dispatch',vehicle:'vehicle','workshop-calendar':'workshop','vehicle-control':'control'}
export const functionPath=entry=>`functions/${entry.group}/${entry.id}`
export function functionForSource(role,page){
  const source=`${role}/${page||roles[role]?.defaultPage}`
  const direct=functionEntries.find(entry=>entry.source===source||entry.id===aliases[source])
  if(direct)return direct
  if(page==='resources')return functionEntries.find(entry=>entry.source===`${role}/resources`)||functionEntries.find(entry=>entry.source==='system-admin/resources')
  if(page==='components')return functionEntries.find(entry=>entry.source==='system-admin/components')
  return functionEntries.find(entry=>entry.role===role&&entry.status==='implemented')||functionEntries.find(entry=>entry.role===role)
}
export function functionLinks(html){
  return html.replace(/href=["']#\/(select|[a-z0-9-]+\/[a-z0-9-]+)["']/g,(full,path)=>{
    if(path==='select')return 'href="#/functions"'
    const [role,page]=path.split('/')
    const demo=role==='demo'?demoRoute(page):null
    const entry=demo?functionForSource(demo.role,demo.page):roles[role]&&functionForSource(role,page)
    return entry?`href="#/${functionPath(entry)}"`:full
  })
}
