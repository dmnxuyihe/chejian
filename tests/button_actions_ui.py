"""Exercise state-changing controls only in an isolated PostgreSQL schema."""
import json,os,sys,subprocess,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
OUT=ROOT/'test-artifacts/button-actions';OUT.mkdir(parents=True,exist_ok=True)
server=subprocess.Popen([shutil.which('node'),'tests/pc1_ui_server.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
page=None;checks=[];clicks=0
def check(name):checks.append(name);print('PASS '+name,flush=True)
def click(selector):
 global clicks
 page.locator(selector).click();clicks+=1
def saved():
 result=page.evaluate('window.__APP_DEBUG__.getPersistence().save()');assert result['ok'],result
def state():return page.request.get(base+'/api/state').json()['snapshot']['data']
try:
 ready=json.loads(server.stdout.readline());base=ready['base']
 with sync_playwright()as p:
  browser=p.chromium.launch(channel='msedge',headless=True);page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(8000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+'/#/system-admin/resources');page.wait_for_load_state('networkidle')
  for key in ['employees','teams','workstations','equipment','tools','materials','spareParts']:
   click('[data-resource-tab="'+key+'"]');click('[data-add-resource]')
   fields=page.locator('.modal [data-f]');tag='BTN_'+key.upper()
   for i in range(fields.count()):
    field=fields.nth(i);name=field.get_attribute('data-f')
    if field.evaluate('e=>e.tagName')=='SELECT':continue
    value='1' if field.get_attribute('type')=='number' else '2026-10-01' if 'date' in name or name.endswith('_at')else '件'if name=='unit'else tag if name in ['code','no','name']else '按钮测试'
    field.fill(value)
   click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
   row=next(r for r in state()[key]if r.get('name')==tag);id=row['id']
   if key=='equipment':assert row['workstationId'] is None
   if key=='tools':assert row['inspectionCycleMonths']==1 and row['lastInspectionAt'].startswith('2026-10-01')
   if key=='spareParts':assert row['manufactureDate']=='2026-10-01'
   click('[data-edit="'+str(id)+'"]');page.locator('[data-f="name"]').fill(tag+'_EDIT');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
   assert next(r for r in state()[key]if r['id']==id)['name']==tag+'_EDIT'
   click('[data-delete="'+str(id)+'"]');saved();assert not any(r['id']==id for r in state()[key])
   check(key+' tab, add, edit and delete really persist')
  click('[data-resource-tab="tools"]');click('[data-add-resource]')
  page.locator('[data-f="code"]').fill('BTN-OPTIONAL');page.locator('[data-f="name"]').fill('可选项留空');page.locator('[data-f="quantity"]').fill('1.5');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(1)
  page.locator('[data-f="quantity"]').fill('1');page.locator('[data-f="last_inspection_at"]').fill('无效日期');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(1)
  page.locator('[data-f="last_inspection_at"]').fill('');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
  row=next(r for r in state()['tools']if r['code']=='BTN-OPTIONAL');assert row['lastInspectionAt'] is None
  click('[data-delete="'+str(row['id'])+'"]');saved();check('tool invalid fraction/date stays in form; optional empty date saves as SQL NULL')
  click('[data-resource-tab="employees"]');count=len(state()['employees']);click('[data-delete="1"]');assert len(state()['employees'])==count;expect(page.locator('.toast').last).to_contain_text('删除失败')
  check('referenced employee delete is blocked without losing assignments')
  page.goto(base+'/#/component-management/components');page.wait_for_load_state('networkidle');click('[data-add-component]')
  page.locator('[data-f="serialNo"]').fill('BTN-COMP');page.locator('[data-f="assetCode"]').fill('BTN-ASSET');page.locator('[data-f="location"]').fill('测试库房')
  click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved();id=next(r['id']for r in state()['componentInstances']if r['serialNo']=='BTN-COMP')
  click('[data-edit-component="'+str(id)+'"]');page.locator('[data-f="serialNo"]').fill('BTN-COMP-EDIT');click('[data-modal-confirm]');saved();assert next(r for r in state()['componentInstances']if r['id']==id)['serialNo']=='BTN-COMP-EDIT'
  click('[data-delete-component="'+str(id)+'"]');saved();assert not any(r['id']==id for r in state()['componentInstances'])
  check('component add/edit/delete controls persist instance fields')
  # Add an otherwise idle same-team worker for a real foreman swap.
  page.goto(base+'/#/system-admin/resources');page.wait_for_load_state('networkidle');click('[data-resource-tab="employees"]');click('[data-add-resource]')
  page.locator('[data-f="no"]').fill('BTN-EXTRA');page.locator('[data-f="name"]').fill('按钮测试增员');page.locator('[data-f="teamId"]').select_option('1');click('[data-modal-confirm]');saved();extra=next(r['id']for r in state()['employees']if r['no']=='BTN-EXTRA')
  page.goto(base+'/#/foreman/team-tasks');page.wait_for_load_state('networkidle');task=int(page.locator('[data-fine-tune]').first.get_attribute('data-fine-tune'))
  page.locator('[data-fine-tune]').first.click();clicks+=1;page.locator('[data-new]').select_option(str(extra));page.locator('[data-reason]').fill('隔离测试：验证换人按钮');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
  assert any(r['scheduleTaskId']==task and r['employeeId']==extra and r['status']!='CANCELLED'for r in state()['employeeAssignments'])
  check('foreman task bar opens dialog and confirmation swaps to same-team worker')
  page.goto(base+'/#/worker/my-tasks');page.wait_for_load_state('networkidle');page.locator('[data-worker-select]').select_option(str(extra));click('[data-start-task="'+str(task)+'"]');saved();assert next(r for r in state()['schedules']if r['id']==task)['status']=='IN_PROGRESS'
  click('[data-complete-task="'+str(task)+'"]');saved();assert next(r for r in state()['schedules']if r['id']==task)['status']=='COMPLETED'
  page.goto(base+'/#/inspector/inspections');page.wait_for_load_state('networkidle');click('[data-inspect="'+str(task)+'"]');page.locator('[data-opinion]').fill('隔离测试：质检按钮正常');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
  assert next(r for r in state()['qualityRecords']if r['scheduleTaskId']==task)['status']=='PASS'
  check('worker start/complete and inspector confirmation update formal task and quality records')
  page.goto(base+'/#/technical/process');page.wait_for_load_state('networkidle');page.locator('[data-process-detail]').first.click();clicks+=1;expect(page.locator('.modal-body')).to_contain_text('前置任务');page.keyboard.press('Escape');expect(page.locator('.modal-backdrop')).to_have_count(0)
  check('process details dialog opens and Escape closes it')
  page.goto(base+'/#/scheduling/workforce');page.wait_for_load_state('networkidle');click('[data-pc1-vehicle-tab="resources"]')
  for kind in ['tools','materials']:
   click('[data-resource-tab="'+kind+'"]');button=page.locator('[data-resource-edit="'+kind+'"]:visible').first
   if button.count():
    id=int(button.get_attribute('data-resource-id'));old=next(r['quantity']for r in state()[kind]if r['id']==id);button.click();clicks+=1
    page.locator('#supply-quantity').fill(str(float(old)+1));click('[data-modal-confirm]');saved();assert next(r['quantity']for r in state()[kind]if r['id']==id)==float(old)+1
   demand=page.locator('[data-resource-demand="'+kind+'"]:visible').first
   # Demand rows are inside task disclosure controls.
   details=page.locator('#resource-panel-'+kind+' details').first
   if details.count():details.locator('summary').click();clicks+=1
   if demand.count()and demand.is_visible():
    demand.click();clicks+=1;old=page.locator('#task-quantity').input_value();page.locator('#task-quantity').fill('0');click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(1);page.locator('#task-quantity').fill(old);click('[data-modal-confirm]');expect(page.locator('.modal-backdrop')).to_have_count(0);saved()
  check('tool/material availability edit and task-quantity validation controls work')
  page.goto(base+'/#/scheduling/workshop-calendar');page.wait_for_load_state('networkidle')
  beforeMonth=page.locator('[data-wc-month]').input_value();click('[data-wc-month-step="1"]');assert page.locator('[data-wc-month]').input_value()!=beforeMonth;click('[data-wc-month-step="-1"]');assert page.locator('[data-wc-month]').input_value()==beforeMonth;click('[data-wc-today]')
  click('[data-wc-tab="vehicle"]');page.locator('[data-wc-jump-day]').first.click();clicks+=1
  page.locator('[data-wc-task]').first.click();clicks+=1;expect(page.locator('.modal-body')).to_contain_text('计划开始');page.keyboard.press('Escape')
  click('[data-wc-tab="gantt"]')
  start=page.locator('[data-gantt-range="start"]');start.fill('2030-01-01');start.dispatch_event('change');click('[data-gantt-reset]')
  with page.expect_download()as event:click('[data-wc-export]')
  file=OUT/event.value.suggested_filename;event.value.save_as(str(file))
  with zipfile.ZipFile(file)as z:assert z.testzip()is None and 'xl/workbook.xml'in z.namelist()
  check('workshop previous/next/today, tabs, task detail, range reset and real Excel export work')
  assert not errors,errors
  (OUT/'report.json').write_text(json.dumps({'passed':True,'clickActions':clicks,'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps({'passed':True,'clickActions':clicks,'groups':len(checks),'pageErrors':errors},ensure_ascii=False));browser.close()
except Exception:
 if page:
  try:page.screenshot(path=str(OUT/'failure.png'),full_page=True);(OUT/'failure.html').write_text(page.content(),encoding='utf-8')
  except Exception:pass
 raise
finally:
 try:server.stdin.write('close\n');server.stdin.flush();server.wait(timeout=25)
 except Exception:server.terminate()
 print(server.stderr.read(),flush=True)
