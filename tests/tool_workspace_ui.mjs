import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {createHandler} from '../server/http.js'
import {applyToolCommand} from '../src/core/tool-management.js'
import {exportDemoSnapshot} from '../src/core/demo-persistence.js'

const schema=`tool_ui_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema}),checks=[],errors=[]
let server,browser,seq=0
try{
 await fs.mkdir('test-artifacts',{recursive:true});await db.init();const snap=await db.read(),s=snap.snapshot.data
 const run=(type,payload={},actor='测试经办')=>applyToolCommand(s,{type,payload,actor,requestId:`fixture-${++seq}`})
 run('WAREHOUSE_STANDARDIZE');const wh=s.toolManagement.warehouses[0],other=s.toolManagement.warehouses[1]
 const t=run('TOOL_SAVE',{code:'TABLE-T',name:'演示扳手',specification:'100Nm',lowStock:1})
 const a=run('ASSET_CREATE',{toolId:t.id,warehouseId:wh.id,code:'TABLE-001',mode:'NUMBERED',quantity:1,tag:'1001001',receivedAt:'2026-10-01',lastRepairAt:'2026-10-10',lastInspectionAt:'2026-10-15',inspectionCycleMonths:12})
 const b=run('ASSET_CREATE',{toolId:t.id,warehouseId:wh.id,code:'TABLE-002',mode:'BULK',quantity:5,tag:'2002002',receivedAt:'2026-10-02'})
 for(let i=0;i<12;i++)run('ASSET_CREATE',{toolId:t.id,warehouseId:wh.id,code:`SCROLL-${i}`,mode:'BULK',quantity:2})
 const device=run('DEVICE_SAVE',{code:'UI-CAB',name:'台账工具柜',kind:'CABINET',warehouseId:wh.id})
 const badEvent=run('DEVICE_EVENT',{deviceId:device.id,eventId:'ui-unknown-tag',eventType:'CHECKOUT',tag:'UNKNOWN-UI',employeeId:s.employees[0].id})
 const c=run('ASSET_CREATE',{toolId:t.id,warehouseId:wh.id,code:'RECORD-BATCH',mode:'BULK',quantity:10})
 const recordLoan=run('BORROW',{assetId:c.id,quantity:2,borrower:'记录领用人',borrowType:'单据演示',dueAt:'2099-01-01T17:00'})
 const recordTransfer=run('TRANSFER',{assetId:c.id,quantity:1,toWarehouseId:other.id})
 const recordService=run('SERVICE_SEND',{assetId:c.id,quantity:1,kind:'REPAIR',provider:'记录维修中心',reason:'单据维修演示'})
 const recordDisposal=run('DISPOSAL_REQUEST',{assetId:c.id,quantity:1,kind:'SCRAPPED',reason:'单据审核演示'})
 snap.snapshot=exportDemoSnapshot(s);await db.save(snap.revision,snap.snapshot)
 server=http.createServer(createHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true})
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message))
 const action=key=>page.locator(`[data-tool-table-action="${key}"]`),modal=()=>page.locator('.modal, body:not(:has(.modal)) [data-tool-data-page], body:not(:has(.modal)) [data-tool-records-page]')
 const openPage=async id=>{if(!page.url().endsWith('/'+id))await page.goto(base+'/#/functions/assets/'+id);await page.locator(id==='tool-data'?'[data-base-tab]':id==='tool-records'?'[data-record-kind]':'[data-tool-workspace]').first().waitFor()}
 const leaveSupplement=async()=>{if(await page.locator('[data-tool-data-page],[data-tool-records-page]').count())await openPage('tool-register')}
 const clickAction=async key=>{
  const basics={dictionary:'tools',categories:'categories',devices:'devices','kit-new':'kits'}
  if(basics[key]){await openPage('tool-data');await modal().locator(`[data-base-tab="${basics[key]}"]`).click();if(key==='kit-new')await modal().locator('[data-base-action="add"]').click();return}
  if(['warnings','events','export-history'].includes(key)){await openPage('tool-records');if(key==='export-history'){await modal().locator('[data-record-kind]').selectOption('events');await modal().locator('[data-record-scope]').selectOption('all');await modal().locator('[data-record-export]').click();await cancel()}else await modal().locator('[data-record-kind]').selectOption(key);return}
  if(key==='tool-data'){await openPage('tool-data');return}
  if(key==='records'){await openPage('tool-records');await modal().locator('[data-record-kind]').selectOption('loans');await modal().locator('[data-record-query]').fill('');await modal().locator('[data-record-scope]').selectOption('all');return}
  if(key==='count-history'){await openPage('tool-inventory');return}
  if(key==='count-new')await openPage('tool-inventory')
  if(['asset-config','bind-task','check-use'].includes(key)){await action('details').click();await modal().locator(`[data-tool-detail-action="${key}"]`).click();return}
  await action(key).click();if(key==='records')await modal().locator('[data-record-scope]').selectOption('all')
 }
 const fill=async(key,value)=>modal().locator(`[data-f="${key}"]`).fill(String(value)),choose=async(key,value)=>modal().locator(`[data-f="${key}"]`).selectOption(String(value))
 const confirm=async()=>{const title=await modal().getAttribute('aria-labelledby'),current=page.locator(`[aria-labelledby="${title}"]`);await current.locator('[data-modal-confirm]').click();try{await current.waitFor({state:'detached',timeout:6000})}catch{throw Error(await current.innerText())}while(await page.locator('.modal').count())await page.locator('.modal [data-modal-cancel]').click();await leaveSupplement()}
 const cancel=async()=>{while(await page.locator('.modal').count())await page.locator('.modal [data-modal-cancel]').click();await leaveSupplement()}
 const state=async()=>(await db.read()).snapshot.data,management=async()=>(await state()).toolManagement
 const check=async id=>{await page.locator(`[data-tool-check="asset:${id}"]`).check()}
 const clear=async()=>{await openPage('tool-register');if(await page.locator('[data-tool-clear-selection]').count())await page.locator('[data-tool-clear-selection]').click()}
 const query=async(q)=>{await page.locator('[data-tool-query] [name="query"]').fill(q);await page.locator('[data-tool-query] [type="submit"]').click()}
 await page.goto(base+'/#/functions/assets/tool-register');await page.locator('[data-tool-workspace]').waitFor()
 const before=(await db.read()).revision
 await page.goto(base+'/#/functions/settings/resources');assert.equal(await page.locator('[data-resource-tab="tools"]').count(),0)
 await page.locator('[data-resource-tools]').click();await page.locator('[data-tool-workspace]').waitFor()
 assert.deepEqual(await page.locator('[data-tool-operation-group] h3').allTextContents(),['工具管理','办理所选工具'])
 assert.equal(await action('settings').count(),0)
 for(const [key,title] of [['dictionary','工具字典'],['categories','工具分类'],['devices','智能设施']]){
  await clickAction(key);assert.equal(await page.locator('main h1').innerText(),'工具资料');assert.equal(await modal().locator('[data-base-tab][aria-pressed="true"]').innerText(),title);assert.equal(await modal().locator('[data-base-kind]').count(),0)
  assert.equal(await modal().locator('[data-base-action="bind"]').isVisible(),key==='dictionary')
  assert.equal(await modal().locator('[data-base-action="event"]').isVisible(),key==='devices')
  for(const op of ['add','edit','delete'])assert.equal(await modal().locator(`[data-base-action="${op}"]`).count(),1)
  await cancel()
 }
 assert.equal(await page.locator('[data-tool-operation-group="workspace"] [data-tool-table-action]').count(),2);checks.push('左侧四个工具子页；台账底部只保留新增导出和工具办理，资料页统一维护字典分类套装设施')
 assert.equal(await page.locator('[data-tool-inspector]').count(),0);assert.equal(await page.locator('[data-tool-type]').count(),0)
 for(const text of ['工具名称','编号','条形码 / RFID','入库时间','最后检修时间','当前状态'])assert.ok((await page.locator('.tool-master-table thead').innerText()).includes(text))
 assert.ok((await page.locator('[data-tool-row="asset:'+a.id+'"]').innerText()).includes('1001001'))
 assert.ok((await page.locator('[data-tool-row="asset:'+a.id+'"]').innerText()).includes('2026-10-10'))
 const positions=await page.evaluate(()=>({table:document.querySelector('[data-tool-results]').getBoundingClientRect().bottom,operations:document.querySelector('.tool-workspace-actions').getBoundingClientRect().top,stats:document.querySelector('.tool-global-stats').getBoundingClientRect().top,query:document.querySelector('[data-tool-query]').getBoundingClientRect().top}))
 assert.ok(positions.operations>positions.table);assert.ok(positions.stats<positions.query)
 assert.equal(await page.locator('[name="warehouse"] option').count(),3);assert.equal((await db.read()).revision,before)
 checks.push('统计在顶、查询在上、独立工具和编号列、原始标签与日期直接显示，全部操作在列表下方')
 await check(c.id)
 for(const key of ['return','transfer-finish','service-finish','disposal-review'])assert.equal(await action(key).count(),1,key)
 for(const key of ['warnings','events','dictionary','categories','devices','asset-config','bind-task','check-use','kit-new','export-history'])assert.equal(await action(key).count(),0,key)
 await clear()
 const openRecord=async(kind,id,op)=>{await clickAction('records');await modal().locator('[data-record-kind]').selectOption(kind);await modal().locator(`[data-record-id="${id}"]`).check();await modal().locator(`[data-record-action="${op}"]`).click()}
 await openRecord('loans',recordLoan.id,'return');await choose('assetId',c.id);await fill('quantity','2');await fill('returner','记录归还人');await fill('actor','收回员');await confirm()
 await openRecord('transfers',recordTransfer.id,'transfer-finish');await fill('actor','调入员');await confirm()
 await openRecord('repair',recordService.id,'service-finish');await choose('result','PASS');await fill('certificate','REPAIR-RECORD-PASS');await fill('actor','校验员');await confirm()
 await openRecord('disposals',recordDisposal.id,'disposal-review');assert.match(await modal().innerText(),/单据审核演示/);await fill('opinion','实物核实报废');await fill('actor','测试经办');await modal().locator('[data-modal-confirm]').click();await modal().locator('[data-tool-form-error]').filter({hasText:'申请人与审核人'}).waitFor()
 await fill('actor','独立审核员');await confirm()
 const recorded=await management();assert.equal(recorded.loans.find(r=>r.id===recordLoan.id).status,'CLOSED');assert.equal(recorded.transfers.find(r=>r.id===recordTransfer.id).status,'RECEIVED');assert.equal(recorded.services.find(r=>r.id===recordService.id).certificate,'REPAIR-RECORD-PASS');assert.equal(recorded.disposals.find(r=>r.id===recordDisposal.id).status,'APPROVED')
 checks.push('上午业务单据入口实际办理归还、调拨接收、维修结果和独立审核，保存后状态一致')
 const stats=await page.locator('.tool-global-stats').innerText()
 await page.locator('[data-tool-filter-open="type"]').click();await page.locator('[data-filter-all]').uncheck()
 await modal().locator('[data-filter-label]').filter({hasText:'有编号工具'}).locator('input').check();await confirm()
 assert.equal(await page.locator('[data-tool-check]').count(),1);assert.equal(await page.locator('.tool-global-stats').innerText(),stats)
 await page.locator('[data-tool-clear-filters]').click()
 const scroller=page.locator('.tool-table-scroll')
 await scroller.evaluate(el=>{el.scrollTop=15;el.scrollLeft=130})
 await check(b.id)
 assert.equal(await scroller.evaluate(el=>el.scrollTop),15);assert.equal(await scroller.evaluate(el=>el.scrollLeft),130)
 await clear()
 checks.push('多选勾选后保留表格横向、纵向位置，不跳回开头')
 await check(a.id);await check(b.id);assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/已选 2 项/)
 assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/TABLE-001/);assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/TABLE-002/)
 await query('TABLE-001');assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/已选 2 项/);await page.locator('[data-tool-reset-query]').click()
 checks.push('Excel式表头多值筛选、统计不随筛选变化、多选勾选和所选清单跨查询可见')
 await clear();await query('TABLE-001')
 const filteredDownload=page.waitForEvent('download');await clickAction('export');const filtered=await filteredDownload
 const filteredCsv=await fs.readFile(await filtered.path(),'utf8');assert.match(filteredCsv,/TABLE-001/);assert.doesNotMatch(filteredCsv,/TABLE-002/)
 await page.locator('[data-tool-reset-query]').click();await check(a.id);await check(b.id)
 checks.push('不勾选时只导出当前筛选结果，勾选后明确导出所选工具')
 await clickAction('edit');assert.equal(await modal().locator('[data-edit-code]').count(),2);await modal().locator('[data-edit-tag="'+b.id+'"]').fill('2002003');await fill('actor','资料员');await confirm();assert.match(await page.locator('[data-tool-row="asset:'+b.id+'"]').innerText(),/2002003/)
 await clickAction('borrow')
 for(const key of ['borrower','dueAt']){assert.ok(await modal().locator(`[data-f="${key}"]`).getAttribute('required')!==null);assert.doesNotMatch(await modal().locator(`[data-f="${key}"]`).locator('..').innerText(),/可选/)}
 const beforeValidation=(await db.read()).revision
 await modal().locator('[data-modal-confirm]').click();assert.match(await modal().locator('[data-tool-form-error]').innerText(),/领用人/);assert.equal((await db.read()).revision,beforeValidation)
 await fill('borrower','张三');await fill('dueAt','2099-01-01T17:00');await fill('actor','发放员')
 await modal().locator('[data-batch-quantity="asset:'+b.id+'"]').fill('');await modal().locator('[data-modal-confirm]').click();assert.match(await modal().locator('[data-tool-form-error]').innerText(),/TABLE-002办理数量/);assert.equal((await db.read()).revision,beforeValidation)
 const beforeFail=await db.read();await modal().locator('[data-batch-quantity="asset:'+b.id+'"]').fill('99');await modal().locator('[data-modal-confirm]').click();await modal().locator('[data-tool-form-error]').filter({hasText:'不足'}).waitFor();assert.equal((await db.read()).revision,beforeFail.revision)
 await modal().locator('[data-batch-quantity="asset:'+b.id+'"]').fill('2');await confirm()
 assert.match(await page.locator('[data-tool-row="asset:'+a.id+'"]').innerText(),/借出 1件/)
 assert.match(await page.locator('[data-tool-selection-summary]').innerText(),/借出/)
 await clear();await check(a.id);assert.equal(await action('return').count(),1)
 for(const key of ['borrow','inspection','repair','transfer','scrap'])assert.equal(await action(key).isDisabled(),true,key)
 for(const key of ['transfer-finish','service-finish','disposal-review'])assert.equal(await action(key).count(),0,key)
 await check(b.id)
 checks.push('操作跟随工具状态变化；已借出单件不适用操作灰显并解释原因，待接收、待检修、待审核才出现后续按钮')
 await page.locator('[name="borrowType"]').selectOption('检修使用');await page.locator('[data-tool-query] [type="submit"]').click();assert.equal(await page.locator('[data-tool-check]').count(),2);await page.locator('[data-tool-reset-query]').click()
 await clickAction('return');assert.equal(await modal().locator('[data-return-line]').count(),2);await fill('returner','张三');await fill('actor','收回员');await confirm()
 let m=await management();assert.ok(m.loans.every(l=>l.status==='CLOSED'))
 checks.push('批量借出任一失败整体不提交；成功后列表和选中清单状态更新；多工具一次归还')
 await clickAction('transfer');await fill('actor','调出员');await confirm();m=await management();assert.ok(m.transfers.every(r=>r.toWarehouseId===other.id))
 await clickAction('transfer-finish');await fill('actor','调入员');await confirm()
 m=await management();assert.equal(m.assets.find(x=>x.id===a.id).warehouseId,other.id)
 await clickAction('inspection');await fill('provider','计量中心');await fill('reason','定期送检');await fill('actor','送检员');await confirm()
 await page.locator('[data-tool-query] [name="serviceQuery"]').fill('计量中心');await page.locator('[data-tool-query] [type="submit"]').click();assert.equal(await page.locator('[data-tool-check]').count(),2)
 await clickAction('service-finish');await choose('result','PASS');await fill('certificate','CERT-UI');await fill('actor','检定员');await confirm();await page.locator('[data-tool-reset-query]').click()
 checks.push('调拨仅在两个固定库间进行，批量送检可按单位查询并一次登记结果')
 await clear();await check(a.id);await clickAction('edit');await fill('receivedAt','2026-09-30T08:00');await fill('actor','资料员');await confirm();assert.match(await page.locator('[data-tool-row="asset:'+a.id+'"]').innerText(),/2026-09-30/)
 await clickAction('asset-new');assert.equal(await modal().locator('[data-f="mode"]').count(),0);assert.equal(await modal().locator('details').count(),0);assert.equal(await modal().locator('[data-f="lastRepairAt"]').isVisible(),true)
 await choose('toolId',t.id);await choose('warehouseId',wh.id);await fill('code','TABLE-NEW');await fill('tag','3003003');await fill('actor','入库员');await confirm()
 m=await management();const added=m.assets.find(x=>x.code==='TABLE-NEW');assert.ok(added);assert.equal(added.mode,'NUMBERED')
 await clear();await check(added.id);await clickAction('delete');await fill('actor','资料员');await confirm();assert.ok(!(await management()).assets.some(x=>x.id===added.id))
 checks.push('新增无管理方式选择，编号决定逐件登记，可选日期直接展示；实物修改、未引用实物删除可用')
 // Basic information CRUD: each table has add, edit, delete, with reference protection.
 await clickAction('categories');await modal().locator('[data-base-action="add"]').click();await fill('code','UI-CAT');await fill('name','临时分类');await fill('actor','资料员');await confirm()
 const category=(await management()).categories.find(c=>c.code==='UI-CAT')
 await clickAction('categories');await modal().locator(`[name="base-record"][value="${category.id}"]`).check();await modal().locator('[data-base-action="edit"]').click();await fill('name','已修改分类');await fill('actor','资料员');await confirm()
 await clickAction('categories');await modal().locator(`[name="base-record"][value="${category.id}"]`).check();await modal().locator('[data-base-action="delete"]').click();await fill('actor','资料员');await confirm();assert.ok(!(await management()).categories.some(c=>c.id===category.id))
 checks.push('基础信息表底部有增删改；分类新增、修改、删除均实际保存')
 await clickAction('kit-new');await fill('code','UI-KIT');await fill('name','资料套装')
 const kitMember=(await management()).assets.find(a=>a.code==='SCROLL-0');await modal().locator(`[data-kit-asset="${kitMember.id}"]`).check();await fill('actor','资料员');await confirm()
 const kit=(await management()).kits.find(k=>k.code==='UI-KIT');assert.ok(kit)
 await clickAction('tool-data');await modal().locator('[data-base-tab="kits"]').click();assert.match(await modal().innerText(),/SCROLL-0/);await modal().locator(`[name="base-record"][value="${kit.id}"]`).check();await modal().locator('[data-base-action="edit"]').click();await fill('name','已修改套装');await fill('actor','资料员');await confirm()
 await clickAction('tool-data');await modal().locator('[data-base-tab="kits"]').click();await modal().locator(`[name="base-record"][value="${kit.id}"]`).check();await modal().locator('[data-base-action="delete"]').click();await fill('actor','资料员');await confirm();assert.ok(!(await management()).kits.some(k=>k.id===kit.id))
 checks.push('工具资料中的套装组成可见，新增、修改、删除实际保存，合并入口未丢失功能')

 await clickAction('devices');assert.match(await modal().innerText(),/未连接 \/ 离线/);assert.match(await modal().innerText(),/智能工具柜/);await cancel()
 await clickAction('events');await modal().locator(`[data-record-id="${badEvent.id}"]`).check();await modal().locator('[data-record-action="resolve"]').click()
 await fill('resolution','重新核对标签，未执行领用');await fill('actor','设施管理员');await confirm();assert.equal((await management()).events.find(e=>e.id===badEvent.id).resolution,'重新核对标签，未执行领用')
 await clickAction('records');assert.equal(await modal().locator('[data-record-kind] option').count(),8)
 await modal().locator('[data-record-query]').fill('张三');assert.ok(await modal().locator('[data-record-id]').count());await modal().locator('[data-record-query]').fill('')
 for(const kind of ['transfers','inspection','audit']){await modal().locator('[data-record-kind]').selectOption(kind);assert.ok(await modal().locator('[data-record-id]').count(),kind)}
 await modal().locator('[data-record-kind]').selectOption('inspection');assert.match(await modal().innerText(),/CERT-UI/);await cancel()
 await clickAction('warnings');assert.equal(await modal().locator('[data-record-kind]').inputValue(),'warnings');await cancel()
 await clear();await check(b.id);await clickAction('asset-config');await choose('status','DISABLED');await fill('actor','资料员');await confirm();assert.match(await page.locator(`[data-tool-row="asset:${b.id}"]`).innerText(),/停用/)
 await clickAction('asset-config');await choose('status','AVAILABLE');await fill('actor','资料员');await confirm()
 await clickAction('bind-task');await choose('taskId',s.tasks[0].id);await fill('quantity','2');await fill('actor','工艺员');await confirm();assert.ok((await state()).toolRequirements.some(r=>r.toolId===t.id&&r.taskId===s.tasks[0].id&&r.quantity===2))
 await clickAction('check-use');assert.equal(await modal().locator('[data-f="scheduleTaskId"]').count(),1);await cancel()
 const historyDownload=page.waitForEvent('download');await clickAction('export-history');const history=await historyDownload;assert.match(await fs.readFile(await history.path(),'utf8'),/重新核对标签/)
 checks.push('上午版内容恢复：完整业务记录、综合预警、设施连接和异常处置、标签状态、工序绑定、工具核验及业务记录导出')
 await clear();await page.locator('[data-tool-filter-open="type"]').click();await page.locator('[data-filter-all]').uncheck();await modal().locator('[data-filter-label]').filter({hasText:'待完善登记'}).locator('input').check();await confirm()
 const registrationKeys=(await page.locator('[data-tool-check]').evaluateAll(els=>els.slice(0,2).map(el=>el.dataset.toolCheck)))
 for(const key of registrationKeys)await page.locator(`[data-tool-check="${key}"]`).check()
 const beforeRegistration=(await state()).tools.reduce((n,t)=>n+Number(t.quantity||0),0)
 await clickAction('adopt');await choose('warehouseId',wh.id);await fill('actor','登记员');await confirm()
 assert.equal((await state()).tools.reduce((n,t)=>n+Number(t.quantity||0),0),beforeRegistration)
 const registeredManagement=await management();assert.ok(registrationKeys.every(key=>registeredManagement.assets.some(a=>a.toolId===Number(key.split(':')[1]))));await page.locator('[data-tool-clear-filters]').click();await clear()
 checks.push('多项原库存可一次完善登记，不新增库存数量')
 await clickAction('count-new');await choose('warehouseId',other.id);await fill('actor','盘点员');await confirm();assert.ok(await page.locator('[data-count-present]').count())
 const current=(await management()).counts.at(-1);const missing=current.lines.find(l=>l.assetId===a.id),found=current.lines.find(l=>l.assetId!==a.id)
 assert.ok(missing&&found)
 await page.locator(`[data-count-present="${found.assetId}"]`).check();const actual=page.locator(`[data-count-actual="${found.assetId}"]`);await actual.fill('1');for(const line of current.lines.filter(line=>line.assetId!==found.assetId))await page.locator(`[data-count-verified="${line.assetId}"]`).selectOption('MISSING')
 await clickAction('count-confirm');await fill('reason','现场清点，一项未找到');await fill('actor','盘点员');await confirm()
 m=await management();const count=m.counts.at(-1);assert.equal(count.status,'CLOSED');assert.equal(count.lines.find(l=>l.assetId===a.id).counted,0);assert.equal(count.lines.find(l=>l.assetId===found.assetId).counted,1)
 const downloadPromise=page.waitForEvent('download');await clickAction('count-export');const download=await downloadPromise;await download.saveAs('test-artifacts/tool-count-result.csv');const csv=await fs.readFile('test-artifacts/tool-count-result.csv','utf8');assert.match(csv,/清点完成/);assert.match(csv,/实际数量/);assert.match(csv,/TABLE-001/)
 await clickAction('count-exit');await clickAction('count-history');await page.locator(`[data-tool-count-select][value="${count.id}"]`).check();await action('count-open-selected').click();assert.match(await page.locator('.tool-count-banner').innerText(),/已完成/);await clickAction('count-exit')
 checks.push('现场盘点默认未勾选，勾选代表实际有、数量可录入；确认保存差异，完成状态可导出并重新打开')
 const beforeCancel=await management()
 await clickAction('count-new');await choose('warehouseId',wh.id);await fill('actor','盘点员');await confirm()
 const cancelledId=(await management()).counts.at(-1).id
 await clickAction('count-cancel-current');await fill('actor','盘点员');await confirm()
 await clickAction('count-history');await page.locator(`[data-tool-count-select][value="${cancelledId}"]`).check();await action('count-open-selected').click()
 assert.match(await page.locator('.tool-count-banner').innerText(),/已取消/);assert.match(await page.locator('[data-tool-bottom]').innerText(),/未调整库存/);assert.equal(await action('count-confirm').count(),0)
 assert.equal(await page.locator('[data-count-present]:enabled').count(),0)
 const cancelledDownload=page.waitForEvent('download');await clickAction('count-export');const cancelled=await cancelledDownload;const cancelledCsv=await fs.readFile(await cancelled.path(),'utf8');assert.match(cancelledCsv,/已取消（未调整库存）/);assert.match(cancelledCsv,/未确认/);assert.doesNotMatch(cancelledCsv,/盘点草稿/)
 assert.deepEqual((await management()).assets,beforeCancel.assets)
 await clickAction('count-exit')
 checks.push('取消盘点重新打开与导出均标记已取消，实盘未确认，库存不变且不能再次确认')
 await openPage('tool-register');await page.locator('.toast-stack').evaluateAll(els=>els.forEach(el=>el.remove()));await page.screenshot({path:'test-artifacts/tool-workspace-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-artifacts/tool-workspace-mobile.png',fullPage:true})
 const widths=await page.evaluate(()=>({body:document.body.scrollWidth,view:innerWidth}));assert.ok(widths.body<=widths.view+2,JSON.stringify(widths))
 await action('asset-new').focus();await page.keyboard.press('Enter');await modal().waitFor();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.toolTableAction),'asset-new')
 assert.equal(errors.length,0,errors.join(';'))
 checks.push('手机无页面横向溢出，宽表独立滚动，键盘可打开关闭弹窗并恢复焦点')
 console.log(JSON.stringify({passed:true,checks},null,2))
}finally{
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(!/^tool_ui_\d+_\d+$/.test(schema))throw Error('Unexpected schema');await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close()
}
