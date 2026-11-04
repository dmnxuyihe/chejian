"""Presentation-only navigation over real PC1 pages; mutations use an isolated schema."""
from pathlib import Path
from datetime import datetime,timedelta
import json,subprocess,sys,os,urllib.request
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
NODE='C:/Users/24535/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
FUNCTION_MODE=os.environ.get('PC1_FUNCTION_WORKSPACE')=='1'
NAV='.workspace-nav a' if FUNCTION_MODE else '.demo-nav a'
OUT=ROOT/('test-artifacts/function-workflow-ui' if FUNCTION_MODE else 'test-artifacts/demo-function-ui');OUT.mkdir(parents=True,exist_ok=True)
checks=[];server=None

def route_url(base,route):
 paths={'calendar':'plans/monthly-calendar','plans':'plans/plan-import','schedule':'schedule/schedule','vehicle':'monitor/vehicle','workshop':'monitor/workshop-calendar','control':'monitor/vehicle-control','dispatch':'schedule/dispatch'}
 return base+'/#/functions/'+paths[route] if FUNCTION_MODE else base+'/demo.html#/demo/'+route
def check(text):checks.append(text);print('PASS '+text,flush=True)
def state(base):return json.load(urllib.request.urlopen(base+'/api/state'))
def clean_nav(page):
 expect(page.locator(NAV)).to_have_count(5)
 assert page.locator('[data-switch-role],[data-role-card]').count()==0
 if not FUNCTION_MODE:assert page.locator('[data-mobile-nav],.workspace-location,.sidebar').count()==0
 assert not page.locator('a[href^="#/planning/"],a[href^="#/scheduling/"]').count()
def visit(page,base,route):
 page.goto(route_url(base,route));page.wait_for_load_state('networkidle');expect(page.locator('.function-shell' if FUNCTION_MODE else '[data-demo-shell]')).to_be_visible();clean_nav(page)
def saved(page):
 page.wait_for_function('window.__APP_DEBUG__.getPersistence().status.ok')
 assert page.evaluate('window.__APP_DEBUG__.getPersistence().save()')['ok']
