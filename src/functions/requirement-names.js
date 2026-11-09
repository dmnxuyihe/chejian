// Names copied from 高级修检修车间信息化需求.xlsx / Sheet1.
// Strip only the table's numbering and layout whitespace, not business wording.
export const requirementNames={
 monthly:{label:'月度检修计划管理',cell:'B6'},
 production:{label:'生产调度',cell:'A17'},
 work:{label:'作业管理',cell:'A37'},
 components:{label:'配件管理',cell:'A90'},
 tools:{label:'工具管理',cell:'A156'},
 digital:{label:'数字化产线管控管理',cell:'A180'},
}
export const requirementEntryNames={
 'monthly-calendar':{...requirementNames.monthly,rows:[6,7,8,9,10]},
 schedule:{label:'整车日计划编制',cell:'C17',rows:[17,18]},
 dispatch:{label:'整车日计划发布',cell:'C19'},
 'workshop-calendar':{label:'整车日计划查询',cell:'C20'},
 vehicle:{label:'整车计划查询',cell:'C21'},
 'vehicle-control':{label:'机车检修进度监控',cell:'C29'},
 'progress-monitor':{label:'机车检修进度监控',cell:'C29'},
 process:{label:'作业流程及标准配置',cell:'B37'},
 assignment:{label:'整车检修作业-工班长',cell:'C54'},
 execution:{label:'整车检修作业-班组作业人员',cell:'C55'},
 inspection:{label:'整车检修作业-专检',cell:'C56'},
 acceptance:{label:'整车检修作业-验收',cell:'C57'},
 'component-ledger':{label:'配件台账',cell:'B90'},
 'tool-register':{...requirementNames.tools,rows:[156,157,158,159,160,161,162,163,164,165,166,211]},
 'execution-tracking':{label:'计划下发与执行跟踪',cell:'C189'},
}
