import { plansPage, calendarPage } from './pages/plan-calendar.js'
export const planningRole = {
  id:'planning', label:'计划管理人员', short:'计', group:'计划管理', defaultPage:'plans',
  nav:[{id:'plans',label:'月度计划同步与编制',icon:'plan'},{id:'calendar',label:'月度计划日历查询',icon:'plan'}],
  pages:{ plans:plansPage, calendar:calendarPage, 'g2-p2':calendarPage }
}
