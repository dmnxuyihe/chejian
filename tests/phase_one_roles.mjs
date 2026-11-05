import assert from 'node:assert/strict'
import { roles, roleCatalog } from '../src/roles/index.js'

const roleList=Object.values(roles)
assert.equal(roleList.length,18,'角色数量应为18')
assert.equal(roleCatalog.length,18,'角色入口数量应为18')
assert.equal(new Set(roleCatalog.map(r=>r.id)).size,18,'角色ID必须唯一')
const requirementNav = role => role.nav.filter(item=>!item.utility)
assert.equal(roleList.reduce((sum,role)=>sum+new Set(requirementNav(role).map(item=>item.section)).size,0),60,'需求表一级功能区数量应为60')
assert.equal(roleList.reduce((sum,role)=>sum+requirementNav(role).length,0),130,'原129项页面加新增独立交验统计入口，共130项')
assert.equal(roles['system-admin'].defaultPage,'resources','系统管理员应默认进入已实现的基础资源管理')
for (const id of ['dashboard','resources','components']) {
  assert.equal(roles['system-admin'].nav.find(item=>item.id===id)?.status,'implemented',`管理员缺少已完成入口${id}`)
  assert.notEqual(roles['system-admin'].pages[id].implementationStatus,'planned')
}

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
assert.equal(roles.approval.pages[roles.approval.defaultPage].implementationStatus,undefined,'月度审批入口已实现')
assert.equal(roles.approval.pages['g1-p4'].implementationStatus,'planned','未实现的物料审批仍须标记为待开发')

const implementedEntries = roleList.reduce((sum, role) => sum + role.nav.filter(n => n.status === 'implemented').length, 0)
assert.equal(roles.planning.pages['g2-p2'].implementationStatus,undefined,'月度查询入口应接入实际日历')
const secondaryPages=roleList.reduce((sum,role)=>sum+role.nav.length,0)
console.log(JSON.stringify({passed:true,roles:18,requirementPrimaryAreas:60,requirementPages:130,utilityPages:secondaryPages-130,secondaryPages,implementedEntries,plannedEntries:secondaryPages-implementedEntries},null,2))
