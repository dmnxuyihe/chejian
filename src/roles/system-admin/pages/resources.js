import { pageHeader } from '../../../shared/templates.js'
import { badge, openModal, toast } from '../../../core/ui.js'
import { statusBadge } from '../../../core/derived.js'
import { addEmployee } from '../../../core/actions.js'

const tabNames = { employees:'人员', teams:'班组', workstations:'工位', equipment:'设备', materials:'物料', tools:'工具', spares:'备件' }
let activeTab = 'employees'

function employeeTable(state) {
  return `<div class="table-wrap"><table><thead><tr><th>工号</th><th>姓名</th><th>班组</th><th>状态</th></tr></thead><tbody>${state.employees.map(e=>`<tr><td class="mono">${e.no}</td><td>${e.name}</td><td>${e.teamName}</td><td>${badge(e.status,statusBadge(e.status))}</td></tr>`).join('')}</tbody></table></div>`
}
function teamTable(state) { return `<div class="table-wrap"><table><thead><tr><th>ID</th><th>班组</th><th>人数</th><th>状态</th></tr></thead><tbody>${state.teams.map(t=>`<tr><td>${t.id}</td><td>${t.name}</td><td>${state.employees.filter(e=>e.teamId===t.id).length}</td><td>${badge(t.status,'badge-green')}</td></tr>`).join('')}</tbody></table></div>` }
function workstationTable(state) { return `<div class="table-wrap"><table><thead><tr><th>编码</th><th>工位</th><th>产线</th><th>容量</th><th>状态</th></tr></thead><tbody>${state.workstations.map(w=>`<tr><td class="mono">${w.code}</td><td>${w.name}</td><td>${w.line}</td><td>${w.capacity}</td><td>${badge(w.status,'badge-green')}</td></tr>`).join('')}</tbody></table></div>` }
function equipmentTable(state) { return `<div class="table-wrap"><table><thead><tr><th>编码</th><th>设备</th><th>类型</th><th>所属工位</th><th>状态</th></tr></thead><tbody>${state.equipment.map(e=>`<tr><td class="mono">${e.code}</td><td>${e.name}</td><td>${e.type}</td><td>${state.workstations.find(w=>w.id===e.workstationId)?.name||'—'}</td><td>${badge(e.status,statusBadge(e.status))}</td></tr>`).join('')}</tbody></table></div>` }
function simpleTable(items, kind) { return `<div class="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>数量</th><th>位置</th><th>状态</th></tr></thead><tbody>${items.map(i=>`<tr><td class="mono">${i.code||'—'}</td><td>${i.name}</td><td>${i.quantity ?? 0}${i.unit?` ${i.unit}`:''}</td><td>${i.location||'—'}</td><td>${badge(i.status||'AVAILABLE','badge-green')}</td></tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">当前${kind}初始化数据为空</td></tr>`}</tbody></table></div>` }

export const resourcesPage = {
  render({ state }) {
    let content = employeeTable(state)
    if (activeTab==='teams') content = teamTable(state)
    if (activeTab==='workstations') content = workstationTable(state)
    if (activeTab==='equipment') content = equipmentTable(state)
    if (activeTab==='materials') content = simpleTable(state.materials,'物料')
    if (activeTab==='tools') content = simpleTable(state.tools,'工具')
    if (activeTab==='spares') content = simpleTable(state.spareParts,'备件')
    const addBtn = activeTab==='employees' ? '<button class="btn btn-primary" data-add-employee>新增人员</button>' : ''
    return `${pageHeader('基础资源管理','其他模块第一版只保留简单查询 / 维护能力，不展开复杂审批与库存流程。',addBtn)}
      <section class="card">
        <div class="filter-row" style="margin-bottom:18px">
          <div class="tabs">${Object.entries(tabNames).map(([id,name])=>`<button class="tab ${activeTab===id?'active':''}" data-resource-tab="${id}">${name}</button>`).join('')}</div>
        </div>
        ${content}
      </section>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-resource-tab]').forEach(b=>b.addEventListener('click',()=>{ activeTab=b.dataset.resourceTab; ctx.rerender() }))
    document.querySelector('[data-add-employee]')?.addEventListener('click',()=>{
      openModal({
        title:'新增人员',
        body:`<div class="grid grid-2"><div class="field"><label>工号</label><input class="input" data-f="no" placeholder="ZX009"></div><div class="field"><label>姓名</label><input class="input" data-f="name" placeholder="走行09"></div><div class="field"><label>班组</label><select class="select" data-f="teamId">${ctx.state.teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}</select></div></div>`,
        onConfirm(modal){
          const no=modal.querySelector('[data-f=no]').value.trim(), name=modal.querySelector('[data-f=name]').value.trim(), teamId=modal.querySelector('[data-f=teamId]').value
          if(!no||!name){ toast('无法保存','请填写工号和姓名','warning'); return false }
          addEmployee(ctx.state,{no,name,teamId}); toast('新增成功',`${name} 已加入基础人员库`); ctx.rerender()
        }
      })
    })
  }
}
