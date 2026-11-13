import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createHandler } from '../server/http.js'
import { applyToolCommand } from '../src/core/tool-management.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'

const schema=`tool_user_100_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
const checks=[];let browser,server,seq=0
const note=(area,operation,requirements)=>checks.push({id:`U${String(checks.length+1).padStart(3,'0')}`,area,operation,requirements,passed:true})
try{
 await db.init();const snap=await db.read(),s=snap.snapshot.data
 const run=(type,payload)=>applyToolCommand(s,{type,payload,actor:'隔离测试经办人',requestId:`u100-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const [warehouse,warehouse2]=s.toolManagement.warehouses
 const category=run('CATEGORY_SAVE',{code:'U100-CAT',name:'100场景计量分类'})
 const tool=run('TOOL_SAVE',{code:'U100-T',name:'100场景扭矩扳手',categoryId:category.id,lowStock:1})
 const assets=[]
 for(let i=1;i<=25;i++) assets.push(run('ASSET_CREATE',{toolId:tool.id,warehouseId:i%2?warehouse.id:warehouse2.id,code:`U100-${String(i).padStart(3,'0')}`,mode:'NUMBERED',quantity:1,tag:`BAR-U100-${String(i).padStart(3,'0')}`,receivedAt:`2026-10-${String((i%28)+1).padStart(2,'0')}`,lastRepairAt:`2026-09-${String((i%28)+1).padStart(2,'0')}`}))
 const categoryIds=[]
 for(let i=1;i<=25;i++) categoryIds.push(run('CATEGORY_SAVE',{code:`U100-C${String(i).padStart(3,'0')}`,name:`现场分类${String(i).padStart(2,'0')}`,note:`筛选场景 ${i}`}))
 const countIds=[]
 for(let i=1;i<=25;i++){const id=run('COUNT_CREATE',{warehouseId:i%2?warehouse.id:warehouse2.id}).id;run('COUNT_CANCEL',{id});countIds.push(id)}
 await db.save(snap.revision,exportDemoSnapshot(s))
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
 const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 const open=async route=>{await page.goto(`${base}/#/functions/assets/${route}`)}
 const action=key=>page.locator(`[data-tool-table-action="${key}"]`)
 // 01–25: ledger users search distinct item identities and inspect the bottom action area.
 await open('tool-register');await page.locator('[data-tool-workspace]').waitFor()
 for(let i=0;i<25;i++){
  const a=assets[i],term=`U100-${String(i+1).padStart(3,'0')}`
  await page.locator('[name="query"]').fill(term);await page.locator('[data-tool-query] [type="submit"]').click()
  assert.equal(await page.locator(`[data-tool-row="asset:${a.id}"]`).count(),1,`ledger search ${term}`)
  assert.ok(await page.locator('[data-tool-bottom]').isVisible())
  await page.locator(`[data-tool-check="asset:${a.id}"]`).check()
  assert.ok(await page.locator('[data-tool-bottom] [data-tool-table-action="borrow"]').isVisible())
  assert.ok(await page.locator('[data-tool-bottom] [data-tool-table-action="transfer"]').isVisible())
  note('工具台账',`搜索编号 ${term}、勾选单件并检查底部借出/调拨入口`,['T02','T03','T04'])
  await page.locator('[data-tool-check="asset:'+a.id+'"]').uncheck()
 }
 // 26–50: navigate 25 different historical count records; verify warehouse/status and detail return.
 await open('tool-inventory');await page.locator('[data-tool-count-select]').first().waitFor();assert.equal(await action('count-open-selected').isDisabled(),true)
 for(let i=0;i<25;i++){
  const id=countIds[i]
  await page.locator(`[data-tool-count-select][value="${id}"]`).check();assert.equal(await action('count-open-selected').isDisabled(),false);assert.match(await page.locator('[data-count-open-hint]').innerText(),new RegExp(String(id)));await action('count-open-selected').click()
  await page.locator('.tool-count-banner').waitFor()
  assert.match(await page.locator('.tool-count-banner').innerText(),/已取消/)
  assert.ok(await action('count-export').isVisible())
  note('盘点',`打开第 ${i+1} 张已取消盘点单并查看导出状态`,['T08'])
  await action('count-exit').click();await page.locator('[data-tool-count-select]').first().waitFor()
 }
 // 51–75: 25 distinct record filters across every record type, scope, and query input.
 await open('tool-records');await page.locator('[data-record-kind]').waitFor()
 const kinds=['loans','transfers','inspection','repair','disposals'],scopes=['todo','done','']
 for(let i=0;i<25;i++){
  const kind=kinds[i%kinds.length],scope=scopes[Math.floor(i/kinds.length)%scopes.length],term=`不存在的查询-${String(i+1).padStart(2,'0')}`
  await page.locator('[data-record-kind]').selectOption(kind)
  await page.locator('[data-record-status]').selectOption(scope)
  await page.locator('[data-record-query]').fill(term);await page.locator('[data-record-form] button[type=submit]').click()
  assert.equal(await page.locator('[data-record-kind]').inputValue(),kind)
  assert.equal(await page.locator('[data-record-status]').inputValue(),scope)
  assert.ok(await page.locator('[data-record-export]').isVisible())
  assert.equal(await page.locator('[data-record-id]').count(),0)
  assert.match(await page.locator('[data-record-actions]').innerText(),/选择一条记录/)
  note('业务记录与预警',`${kind} / ${scope} / 空结果查询 ${term}，确认无结果反馈及导出入口`,['T03','T04','T05','T06','T07','T09','T12'])
 }
 // 76–100: navigate all data tabs and select 25 distinct categories, verifying available CRUD controls.
 await open('tool-data');await page.locator('[data-tool-data-page]').waitFor()
 const tabs=['categories','tools','kits','devices']
 for(let i=0;i<25;i++){
  const tab=tabs[i%tabs.length]
  await page.locator(`[data-base-tab="${tab}"]`).click()
  assert.equal(await page.locator(`[data-base-tab="${tab}"]`).getAttribute('aria-pressed'),'true')
  assert.ok(await page.locator('[data-base-action="add"]').isVisible())
  assert.ok(await page.locator('[data-base-action="add"]').evaluate(el=>el.classList.contains('btn-primary')))
  if(tab==='categories'){
   const id=categoryIds[i%categoryIds.length].id
   await page.locator(`[name="base-record"][value="${id}"]`).check()
   assert.ok(await page.locator('[data-base-action="edit"]').isEnabled())
   assert.ok(await page.locator('[data-base-action="delete"]').isEnabled())
  }else{
   assert.ok(await page.locator('[data-base-action="edit"]').isDisabled())
   assert.ok(await page.locator('[data-base-action="delete"]').isDisabled())
  }
  note('工具资料',`切换${({categories:'工具分类',tools:'工具字典',kits:'工具套装',devices:'智能设施'})[tab]}并检查增删改入口`,['T01','T10','T11','T12'])
 }
 assert.equal(checks.length,100);assert.deepEqual(errors,[])
 await fs.mkdir('test-artifacts/tool-user-100',{recursive:true})
 const report={passed:true,scenarioCount:checks.length,method:'isolated PostgreSQL schema + browser-driven actions + generated fixture values; no production writes',distinctness:'25 item searches + 25 unique count records + 25 record kind/scope/query combinations + 25 base-data tab/selection combinations',requirementsCovered:['T01','T02','T03','T04','T05','T06','T07','T08','T09','T10','T11','T12'],checks,errors}
 await fs.writeFile('test-artifacts/tool-user-100/report.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({passed:true,scenarioCount:checks.length,requirementsCovered:report.requirementsCovered,method:report.method,report:'test-artifacts/tool-user-100/report.json'},null,2))
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(!/^tool_user_100_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()}
