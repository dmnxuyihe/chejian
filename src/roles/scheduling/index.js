import { dashboardPage } from './pages/dashboard.js'
import { ganttPage } from './pages/gantt.js'
import { workforcePage } from './pages/workforce.js'
import { resourcesPage } from './pages/resources.js'
import { exceptionsPage } from './pages/exceptions.js'
export const schedulingRole = {
  id:'scheduling', label:'生产排程 / 调度人员', short:'排', group:'智能排程', defaultPage:'dashboard',
  nav:[
    {id:'dashboard',label:'排程驾驶台',icon:'◫'},
    {id:'gantt',label:'车辆甘特图',icon:'▤'},
    {id:'workforce',label:'人员负荷',icon:'人'},
    {id:'resources',label:'工位与资源',icon:'资'},
    {id:'exceptions',label:'异常约束',icon:'!'},
  ],
  pages:{dashboard:dashboardPage,gantt:ganttPage,workforce:workforcePage,resources:resourcesPage,exceptions:exceptionsPage}
}
