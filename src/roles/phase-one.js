import { systemAdminRole } from './system-admin/index.js'
import { planningRole } from './planning/index.js'
import { schedulingRole } from './scheduling/index.js'
import { foremanRole } from './foreman/index.js'
import { workerRole } from './worker/index.js'
import { qualityRole } from './quality/index.js'
import { technicalRole } from './technical/index.js'
import { escapeHtml } from '../core/ui.js'

const plannedPage = (roleLabel, section, label) => ({
  implementationStatus: 'planned',
  render() {
    return `<section class="planned-page" data-test="planned-page">
      <div class="page-head"><div><div class="eyebrow">${escapeHtml(section)}</div><h1>${escapeHtml(label)}</h1><p>${escapeHtml(roleLabel)} · 第一阶段导航入口</p></div><span class="badge badge-amber">待开发</span></div>
      <div class="card planned-card">
        <div class="planned-mark">待</div>
        <div><h2>业务功能待开发</h2><p>本页已按正式导航规划建立路由。业务操作、数据保存和状态流转尚未实现，将在对应角色的后续开发阶段完成。</p></div>
      </div>
    </section>`
  },
})

const specs = [
  ['planning','计划管理人员','计',[
    ['年度检修计划',['年度计划同步与汇总','年度计划查询与交验统计']],
    ['月度检修计划',['月度计划同步与编制','月度计划日历查询']],
    ['配件月度计划',['配件下车检修计划','配件上车计划']],
    ['临修及产线计划',['整车临修计划','产线检修计划编制']],
  ]],
  ['approval','审核 / 审批人员','审',[
    ['审批中心',['月度检修计划审核审批','整车临修审核审批','配件临修审核审批','物料需求计划审核']],
  ]],
  ['scheduling','生产调度人员','调',[
    ['整车智能排程',['整车日计划编排与调整','日计划发布与任务下发','整车日计划/修程查询','生产日历与节假日配置']],
    ['配件智能排程',['配件日计划编排与查询','配件上车计划与计划查询']],
    ['产线调度与跟踪',['工序工位自动匹配','计划下发与执行跟踪']],
    ['调移车作业',['调车计划与通知']],
    ['生产电报',['开工电报','竣工电报']],
  ]],
  ['foreman','工班长 / 组长','班',[
    ['整车派工',['整车派工与人员调整','产线作业派工','派工记录查询']],
    ['配件派工',['配件检修派工']],
    ['现场交接',['配件上下车交接','必换件签收']],
  ]],
  ['worker','作业人员','作',[
    ['我的检修任务',['整车检修作业','配件检修作业']],
    ['数字化作业',['作业登销记','检修数据回填与上传','数字化工位作业指导']],
    ['领料与设备操作',['领料申请与收料确认','设备使用点检']],
  ]],
  ['inspector','专检人员','检',[
    ['作业专检',['整车检修专检','配件检修专检','产线作业质检']],
  ]],
  ['acceptance','验收人员','验',[
    ['作业验收',['整车检修验收','配件检修验收','产线作业验收']],
    ['交验与合格证',['整车竣工交验单','配件合格证','产品合格证打印']],
  ]],
  ['delivery-foreman','交车工长','交',[
    ['交车试验',['接车与下台机能试验、提票','机能试验记录与数据采集']],
  ]],
  ['quality-management','质量管理人员','质',[
    ['检修记录查询',['整车检修记录','配件检修记录']],
    ['故障与返修',['故障台账及机破查询','三一不成功登记','返工返修闭环','质量提票与追溯']],
    ['质量统计分析',['机车设备故障率统计','故障提销票统计']],
  ]],
  ['technical','技术工艺人员','技',[
    ['整车工艺配置',['整车修程与工序配置','整车作业记录及资源配置','整车网络图与工位关联']],
    ['配件工艺配置',['配件修程与工序配置','配件作业记录及资源配置','配件网络图','配件目录与组装字典']],
    ['产线工艺配置',['产线工序与记录配置','产线工位、物料、工具、设备绑定']],
    ['临修与技术管理',['配件临修技术方案','文件与技术履历','工艺写实与技术改造']],
    ['质量技术支持',['JT-6故障跟踪与故障假设','软件版本管理']],
    ['必换件技术配置',['主要零部件维护及必换件模板']],
  ]],
  ['component-management','配件管理人员','配',[
    ['配件台账与追溯',['配件档案与统计','产线虚拟配件库','唯一标识与分类查询']],
    ['配件库房',['配件出入库','库房、货架与分类配置']],
    ['配件检修周转',['待修与在修配件管理','配件组装与保养','产线配件状态与装配关系']],
    ['配件业务处置',['新购与调拨','报废、借用与委外修']],
    ['配件定位',['配件UWB位置监控']],
  ]],
  ['material-warehouse','物料 / 仓储人员','仓',[
    ['领料与需求计划',['领料审核处理与查询','需求计划录入、跟踪及查询']],
    ['必换件与配送',['预检录入与必换件配送','物料备料管理']],
    ['仓储出入与调拨',['出入库及单据查询','物资调出/调入及单据','退库、盘点与盈亏处理']],
    ['库存与预警',['库存与单品查询','库存/保质期预警及高低储']],
    ['物资系统对接',['物资目录与基础信息同步','需求采购与订单合同同步','库存与出库结算同步']],
    ['仓储基础配置',['仓库货位、分类和供应商配置']],
  ]],
  ['tool-management','工具管理员','工',[
    ['工具基础资料',['工具字典与工具台账','工量具台账与定检提醒']],
    ['工具流转',['工具借还与调拨']],
    ['工具生命周期',['送检、送修与报废']],
    ['工具盘点与预警',['盘点与综合预警']],
    ['智能工具设施',['智能工具柜','无人工具室']],
  ]],
  ['equipment-management','设备管理员','设',[
    ['设备资产',['设备台账管理']],
    ['设备维护',['设备故障报修及跟踪']],
    ['设备实时监控',['设备运行状态监控','设备电子看板']],
  ]],
  ['safety-management','安全管理人员','安',[
    ['安全监控总览',['异常行为识别与事件预警']],
    ['人员作业安全',['安全帽检测','吊装危险区域监测','动火灭火器检测','禁烟识别','登高安全带检测']],
  ]],
  ['after-sales','售后服务人员','售',[
    ['售后服务组织',['质保范围与售后计划','售后质量信息台账']],
    ['售后人员与配件',['售后人员管理','售后配件借用及赔付']],
    ['服务回访',['满意度调查与回访']],
  ]],
  ['workshop-management','车间管理人员','管',[
    ['生产进度监控',['机车与配件进度','视频监控']],
    ['停时分析',['整车与工序停时分析','配件停时分析']],
    ['成本分析',['单车成本分析','库存成本分析']],
    ['数字化驾驶舱',['数字孪生产线电子看板','计划执行统计分析']],
  ]],
  ['system-admin','系统管理员','系',[
    ['组织与人员',['组织机构管理','人员档案与画像']],
    ['用户与认证',['统一用户管理及账号管理','统一身份认证']],
    ['权限管理',['角色与权限配置']],
  ]],
]

