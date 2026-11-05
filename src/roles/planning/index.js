import { plansPage, calendarPage } from './pages/plan-calendar.js'
import { annualPlanPage, annualStatsPage } from './pages/annual.js'
import { componentDownPlanPage, componentUpPlanPage } from './pages/component-monthly.js'
import { temporaryRepairPage } from './pages/temporary-repair.js'
import { planningCompletionPage } from './pages/planning-completion.js'
import { monthlyVerificationPage } from './pages/monthly-verification-v4.js'
export const planningRole = {
  id:'planning', label:'计划管理人员', short:'计', group:'计划管理', defaultPage:'plans',
  nav:[{id:'plans',label:'月度计划同步与编制',icon:'plan'},{id:'calendar',label:'月度计划日历查询',icon:'plan'},{id:'monthly-stats',label:'月度计划交验统计',icon:'chart'},{id:'annual-plan',label:'年度计划管理',icon:'plan'},{id:'annual-stats',label:'年计划交验统计',icon:'chart'}],
  pages:{ plans:plansPage, calendar:calendarPage, 'g2-p2':calendarPage, 'monthly-stats':monthlyVerificationPage, 'annual-plan':annualPlanPage, 'annual-stats':annualStatsPage, 'component-down-plan':componentDownPlanPage, 'component-up-plan':componentUpPlanPage, 'temporary-repair':temporaryRepairPage, 'planning-completion':planningCompletionPage }
}
