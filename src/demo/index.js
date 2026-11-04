import { escapeHtml as esc } from '../core/ui.js'
import { icon } from '../shared/icons.js'

// One presentation workflow over the existing pages and database.
export const demoFunctions = [
  { id:'calendar', label:'月度计划', number:'01', role:'planning', page:'g2-p2', hint:'查看月度日历，区分计划入段与已排出段。' },
  { id:'schedule', label:'检修排程', number:'02', role:'scheduling', page:'dashboard', hint:'选择相邻日期两辆机车，模拟、调整、锁定并确认 C5 构架与轮驱排程。' },
  { id:'vehicle', label:'单车查询', number:'03', role:'scheduling', page:'workforce', hint:'查看单车每日任务、甘特图和人员、工具、物料清单。' },
  { id:'workshop', label:'车间日历', number:'04', role:'scheduling', page:'workshop-calendar', hint:'在同一份日历中查看两辆机车每天的检修任务。' },
  { id:'control', label:'整车管控', number:'05', role:'scheduling', page:'control', hint:'查看各项任务状态，以及已完成任务提交的数据、图片与视频。' },
]
const extra = {
  plans:{ id:'plans',role:'planning',page:'plans',parent:'calendar' },
  dispatch:{ id:'dispatch',role:'scheduling',page:'gantt',parent:'schedule' },
}
export function demoRoute(id='calendar') {
  return demoFunctions.find(item=>item.id===id) || extra[id] || demoFunctions[0]
}
export function demoPath(role,page) {
  const paths = {
    'planning/plans':'plans','planning/calendar':'calendar','planning/g2-p2':'calendar',
    'scheduling/dashboard':'schedule','scheduling/gantt':'dispatch','scheduling/workforce':'vehicle',
    'scheduling/vehicle':'vehicle','scheduling/control':'control','scheduling/exceptions':'control',
    'scheduling/workshop-calendar':'workshop',
  }
  return `demo/${paths[`${role}/${page}`] || 'calendar'}`
}
export function demoLinks(html) {
  return html.replace(/href="#\/(planning|scheduling)\/([a-z0-9-]+)"/g,(_,role,page)=>`href="#/${demoPath(role,page)}"`)
}
export function renderDemoShell({id,pageHtml}) {
  const route=demoRoute(id),active=route.parent||route.id
  const glyphs={calendar:'calendar',schedule:'schedule',vehicle:'train',workshop:'equipment',control:'inspection'}
  return `<div class="app-shell workspace-shell pc1-shell demo-shell demo-page-${esc(active)}" data-demo-shell>
    <a class="skip-content" href="#main-content" data-skip-content>跳到展示内容</a>
    <div class="main-column">
      <header class="topbar demo-topbar">
        <a class="demo-brand" href="#/demo/calendar"><span aria-hidden="true">${icon('train',23)}</span>智能检修</a>
        <nav class="demo-nav" aria-label="演示功能">${demoFunctions.map(item=>`<a href="#/demo/${item.id}" ${item.id===active?'aria-current="page" class="active"':''}><span class="demo-function-glyph" aria-hidden="true">${icon(glyphs[item.id],19)}</span><span class="demo-nav-copy"><strong>${item.label}</strong></span></a>`).join('')}</nav>
        <button type="button" class="btn btn-icon btn-sm" data-theme-toggle aria-label="切换明暗主题" title="切换明暗主题">${icon('theme',17)}</button>
      </header>
      <main class="content demo-content" id="main-content" tabindex="-1" data-test="page-content">${demoLinks(pageHtml)}</main>
    </div>
  </div>`
}