original=state('http://127.0.0.1:5193')
try:
 with sync_playwright()as p:
  browser=p.chromium.launch(channel='msedge',headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  if FUNCTION_MODE:visit(page,'http://127.0.0.1:5193','calendar')
  else:
   page.goto('http://127.0.0.1:5193/demo.html');page.wait_for_load_state('networkidle');expect(page).to_have_url(route_url('http://127.0.0.1:5193','calendar'))
  page.screenshot(path=str(OUT/'01-month-calendar.png'),full_page=True)
  for route in ['plans','calendar','schedule','vehicle','workshop','control','dispatch']:
   visit(page,'http://127.0.0.1:5193',route)
   if route=='plans':assert page.locator('[data-open-manual],option[value="ANNUAL"]').count()==0
   if route=='calendar':assert page.locator('[data-resource-preparation]').count()==0
   if route=='vehicle':expect(page.locator('[data-pc1-vehicle-tab]')).to_have_count(3)
   if route=='control':
    assert page.locator('[data-vehicle-milestones],[data-pc1-vehicle-tab]').count()==0
    expect(page.locator('[data-pc1-records]')).to_be_visible()
    records=original['snapshot']['data']['maintenanceRecords']
    if records:
     record=records[0];page.locator('[data-pc1-query-vehicle]').select_option(str(record['vehicleRepairId']))
     page.locator(f'[data-pc1-records] [data-pc1-record-task="{record["scheduleTaskId"]}"]').click()
     expect(page.locator('.pc1-submitted-record')).to_be_visible();assert not page.locator('[data-add-record]').count()
     page.screenshot(path=str(OUT/'05-record-view-only.png'),full_page=True)
     page.locator('[data-modal-confirm]').click()
    page.screenshot(path=str(OUT/'04-control.png'),full_page=True)
  check('all 7 presentation routes work with only 5 function tabs, no role navigation and no links escaping into role pages')
  check('control page lists all tasks and opens submitted records read-only, without upload or arrival actions')
  # Reflow and keyboard navigation on the function shell.
  for width in [390,768,1440]:
   page.set_viewport_size({'width':width,'height':950});visit(page,'http://127.0.0.1:5193','calendar')
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   for tab in page.locator(NAV).all():assert tab.is_visible()
   page.screenshot(path=str(OUT/f'calendar-{width}.png'),full_page=True)
  page.keyboard.press('Control+Home');page.locator(NAV).nth(1).focus();page.keyboard.press('Enter');expect(page).to_have_url(route_url('http://127.0.0.1:5193','schedule'))
  assert not errors,errors
  check('390px, 768px and desktop navigation reflow without page overflow; keyboard navigation works')
  page.route('**/api/planning/calendar?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"message":"test dependency unavailable"}'))
  visit(page,'http://127.0.0.1:5193','calendar');page.reload();page.wait_for_load_state('networkidle');expect(page.locator('[data-retry]')).to_be_visible()
  page.unroute('**/api/planning/calendar?*');page.locator('[data-retry]').click();expect(page.locator('.pc-plan-calendar-card')).to_be_visible()
  check('monthly calendar query failure exposes a working retry and recovers after the dependency returns')
  page.set_viewport_size({'width':1440,'height':1000})
  server=subprocess.Popen([NODE,'tests/pc1_ui_server.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
  ready=json.loads(server.stdout.readline());base=ready['base']
  csv=OUT/'demo-two-cars.csv'
  csv.write_text('\ufeff机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\nHXD1C-FUNDEMOA,HXD1C,HXD1C高级修,5,2026-10-29,演示局,演示段,500000,功能演示测试\nHXD1C-FUNDEMOB,HXD1C,HXD1C高级修,5,2026-10-30,演示局,演示段,510000,功能演示测试\n',encoding='utf-8')
  visit(page,base,'plans')
  month=page.locator('[data-import-month]');month.fill('2026-10');month.dispatch_event('change');page.wait_for_load_state('networkidle')
  page.locator('[data-plan-file]').set_input_files(str(csv));expect(page.locator('[data-confirm-import]')).to_be_enabled()
  page.locator('[data-confirm-import]').click();expect(page.locator('.pc-plan-result')).to_contain_text('新增2条')
  saved(page);page.locator('.plan-view-tabs a').nth(1).click();expect(page).to_have_url(route_url(base,'calendar'));page.wait_for_load_state('networkidle')
  check('monthly CSV upload previews and imports 2 plans into isolated PostgreSQL; calendar link stays inside demo')
  page.locator(NAV).nth(1).click();expect(page.locator('[data-pc1-planning]')).to_be_visible()
  data=state(base)['snapshot']['data'];ids=[r['id']for r in data['vehicleRepairs']if r['locomotiveNo'].startswith('HXD1C-FUNDEMO')]
  month=page.locator('[data-pc1-plan-month]');month.fill('2026-10');month.dispatch_event('change')
  for id in ids:page.locator(f'[data-pc1-select-vehicle="{id}"]').check()
  deadline=page.locator('[data-pc1-deadline]');deadline.fill('2026-12-31T18:00');deadline.dispatch_event('change')
  page.locator('[data-pc1-preflight]').click();expect(page.locator('[data-pc1-preflight-result]')).to_contain_text('预检通过')
  page.locator('[data-pc1-simulate]').click();expect(page.locator('[data-pc1-drag-task]')).to_have_count(40)
  assert page.locator('.pc1-overall-settings').bounding_box()['y']<page.locator('.pc1-desk.has-preview').bounding_box()['y']
  expect(page.locator('.pc1-task-inspector [data-task-detail-content]')).to_be_visible()
  original_preview=page.evaluate('JSON.stringify(window.__APP_STATE__.pc1SchedulePreview)')
  task_select=page.locator('[data-pc1-select-task]').nth(2);task_id=task_select.get_attribute('data-pc1-select-task');task_select.click()
  expect(page.locator('.pc1-task-inspector [data-task-detail-content]')).to_have_attribute('data-task-detail-id',task_id)
  assert page.evaluate('JSON.stringify(window.__APP_STATE__.pc1SchedulePreview)')==original_preview
  start=page.locator('[data-pc1-detail-start]');start.fill('2026-01-01T00:00');page.locator('[data-pc1-task-time-editor] button[type=submit]').click()
  expect(page.locator('[data-pc1-task-message]')).to_contain_text('调整时间须')
  assert page.evaluate('JSON.stringify(window.__APP_STATE__.pc1SchedulePreview)')==original_preview
  # Restore the first selection; pointer click is inspection, never a time change.
  page.locator('[data-pc1-select-task]').first.click()
  for width in [1440,1024,390]:
   page.set_viewport_size({'width':width,'height':1000})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':1440,'height':1000})
  bar=page.locator('[data-pc1-drag-task]').first;bar.scroll_into_view_if_needed();box=bar.bounding_box()
  page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+24,box['y']+box['height']/2,steps=8);page.mouse.up()
  expect(page.locator('[data-pc1-confirm]')).to_be_disabled();page.locator('[data-pc1-simulate]').click();expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
  expect(page.locator('[data-pc1-detail-start]')).to_be_disabled()
  locked_id=page.locator('[data-pc1-inspector-lock]').get_attribute('data-pc1-inspector-lock')
  locked_start=page.locator('[data-pc1-detail-start]').input_value()
  page.locator('[data-pc1-inspector-lock]').click();expect(page.locator('[data-pc1-detail-start]')).to_be_enabled()
  precise=(datetime.fromisoformat(locked_start)+timedelta(minutes=1)).isoformat(timespec='minutes')
  page.locator('[data-pc1-detail-start]').fill(precise);page.locator('[data-pc1-task-time-editor] button[type=submit]').click()
  expect(page.locator('[data-pc1-detail-start]')).to_have_value(precise)
  expect(page.locator('[data-pc1-detail-start]')).to_be_disabled();expect(page.locator('[data-pc1-confirm]')).to_be_disabled()
  page.locator('[data-pc1-simulate]').click();expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
  expect(page.locator('[data-pc1-detail-start]')).to_have_value(precise)
  expect(page.locator('[data-pc1-inspector-lock]')).to_have_attribute('data-pc1-inspector-lock',locked_id)
  page.locator('[data-pc1-day-width]').select_option('1152')
  micro=page.locator('[data-pc1-drag-task]:not(.is-locked)').first
  micro_id=int(micro.get_attribute('data-pc1-drag-task'))
  before_start=page.evaluate('(id)=>window.__APP_STATE__.pc1SchedulePreview.schedules.find(s=>s.id===id).plannedStartAt',micro_id)
  micro.scroll_into_view_if_needed();box=micro.bounding_box()
  page.keyboard.down('Shift');page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
  page.mouse.move(box['x']+box['width']/2+8,box['y']+box['height']/2,steps=4)
  expect(page.locator('.pc1-drag-readout')).to_contain_text('1分钟吸附')
  page.mouse.up();page.keyboard.up('Shift')
  expected_micro=(datetime.fromisoformat(before_start)+timedelta(minutes=10)).isoformat(timespec='minutes')
  expect(page.locator('[data-pc1-detail-start]')).to_have_value(expected_micro)
  expect(page.locator('.pc1-drag-readout')).to_have_count(0)
  page.locator('[data-pc1-simulate]').click();expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
  # Abort a drag and ensure the temporary readout and tentative transform disappear.
  abort=page.locator('[data-pc1-drag-task]:not(.is-locked)').first
  abort.scroll_into_view_if_needed();box=abort.bounding_box()
  before_abort=page.evaluate('JSON.stringify(window.__APP_STATE__.pc1SchedulePreview)')
  page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+20,box['y']+box['height']/2,steps=4)
  abort.dispatch_event('pointercancel');page.mouse.up()
  expect(page.locator('.pc1-drag-readout')).to_have_count(0)
  assert page.evaluate('JSON.stringify(window.__APP_STATE__.pc1SchedulePreview)')==before_abort
  page.locator('[data-pc1-day-width]').select_option('192')
  check('fine-scale Shift drag snaps to the displayed minute; aborted drag leaves schedule unchanged and removes its overlay')
  check('joint controls are above timeline; task selection is read-only; invalid edits rejected; precise minute edit locks and survives recompute')
  page.screenshot(path=str(OUT/'02-simulate-adjust.png'),full_page=True)
  page.locator('[data-pc1-confirm]').click();page.locator('[data-modal-confirm]').click();page.wait_for_function('!window.__APP_STATE__.pc1SchedulePreview');saved(page)
  assert sum(row['vehicleRepairId']in ids for row in state(base)['snapshot']['data']['schedules'])==40
  clean_nav(page);check('resource preflight, 40-task simulation, actual drag/lock/recompute and formal confirmation work in the function-only entry')
  page.locator(NAV).nth(2).click()
  for key in ['resources','gantt','calendar']:
   page.locator(f'[data-pc1-vehicle-tab="{key}"]').click();clean_nav(page)
   if key=='gantt':
    page.locator('[data-pc1-query-task]').first.click();expect(page.locator('[data-task-detail-content]')).to_contain_text('人员安排');page.locator('[data-modal-confirm]').click()
  page.locator('[data-pc1-first-task]').click()
  for selector in ['.demo-day-task-title [data-task-detail]','.pc-event[data-task-detail]']:
   button=page.locator(selector).first;detail_id=int(button.get_attribute('data-task-detail'));button.click()
   expect(page.locator('[data-task-detail-content]')).to_have_attribute('data-task-detail-id',str(detail_id))
   expected=page.evaluate('(id)=>{const s=window.__APP_STATE__;return s.employeeAssignments.filter(a=>a.scheduleTaskId===id&&a.status!=="CANCELLED").map(a=>s.employees.find(e=>e.id===a.employeeId).name)}',detail_id)
   for name in expected:expect(page.locator('[data-task-detail-content]')).to_contain_text(name)
   expect(page.locator('[data-task-detail-content]')).to_contain_text('每人工时')
   expect(page.locator('[data-task-detail-content]')).to_contain_text('工具清单')
   expect(page.locator('[data-task-detail-content]')).to_contain_text('物料清单')
   page.locator('[data-modal-confirm]').click()
  check('calendar events, daily task names and Gantt bars open task-specific assigned personnel, working hours and tool/material requirements')
  page.screenshot(path=str(OUT/'03-single-vehicle.png'),full_page=True)
  page.locator(NAV).nth(3).click();expect(page.locator('[data-wc-day]').first).to_be_visible()
  page.locator(NAV).nth(4).click();expect(page.locator('[data-pc1-records]')).to_be_visible();clean_nav(page)
  page.reload();page.wait_for_load_state('networkidle');clean_nav(page)
  assert not errors,errors
  check('single-vehicle resources/Gantt/calendar, workshop calendar and control continue to show the same saved schedule after refresh')
  browser.close()
 server.stdin.write('stop\n');server.stdin.flush();server.wait(timeout=35);assert server.returncode==0;server=None
 assert state('http://127.0.0.1:5193')==original
 check('original database unchanged; isolated test schema removed')
 (OUT/'report.json').write_text(json.dumps({'passed':True,'checks':checks,'browserErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
finally:
 if server and server.poll()is None:
  server.stdin.write('stop\n');server.stdin.flush();server.wait(timeout=35)
