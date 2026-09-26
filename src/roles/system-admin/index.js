import { dashboardPage } from './pages/dashboard.js'
import { resourcesPage } from './pages/resources.js'
import { componentsPage } from './pages/components.js'

export const systemAdminRole = {
  id:'system-admin', label:'系统管理员', short:'系', group:'基础资源', defaultPage:'dashboard',
  nav:[
    {id:'dashboard',label:'资源总览',icon:'dashboard'},
    {id:'resources',label:'基础资源',icon:'resource'},
    {id:'components',label:'配件台账',icon:'component'},
  ],
  pages:{ dashboard:dashboardPage, resources:resourcesPage, components:componentsPage }
}
