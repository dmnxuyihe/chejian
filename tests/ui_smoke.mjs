import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { roles } from '../src/roles/index.js'

const port=5187, debugPort=9237
const base=`http://127.0.0.1:${port}`
const edgeCandidates=[
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const browser=edgeCandidates.find(fs.existsSync)
if(!browser) throw new Error('未找到可用于自动化的 Microsoft Edge')

const server=spawn(process.execPath,['start.js',`--port=${port}`,'--no-open','--local-demo'],{cwd:process.cwd(),stdio:'ignore'})
const profile=path.join(os.tmpdir(),`rail-scheduler-edge-${process.pid}`)
let chrome
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function waitFor(url,timeout=15000){
  const end=Date.now()+timeout
  while(Date.now()<end){try{const r=await fetch(url);if(r.ok)return r}catch{}await delay(100)}
  throw new Error(`等待服务超时: ${url}`)
}

try{
  await waitFor(base)
  chrome=spawn(browser,[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--remote-allow-origins=*',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,
    `${base}/#/select`,
  ],{stdio:'ignore'})
  const targetResponse=await waitFor(`http://127.0.0.1:${debugPort}/json`)
  let targets=await targetResponse.json()
  for(let i=0;i<50&&!targets.some(t=>t.type==='page'&&t.url.startsWith(base));i+=1){await delay(100);targets=await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()}
  const target=targets.find(t=>t.type==='page'&&t.url.startsWith(base))
  if(!target) throw new Error('未找到应用浏览器页签')
  const ws=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  let seq=0
  const pending=new Map()
  const browserErrors=[]
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data)
    if(msg.id&&pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result)}
    if(msg.method==='Runtime.exceptionThrown') browserErrors.push(msg.params.exceptionDetails?.text||'Runtime exception')
    if(msg.method==='Log.entryAdded'&&msg.params.entry.level==='error') browserErrors.push(msg.params.entry.text)
  })
  function cdp(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))}
  async function js(expression){
    const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }
  await cdp('Runtime.enable'); await cdp('Log.enable')
  await delay(600)
  const roleCount=await js(`document.querySelectorAll('[data-role-card]').length`)
  if(roleCount!==18) throw new Error(`角色入口数量错误: ${roleCount}`)

  const routes=Object.fromEntries(Object.entries(roles).map(([id,role])=>[id,role.nav.map(item=>item.id)]))
  let pageChecks=0
  for(const [role,pages] of Object.entries(routes)){
    for(const page of pages){
      await js(`location.hash=${JSON.stringify(`#/${role}/${page}`)}`); await delay(100)
      const check=await js(`({route:window.__APP_DEBUG__.getRoute(),hasShell:!!document.querySelector('.app-shell'),text:document.querySelector('main')?.innerText?.length||0})`)
      if(!check.hasShell||check.text<10||check.route.role!==role) throw new Error(`页面渲染失败: ${role}/${page}`)
      pageChecks+=1
    }
  }

  await js(`location.hash='#/planning/plans'`); await delay(100)
  if(!await js(`(document.querySelector('[data-open-manual]')?.click(),!!document.querySelector('[data-manual-loco]'))`)) throw new Error('手动新建计划表单未打开')
  await js(`document.querySelector('[data-close-manual]')?.click()`)
  await js(`location.hash='#/scheduling/workshop-calendar'`); await delay(100)
  if(!await js(`!!document.querySelector('[data-test="workshop-calendar"]')&&!!document.querySelector('.wc-day .wc-event')`)) throw new Error('车间任务日历未展示数据库任务')
  await js(`document.querySelector('.wc-day:has(.wc-event)')?.click()`); await delay(50)
  if(!await js(`document.querySelectorAll('.wc-vehicle-list .wc-vehicle-toggle').length>0`)) throw new Error('点击日期后未展示当日车辆')
  await js(`document.querySelector('.wc-vehicle-list .wc-vehicle-toggle')?.click()`); await delay(50)
  if(!await js(`document.querySelectorAll('.wc-vehicle-tasks [data-wc-task]').length>0`)) throw new Error('车辆任务下拉未展开')
  await js(`document.querySelector('[data-wc-tab="vehicle"]')?.click()`); await delay(50)
  if(!await js(`document.querySelector('[data-wc-tab="vehicle"]')?.classList.contains('active')`)) throw new Error('未进入单车日历')
  if(!await js(`document.querySelectorAll('[data-wc-jump-day]').length===2`)) throw new Error('单车日历缺少首末任务跳转')
  await js(`document.querySelector('[data-wc-tab="gantt"]')?.click()`); await delay(50)
  if(!await js(`!!document.querySelector('.wc-fixed-gantt')&&document.querySelectorAll('[data-wc-gantt-vehicle]').length>1`)) throw new Error('多车甘特图或车辆多选未展示')
  await js(`location.hash='#/scheduling/dashboard'`); await delay(100)
  const previousVersion=await js(`window.__APP_STATE__.scheduleVersions.length`)
  await js(`document.querySelector('[data-run-schedule]').click()`); await delay(150)
  if(await js(`window.__APP_STATE__.scheduleVersions.length`)<=previousVersion) throw new Error('排程按钮未生成版本')
  await js(`document.querySelector('[data-publish]').click()`); await delay(100)
  if(!await js(`window.__APP_STATE__.scheduleVersions.find(v=>v.id===window.__APP_STATE__.vehicleRepairs[0].currentVersionId)?.status==='PUBLISHED'`)) throw new Error('发布按钮未发布当前版本')

  await js(`location.hash='#/scheduling/gantt'`); await delay(100)
  if(await js(`document.querySelectorAll('[data-gantt-range]').length`)!==2) throw new Error('调度甘特图缺少日期范围控件')
  if(await js(`document.querySelectorAll('[data-gantt-task]').length`)!==20) throw new Error('调度甘特图未展示20条车辆任务')
  const secondVehicle=await js(`(async()=>{const m=await import('/src/core/actions.js');const id=m.addPlan(window.__APP_STATE__,{locomotiveNo:'HXD1C-UI02',plannedEntryAt:'2026-10-08T08:00:00',plannedExitAt:'2026-10-18T18:00:00',priority:80,mileageKm:1});m.submitPlan(window.__APP_STATE__,id);window.__APP_DEBUG__.render();return id})()`)
  await js(`(()=>{const el=document.querySelector('[data-gantt-vehicle]');el.value=${JSON.stringify(String(secondVehicle))};el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100)
  if(await js(`window.__APP_STATE__.selectedVehicleRepairId`)!==secondVehicle) throw new Error('调度甘特图车辆切换未生效')
  await js(`(()=>{const el=document.querySelector('[data-gantt-range="start"]');el.value='2030-01-01';el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100)
  if(await js(`document.querySelectorAll('[data-gantt-task]').length`)!==0) throw new Error('调度甘特图日期过滤未生效')
  await js(`document.querySelector('[data-gantt-reset]').click()`); await delay(100)
  if(await js(`document.querySelectorAll('[data-gantt-task]').length`)!==20) throw new Error('调度甘特图恢复全部范围未生效')
  await js(`window.__APP_STATE__.selectedVehicleRepairId=1;window.__APP_DEBUG__.render()`); await delay(50)

  await js(`location.hash='#/foreman/team-tasks'`); await delay(100)
  if(!await js(`!!document.querySelector('.gantt')&&document.querySelectorAll('[data-gantt-range]').length===2`)) throw new Error('工班长甘特图或日期范围控件未渲染')
  await js(`document.querySelector('[data-fine-tune]')?.click()`); await delay(50)
  if(!await js(`!!document.querySelector('.modal-backdrop')`)) throw new Error('工班长微调弹窗未打开')
  await js(`document.querySelector('.modal-backdrop')?.remove()`)

  await js(`location.hash='#/worker/my-tasks'`); await delay(100)
  if(!await js(`!!document.querySelector('.gantt')&&document.querySelectorAll('[data-gantt-range]').length===2`)) throw new Error('作业人员甘特图或日期范围控件未渲染')
  if(!await js(`!!document.querySelector('.gantt-bar.status-not-started')`)) throw new Error('作业人员未开始状态颜色未渲染')
  await js(`document.querySelector('[data-start-task]').click()`); await delay(100)
  if(!await js(`!!document.querySelector('.gantt-bar.status-in-progress')`)) throw new Error('开始作业后甘特状态颜色未更新')
  await js(`document.querySelector('[data-complete-task]').click()`); await delay(100)
  if(!await js(`!!document.querySelector('.gantt-bar.status-completed')`)) throw new Error('完成作业后甘特状态颜色未更新')

  await js(`location.hash='#/select'`); await delay(100)
  await js(`document.querySelector('[data-role-card="worker"]').click()`); await delay(50)
  if(!await js(`!!document.querySelector('[data-pick-worker]')`)) throw new Error('作业人员选择器未打开')

  if(browserErrors.length) throw new Error(`浏览器错误: ${browserErrors.join('; ')}`)
  console.log(JSON.stringify({passed:true,roleEntries:roleCount,pageChecks,actions:['planning-modal','schedule-run','schedule-publish','gantt-vehicle-switch','gantt-date-filter','foreman-gantt','foreman-modal','worker-gantt-status-colors','worker-picker'],browser:path.basename(browser)},null,2))
  await cdp('Browser.close').catch(()=>{})
  ws.close()
} finally {
  server.kill()
  chrome?.kill()
}
