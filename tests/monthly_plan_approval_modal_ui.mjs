import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import http from 'node:http'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'
import {authenticateTestPage} from './tool_auth_fixture.mjs'

const require=createRequire(import.meta.url)
const { chromium }=require('playwright')
const schema=`pc1_test_approval_modal_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
let server,browser
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const dictionary=(await db.pool.query(`SELECT lm.model_name,rp.repair_program_name FROM "${schema}".repair_program rp JOIN "${schema}".locomotive_model lm ON lm.model_id=rp.model_id WHERE rp.repair_program_name='C1' ORDER BY rp.repair_program_id LIMIT 1`)).rows[0]
  const period={year:2197,month:8}
  await service.createDraftItem({...period,role:'PLANNER',values:{modelName:dictionary.model_name,repairProgramName:dictionary.repair_program_name,locomotiveNo:'MODAL-UI-01',repairSequence:1,plannedEntryAt:'2197-08-08',ownerBureau:'哈尔滨局',ownerDepot:'哈尔滨机务段',mileageKm:100,remark:'审批弹窗布局测试'}})
  server=http.createServer(createHandler(db))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  await authenticateTestPage(page,db,base)
  await page.goto(`${base}/#/functions/plans/monthly-calendar`)
  await page.locator('[data-calendar-month]').fill('2197-08')
  await page.locator('[data-calendar-month]').dispatchEvent('change')
  await page.waitForFunction(()=>document.querySelector('[data-calendar-month]')?.value==='2197-08'&&!document.querySelector('.pc-plan-loading'))

  const assertLayout=async expectedStatus=>{
    const modal=page.locator('.modal')
    await modal.waitFor()
    assert.ok((await modal.boundingBox()).width>=1000,'审批类弹窗应使用加宽布局')
    assert.equal(await modal.locator('.pc-monthly-approval-section').count(),1,'应展示独立车辆明细区')
    assert.equal(await modal.locator('.pc-application-vehicle-table').count(),1,'应展示车辆明细表')
    assert.match(await modal.innerText(),new RegExp(expectedStatus))
    const layout=await modal.evaluate(element=>{
      const body=element.querySelector('.modal-body').getBoundingClientRect()
      const table=element.querySelector('.pc-application-vehicle-table').getBoundingClientRect()
      const overlaps=nodes=>nodes.some((a,index)=>nodes.slice(index+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2))
      const sections=[...element.querySelectorAll('.pc-monthly-approval-dialog>*')].map(node=>node.getBoundingClientRect())
      const fields=[...element.querySelectorAll('.pc-monthly-approval-form-grid>*')].map(node=>node.getBoundingClientRect())
      const overlap=overlaps(sections)||overlaps(fields)
      return {tableWithinBody:table.left>=body.left-1&&table.right<=body.right+1,overlap}
    })
    assert.equal(layout.tableWithinBody,true,'车辆明细容器不得撑出弹窗正文')
    assert.equal(layout.overlap,false,'摘要、表格和表单字段不得重叠')
  }

  await page.locator('[data-monthly-submit]:not([disabled])').click()
  await assertLayout('待审核')
  assert.equal(await page.locator('.modal .pc-monthly-approval-form').count(),1,'计划员申请审核应展示分区后的申请信息')
  await page.locator('.modal [data-modal-close]').first().click()

  await service.submit({...period,role:'PLANNER',note:'弹窗布局测试'})
  await page.reload()
  await page.locator('[data-monthly-role]').selectOption('SECTION_CHIEF')
  await page.locator('[data-monthly-approve]:not([disabled])').waitFor()
  await page.locator('[data-monthly-approve]').click()
  await assertLayout('待审核')
  assert.match(await page.locator('.modal').innerText(),/责任人/)
  await page.locator('.modal [data-modal-close]').first().click()

  await service.decide({...period,role:'SECTION_CHIEF',action:'APPROVE',reason:'同意'})
  await page.reload()
  await page.locator('[data-monthly-role]').selectOption('DEPUTY_DIRECTOR')
  await page.locator('[data-monthly-publish]:not([disabled])').waitFor()
  await page.locator('[data-monthly-publish]').click()
  await assertLayout('待发布')
  assert.match(await page.locator('.modal').innerText(),/当前月检修计划车辆明细/)
  console.log('PASS: 计划员申请、科长审核及副段长审批发布弹窗详情完整且布局无重叠')
}finally{
  await browser?.close().catch(()=>{})
  if(server)await new Promise(resolve=>server.close(resolve))
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>{})
  await db.close()
}