const legacy = { 'system-admin':systemAdminRole, planning:planningRole, scheduling:schedulingRole, foreman:foremanRole, worker:workerRole, quality:qualityRole, technical:technicalRole }
const implementations = {
  planning:{'月度计划同步与编制':'plans','月度计划日历查询':'g2-p2'},
  scheduling:{'整车日计划编排与调整':'dashboard','日计划发布与任务下发':'gantt','整车日计划/修程查询':'workforce','生产日历与节假日配置':'workshop-calendar','工序工位自动匹配':'resources','计划下发与执行跟踪':'exceptions'},
  foreman:{'整车派工与人员调整':'team-tasks'},
  worker:{'整车检修作业':'my-tasks'},
  inspector:{'整车检修专检':'inspections'},
  acceptance:{'整车检修验收':'inspections'},
  technical:{'整车修程与工序配置':'process'},
  'component-management':{'配件档案与统计':'components'},
  'material-warehouse':{'库存与单品查询':'resources'},
  'tool-management':{'工具字典与工具台账':'resources'},
  'equipment-management':{'设备台账管理':'resources'},
}

const aliases = { inspector:qualityRole, acceptance:qualityRole, 'component-management':systemAdminRole, 'material-warehouse':systemAdminRole, 'tool-management':systemAdminRole, 'equipment-management':systemAdminRole }
const pageId = (sectionIndex, pageIndex) => `g${sectionIndex + 1}-p${pageIndex + 1}`

export const phaseOneRoles = Object.fromEntries(specs.map(([id,label,short,groups]) => {
  const source = legacy[id] || aliases[id]
  const pages = { ...(source?.pages || {}) }
  const nav = []
  groups.forEach(([section,labels],sectionIndex)=>labels.forEach((pageLabel,pageIndex)=>{
    const implementedId = implementations[id]?.[pageLabel]
    const idForPage = implementedId || pageId(sectionIndex,pageIndex)
    if (!implementedId) pages[idForPage] = plannedPage(label,section,pageLabel)
    nav.push({id:idForPage,label:pageLabel,section,icon:implementedId ? 'task' : 'list',status:implementedId ? 'implemented' : 'planned'})
  }))
  const defaultPage = nav[0].id
  return [id,{ id,label,short,group:groups[0][0],defaultPage,nav,pages }]
}))

export const roleCatalog = specs.map(([id,label,short,groups])=>({id,label,short,description:`${groups.map(([name])=>name).join('、')}`}))

