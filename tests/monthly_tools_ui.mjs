import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'
import {setupToolWarehouses} from '../scripts/setup-tool-warehouses.mjs'

const schema=`pc1_test_merge_ui_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
let server,browser
const checks=[],errors=[],out='test-artifacts/monthly-tools-merge'
try{
  await db.init();await setupToolWarehouses(db,{backup:false});const initial=await db.read()
  server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const base=`http://127.0.0.1:${server.address().port}`
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/#/functions/catalog');await page.locator('[data-function-directory]').waitFor()
  assert.equal((await db.read()).revision,initial.revision,'打开页面不能自动写入演示数据')
  const links=await page.locator('.function-directory a').allTextContents()
  for(const label of ['年度计划','配件计划','整车临修计划','计划完善与统计'])assert.ok(!links.includes(label),label)
  assert.ok(links.includes('月度计划'),'月度计划')
  assert.ok(!links.includes('月度计划交验统计'),'交验统计应并入月度计划页签，不单独占用功能导航')
  checks.push('展示入口只列月度计划主线，交验统计并入页签，打开页面不改数据库')

  await page.goto(base+'/#/functions/plans/plan-import');await page.locator('[data-open-import-dialog]').waitFor()
  await page.locator('[data-import-month]').fill('2026-11');await page.locator('[data-import-month]').dispatchEvent('change')
  await page.locator('[data-open-import-dialog]').click()
  const csv='\uFEFF机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\r\nMERGE-UI-A,UNKNOWN,HXD1C高级修,1,2026-11-10,测试局,合版段,100,原备注\r\nMERGE-UI-B,HXD1C,HXD1C高级修,2,2026-11-11,测试局,合版段,200,第二辆\r\n'
  await page.locator('[data-dialog-plan-file]').setInputFiles({name:'合版测试.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
  await page.locator('.modal [data-modal-confirm]').click();await page.locator('.pc-plan-preview').waitFor()
  await page.locator('[data-edit-preview-row]').first().click()
  await page.locator('[data-preview-model]').selectOption('HXD1C')
  await page.locator('[data-preview-program]').selectOption('HXD1C高级修')
  await page.locator('[data-preview-value="remark"]').fill('浏览器修改备注')
  await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'})
  await page.getByRole('button',{name:'确认导入2条',exact:true}).waitFor()
  await page.locator('[data-confirm-import]').click();await page.locator('.pc-plan-result').waitFor()
  await page.locator('[data-dismiss-result]').click()
  assert.equal((await db.read()).snapshot.data.vehicleRepairs.find(v=>v.locomotiveNo==='MERGE-UI-A').remark,'浏览器修改备注')
  checks.push('实际上传、编辑错误行和备注、重新校验并导入两车')

  await page.goto(base+'/#/functions/schedule/schedule');await page.locator('[data-pc1-plan-month]').waitFor()
  await page.locator('[data-pc1-plan-month]').fill('2026-11');await page.locator('[data-pc1-plan-month]').dispatchEvent('change')
  const vehicles=(await db.read()).snapshot.data.vehicleRepairs.filter(v=>v.locomotiveNo.startsWith('MERGE-UI-'))
  for(const v of vehicles)await page.locator(`[data-pc1-select-vehicle="${v.id}"]`).check()
  await page.locator('[data-pc1-deadline]').fill('2026-11-25T18:00');await page.locator('[data-pc1-deadline]').dispatchEvent('change')
  await page.locator('[data-pc1-simulate]').click()
  assert.equal(await page.locator('[data-pc1-drag-task]').count(),40)
  await page.locator('[data-pc1-confirm]').click();await page.locator('[data-approval-plan-name]').fill('合版浏览器月度计划')
  await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'})
  let state=(await db.read()).snapshot.data
  assert.ok(vehicles.every(v=>state.vehicleRepairs.find(row=>row.id===v.id).approvalStatus==='SUBMITTED'))
  assert.equal(state.pc1Dispatches.filter(d=>vehicles.some(v=>v.id===d.vehicleRepairId)).length,0)
  checks.push('40项任务模拟并提交，审批前没有班组下发记录')

  await page.goto(base+'/#/functions/quality/monthly-plan-approval');await page.locator('[data-plan-approval-page]').waitFor()
  const row=page.locator('tbody tr').filter({hasText:'MERGE-UI-A'})
  await row.locator('[data-flow-detail]').click()
  assert.match(await page.locator('.modal').innerText(),/20 项/)
  await page.locator('.modal [data-modal-confirm]').click()
  for(const v of vehicles){
    const flowRow=page.locator('tbody tr').filter({hasText:v.locomotiveNo})
    for(const action of ['REVIEW','PUBLISH']){
      await flowRow.locator(`[data-flow-action="${action}"]`).click()
      await page.locator('[data-flow-comment]').fill(action==='REVIEW'?'审核通过':'批准发布')
      await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'})
    }
  }
  await page.reload();await page.locator('[data-plan-approval-page]').waitFor()
  state=(await db.read()).snapshot.data
  assert.ok(vehicles.every(v=>state.vehicleRepairs.find(row=>row.id===v.id).approvalStatus==='PUBLISHED'))
  assert.equal(state.pc1Dispatches.filter(d=>vehicles.some(v=>v.id===d.vehicleRepairId)).length,4)
  checks.push('审批详情、两级处理与刷新恢复，发布后四份班组清单')

  await page.goto(base+'/#/functions/plans/plan-import');await page.locator('[data-import-month]').fill('2026-11');await page.locator('[data-import-month]').dispatchEvent('change')
  await page.locator('tr').filter({hasText:'MERGE-UI-A'}).locator('[data-plan-detail]').click()
  await page.locator('[data-plan-adjust-published]').click();await page.locator('[data-plan-revise-reason]').fill('演示调整申请')
  await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.equal((await db.read()).snapshot.data.vehicleRepairs.find(v=>v.locomotiveNo==='MERGE-UI-A').approvalStatus,'REVISING')
  checks.push('已发布计划先填写调整申请，再进入待修改状态')

  await page.goto(base+'/#/functions/assets/tool-register');await page.locator('[data-tool-workspace]').waitFor()
  await page.locator('[data-tool-table-action="tool-data"]').click()
  await page.locator('[data-base-tab="categories"]').click();await page.locator('[data-base-action="add"]').click()
  await page.locator('[data-f="code"]').fill('UI-C');await page.locator('[data-f="name"]').fill('浏览器工具分类');await page.locator('[data-f="actor"]').fill('工具经办')
  await page.locator('.modal [data-modal-confirm]').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.ok((await db.read()).snapshot.data.toolManagement.categories.some(w=>w.code==='UI-C'))
  assert.ok((await db.read()).snapshot.data.planApprovalFlows.length>=2)
  checks.push('工具大表可打开，分类实际保存且不覆盖月度审批')

  for(const [month,days] of [['2027-02',28],['2028-02',29],['2026-11',30],['2027-01',31]]){
    const current=await db.read()
    current.snapshot.data.monthlyVerificationRecords=[{id:1,vehicleRepairId:vehicles[1].id,date:`${month}-${days}`,result:'PASSED',depot:'合版交验段'}]
    await db.save(current.revision,exportDemoSnapshot(current.snapshot.data))
    await page.goto(base+'/#/functions/plans/monthly-verification');await page.reload();await page.locator('[data-monthly-verification]').waitFor()
    await page.locator('[data-delivery-month]').fill(month);await page.locator('[data-delivery-search]').click()
    assert.equal(await page.locator('[data-trend-day]').count(),days)
    assert.equal(await page.locator(`tbody tr:has-text("${month}-${days}")`).count(),1)
  }
  checks.push('交验统计28/29/30/31天的月末记录与图表一致')
  await page.goto(base+'/demo.html#/demo/verification');await page.locator('[data-monthly-verification]').waitFor()
  assert.equal(await page.locator('.demo-nav>a').count(),5)
  assert.equal(await page.locator('a[href="#/demo/plans"]').count(),1)
  await page.goto(base+'/demo.html#/demo/approval');await page.locator('[data-plan-approval-page]').waitFor()
  assert.equal(await page.locator('.demo-nav>a').count(),5)
  checks.push('五页签演示入口支持交验统计和审批子页面')
  await page.goto(base+'/#/functions/plans/monthly-verification');await page.locator('[data-monthly-verification]').waitFor()
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  }
  assert.deepEqual(errors,[])
  await mkdir(out,{recursive:true});await page.screenshot({path:out+'/verification-mobile.png',fullPage:true})
  await writeFile(out+'/report.json',JSON.stringify({passed:true,checks,browserErrors:errors},null,2))
  console.log(JSON.stringify({passed:true,checks,browserErrors:errors},null,2))
}finally{
  await browser?.close();if(server)await new Promise(r=>server.close(r))
  assert.match(schema,/^pc1_test_merge_ui_\d+_\d+$/);await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
