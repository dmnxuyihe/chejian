import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { simulatePc1, movePc1Task } from '../src/core/pc1-simulation.js'
import { resourcesCrudPage } from '../src/roles/system-admin/pages/resources-crud.js'
import { functionHomePage, renderFunctionShell } from '../src/functions/index.js'
import { functionEntries } from '../src/functions/catalog.js'
import { renderDemoShell } from '../src/demo/index.js'

// Event-handler unit harness only: no browser layout, DOM or accessibility claims.
class Control {
  constructor(value='',dataset={}){this.value=value;this.dataset=dataset;this.events={};this.scrollLeft=30;this.scrollTop=70;this.clientWidth=900;this.offsetWidth=230}
  addEventListener(name,fn){this.events[name]=fn}
  fire(name){this.events[name]?.({target:this,currentTarget:this,preventDefault(){}})}
  focus(){this.focused=true}
}
const state=createState(),{ids}=commitImport(state,parseCsv(templateCsv))
const result=simulatePc1(state,ids,'2026-11-15T18:00:00')
assert.equal(result.ok,true)
assert.equal(result.issues.length,0)
state.pc1SchedulePreview=result.preview
const {pc1PlanningPage}=await import('../src/roles/scheduling/pages/pc1-planning.js')
const controls=new Map()
for(const name of ['toggle-inspector','close-inspector','timeline-scroll','day-width','deadline','plan-month','inspector-lock'])controls.set(`[data-pc1-${name}]`,new Control())
const second=state.pc1SchedulePreview.schedules[1]
const select=new Control('',{pc1SelectTask:String(second.id)})
controls.set(`.pc1-timeline-head .pc1-timeline-label`,new Control())
globalThis.window={scrollX:0,scrollY:50,scrollTo(){}}
globalThis.document={querySelector:selector=>controls.get(selector)||null,querySelectorAll:selector=>selector==='[data-pc1-select-task]'?[select]:[]}
let html=''
const ctx={state,demo:true,demoPersistence:{status:{message:''}},rerender(){html=pc1PlanningPage.render(ctx)}}
const business=()=>structuredClone({vehicles:state.vehicleRepairs,schedules:state.schedules,versions:state.scheduleVersions,people:state.employeeAssignments,materials:state.materials})
const before=business()
ctx.rerender();pc1PlanningPage.mount(ctx)
assert.equal((html.match(/data-pc1-drag-task=/g)||[]).length,40)
assert.ok(html.indexOf('整体排程方案')<html.indexOf('检修任务甘特图'))
assert.match(html,/>确认并提交审核<\/button>/)
assert.doesNotMatch(html,/data-pc1-confirm[^>]*disabled/)
const scheduleHtml=html
controls.get('[data-pc1-toggle-inspector]').fire('click')
assert.doesNotMatch(html,/<aside[^>]+pc1-task-inspector/)
assert.match(html,/aria-expanded="false"/)
select.fire('click')
assert.match(html,/<aside[^>]+pc1-task-inspector/)
assert.ok(html.includes(`data-task-detail-id="${second.id}"`),'selection reopens the correct task')
controls.get('[data-pc1-day-width]').value='1152'
controls.get('[data-pc1-day-width]').fire('change')
assert.match(html,/pc1-hour-scale/)
assert.equal(controls.get('[data-pc1-timeline-scroll]').scrollTop,70)
assert.ok(controls.get('[data-pc1-timeline-scroll]').scrollLeft>=0)
assert.equal(controls.get('[data-pc1-day-width]').focused,true)
assert.deepEqual(business(),before,'view controls never change formal business data')
const row=state.pc1SchedulePreview.schedules[0]
assert.equal(movePc1Task(state,row.id,new Date(new Date(row.plannedStartAt).getTime()+60000)).ok,true)
ctx.rerender()
assert.match(html,/data-pc1-confirm[^>]*disabled/,'pending changes cannot publish')
assert.match(html,/aria-describedby="pc1-plan-validation"/)
assert.match(html,/项待处理/)
const conflictHtml=html
delete state.pc1SchedulePreview
ctx.rerender()
assert.match(html,/选择检修车辆/)
assert.doesNotMatch(html,/data-pc1-confirm/)
const emptyHtml=html

const resourceState=createState(),resourceBefore=structuredClone(resourceState)
let resourceHtml=resourcesCrudPage.render({state:resourceState,role:{id:'system-admin'}})
assert.doesNotMatch(resourceHtml,/collection-heading/)
assert.match(resourceHtml,/>在岗<\/span>/)
const query=new Control(),status=new Control(),table=new Control(),count=new Control(),form=new Control()
const resourceControls=new Map([['[data-resource-query]',query],['[data-resource-status]',status],['[data-resource-table]',table],['[data-resource-count]',count],['[data-resource-search-form]',form]])
let boundEdits=[]
document.querySelector=selector=>resourceControls.get(selector)||null
document.querySelectorAll=selector=>{
  if(selector==='[data-edit]'){
    boundEdits=[...table.innerHTML?.matchAll(/data-edit="(\d+)"/g)||[]].map(m=>new Control('',{edit:m[1]}))
    return boundEdits
  }
  return []
}
resourcesCrudPage.mount({state:resourceState,rerender(){}})
query.value=resourceState.employees[0].no
query.fire('input')
assert.equal((table.innerHTML.match(/data-edit=/g)||[]).length,1)
assert.equal(boundEdits[0].dataset.edit,String(resourceState.employees[0].id))
assert.equal(typeof boundEdits[0].events.click,'function','filtered rows retain edit handlers')
status.value='INACTIVE';status.fire('change')
assert.match(table.innerHTML,/没有匹配的记录/)
assert.equal(boundEdits.length,0,'old row actions disappear with the filtered-out rows')
query.value='';status.value='';form.fire('submit')
assert.equal(boundEdits.length,resourceState.employees.length)
query.value='<script>alert(1)</script>';query.fire('input')
resourceHtml=resourcesCrudPage.render({state:resourceState,role:{id:'system-admin'}})
assert.ok(resourceHtml.includes('&lt;script&gt;'))
assert.ok(!resourceHtml.includes('<script>alert(1)</script>'))
assert.deepEqual(resourceState,resourceBefore,'search and display do not mutate resources')
query.value='';query.fire('input')
resourceHtml=resourcesCrudPage.render({state:resourceState,role:{id:'system-admin'}})

const out='test-artifacts/workspace-layout'
await mkdir(out,{recursive:true})
const entry=functionEntries.find(e=>e.id==='schedule')
for(const [name,body] of Object.entries({schedule:renderFunctionShell({entry,pageHtml:scheduleHtml}),demo:renderDemoShell({id:'schedule',pageHtml:scheduleHtml}),conflict:renderFunctionShell({entry,pageHtml:conflictHtml}),selection:renderFunctionShell({entry,pageHtml:emptyHtml}),resources:renderFunctionShell({entry:functionEntries.find(e=>e.id==='resources'),pageHtml:resourceHtml}),home:functionHomePage.render()}))await writeFile(`${out}/${name}.html`,body)
const report={passed:true,kind:'render and event-handler unit checks',checks:['40-task render','plan/task action separation','inspector close and selection reopen','hour zoom and scroll preservation in unit harness','formal data unchanged','unvalidated change blocks publication','pre-simulation selection','resource search and status intersection','filtered row action identity','safe escaping','function and demo shells'],limitations:['No browser rendering, pointer interaction or real-user verification; local browser control is disabled.']}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
