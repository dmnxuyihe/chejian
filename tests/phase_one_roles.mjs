import assert from 'node:assert/strict'
import { roles, roleCatalog } from '../src/roles/index.js'

const roleList=Object.values(roles)
assert.equal(roleList.length,18,'角色数量应为18')
assert.equal(roleCatalog.length,18,'角色入口数量应为18')
assert.equal(new Set(roleCatalog.map(r=>r.id)).size,18,'角色ID必须唯一')
assert.equal(roleList.reduce((sum,role)=>sum+new Set(role.nav.map(item=>item.section)).size,0),60,'一级功能区数量应为60')
assert.equal(roleList.reduce((sum,role)=>sum+role.nav.length,0),129,'二级页面数量应为129')

for(const role of roleList){
  assert.ok(role.pages[role.defaultPage],`${role.label}默认页不存在`)
  assert.ok(role.nav.length>0,`${role.label}缺少导航`)
  for(const item of role.nav){
    assert.ok(item.section,`${role.label}/${item.label}缺少一级功能区`)
    assert.ok(role.pages[item.id],`${role.label}/${item.label}缺少页面实现`)
    assert.ok(['implemented','planned'].includes(item.status),`${role.label}/${item.label}状态无效`)
  }
}

const required=['planning','approval','scheduling','foreman','worker','inspector','acceptance','delivery-foreman','quality-management','technical','component-management','material-warehouse','tool-management','equipment-management','safety-management','after-sales','workshop-management','system-admin']
assert.deepEqual(Object.keys(roles),required)
assert.equal(roles.scheduling.pages.dashboard.implementationStatus,undefined,'现有排程页不应被替换为占位页')
assert.equal(roles.technical.pages.process.implementationStatus,undefined,'现有工艺页不应被替换为占位页')
assert.equal(roles.approval.pages[roles.approval.defaultPage].implementationStatus,'planned','未开发页面必须明确标记')

const implementedEntries = roleList.reduce((sum, role) => sum + role.nav.filter(n => n.status === 'implemented').length, 0)
assert.equal(roles.planning.pages['g2-p2'].implementationStatus,undefined,'月度查询入口应接入实际日历')
console.log(JSON.stringify({passed:true,roles:18,primaryAreas:60,secondaryPages:129,implementedEntries,plannedEntries:129-implementedEntries},null,2))
