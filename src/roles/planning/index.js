import { plansCrudPage as plansPage } from './pages/plans-crud.js'
export const planningRole = {
  id:'planning', label:'计划管理人员', short:'计', group:'计划管理', defaultPage:'plans',
  nav:[{id:'plans',label:'检修计划',icon:'plan'}],
  pages:{ plans:plansPage }
}
