"""Browser acceptance of the seven continuous-use fixes, on isolated data."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

f=json.load(sys.stdin);out=Path(f['out']);checks=[];errors=[]
def note(name):
 checks.append(name);print(name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 ctx=browser.new_context(viewport={'width':1366,'height':768},timezone_id='Asia/Shanghai')
 page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def open_page(name):
  page.goto(f['base']+'/#/functions/assets/'+name,wait_until='networkidle');page.locator('main h1').wait_for()
 def query(value):
  page.locator('[name=query]').fill(value);page.locator('[data-tool-query] button[type=submit]').click()
 def navigate(name,wait):
  page.locator(f'a[href="#/functions/assets/{name}"]').first.click();page.locator(wait).wait_for()
 def close():page.locator('.modal [data-modal-cancel]').click()
 try:
  open_page('tool-register');query('CONTEXT-EDIT')
  page.locator(f'[data-tool-check="asset:{f["edit"]}"]').check();page.locator('[data-tool-table-action=edit]').click()
  expect(page.locator('[data-f=receivedAt]')).to_have_value('2026-11-12T02:30')
  expect(page.locator('[data-f=lastInspectionAt]')).to_have_value('2026-11-12')
  expect(page.locator('[data-f=lastRepairAt]')).to_have_value('2026-11-11')
  page.locator('[data-f=tag]').fill('CONTEXT-TAG');page.locator('[data-f=actor]').fill('上下文编辑员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached')
  saved=page.request.get(f['base']+'/api/state').json()['snapshot']['data']['toolManagement']['assets']
  a=next(a for a in saved if a['id']==f['edit']);assert a['receivedAt']==f['stamp'] and a['lastInspectionAt']==f['stamp']
  note('F01 unchanged timestamps preserve seconds, timezone and date-only facts')
  helpers=page.evaluate("""async()=>{const d=await import('/src/shared/tool-dates.js');return {local:d.toolDateTimeInput('2026-11-11T18:30:37.123Z'),changed:d.toolTimeValue('2026-11-12T03:45','2026-11-11T18:30:37.123Z'),legacy:d.toolTimeValue('2026-11-12T10:30','2026-11-12T10:30:59'),day:d.toolDateInput('2026-11-11'),clear:d.toolTimeValue('','2026-11-11T18:30:00Z')}}""")
  assert helpers=={'local':'2026-11-12T02:30','changed':'2026-11-11T19:45:00.000Z','legacy':'2026-11-12T10:30:59','day':'2026-11-11','clear':''}
  utc=browser.new_context(timezone_id='UTC');u=utc.new_page();u.goto(f['base'],wait_until='networkidle')
  assert u.evaluate("async()=>{const d=await import('/src/shared/tool-dates.js');return d.toolDateTimeInput('2026-11-11T18:30:37.123Z')}")=='2026-11-11T18:30';utc.close()
  note('F01 timezone boundary, explicit time change, legacy wall-clock and clearing')
  query('CONTEXT');page.locator('[name=query]').fill('待查的新编号')
  page.locator(f'[data-tool-check="asset:{f["edit"]}"]').check();expect(page.locator('[name=query]')).to_have_value('待查的新编号');expect(page.locator('[data-query-pending]')).to_be_visible()
  page.locator('[data-tool-sort]').first.click();expect(page.locator('[name=query]')).to_have_value('待查的新编号');expect(page.locator('[data-query-pending]')).to_be_visible()
  note('F03 selection and sorting preserve query draft and pending state')
  navigate('tool-records','[data-record-form]');navigate('tool-register','[data-tool-query]')
  expect(page.locator('[name=query]')).to_have_value('待查的新编号');expect(page.locator(f'[data-tool-check="asset:{f["edit"]}"]')).to_be_checked();expect(page.locator('[data-query-pending]')).to_be_visible()
  query('CONTEXT-EDIT');navigate('tool-records','[data-record-form]');navigate('tool-register','[data-tool-query]');expect(page.locator('[name=query]')).to_have_value('CONTEXT-EDIT');expect(page.locator('[data-query-pending]')).to_be_hidden()
  page.reload(wait_until='networkidle');expect(page.locator('[name=query]')).to_have_value('CONTEXT-EDIT')
  note('F04 subpage return preserves applied conditions, draft and selection; reload restores ledger')
  navigate('tool-records','[data-record-form]');page.locator('.tool-record-advanced summary').click();page.locator('[data-record-query]').fill('CONTEXT-BULK');page.locator('[data-record-since]').fill('2026-11-12T02:00');page.locator('[data-record-form] button[type=submit]').click()
  row=page.locator(f'[data-record-id="{f["loan"]}"]').locator('xpath=ancestor::tr');expect(row).to_contain_text('2026-11-12 02:30');expect(row).to_contain_text('2099-01-01 10:00')
  with page.expect_download() as dl:page.locator('[data-record-export]').click()
  assert '2026-11-12 02:30' in Path(dl.value.path()).read_text(encoding='utf-8-sig')
  page.locator('[data-record-since]').fill('2026-11-12T03:00');page.locator('[data-record-form] button[type=submit]').click();expect(page.locator('[data-record-id]')).to_have_count(0)
  note('F02 local date display, filter boundary and CSV agree')
  page.locator('[data-record-reset]').click();page.locator('[data-record-status]').select_option('todo');page.locator('[data-record-warehouse]').select_option(str(f['warehouse']));page.locator('[data-record-borrow-type]').select_option('检修使用')
  ids=page.locator('[data-record-id]').evaluate_all('(els)=>els.map(e=>Number(e.dataset.recordId))');assert set(ids)=={f['loan'],f['kitLoan']}
  expect(page.locator('[data-record-table]')).to_contain_text('上下文套装');expect(page.locator('[data-record-table]')).to_contain_text('CONTEXT-KIT')
  expect(page.locator('[data-record-applied]')).to_contain_text('检修工具库');expect(page.locator('[data-record-applied]')).to_contain_text('检修使用')
  page.locator('[data-record-query]').fill('新查询草稿');navigate('tool-register','[data-tool-query]');navigate('tool-records','[data-record-form]');expect(page.locator('[data-record-query]')).to_have_value('新查询草稿');expect(page.locator('[data-record-pending]')).to_be_visible();expect(page.locator('[data-record-warehouse]')).to_have_value(str(f['warehouse']))
  page.locator('[data-record-query]').fill('');page.locator('[data-record-kind]').select_option('inspection');expect(page.locator('[data-record-loan-filters]')).to_be_hidden();page.locator('[data-record-kind]').select_option('loans');expect(page.locator('[data-record-id]')).to_have_count(2)
  note('F07 warehouse AND borrow type AND outstanding returns assets and kits, excludes returned and other warehouse')
  page.screenshot(path=str(out/'records.png'),full_page=True)
  navigate('tool-register','[data-tool-query]');page.locator('[data-tool-clear-selection]').click();query('CONTEXT-BULK');page.locator(f'[data-tool-check="asset:{f["bulk"]}"]').check();page.locator('[data-tool-table-action=borrow]').click()
  qty=page.locator('[data-batch-quantity]');expect(qty).to_have_attribute('max','2');qty.fill('3');page.locator('[data-f=borrower]').fill('数量错误不应保存');page.locator('[data-f=dueAt]').fill('2099-01-01T10:00');page.locator('[data-f=actor]').fill('上下文借用员');page.locator('[data-modal-confirm]').click();expect(qty).to_have_attribute('aria-invalid','true');expect(qty).to_be_focused();expect(page.locator('[data-tool-quantity-error]')).not_to_have_text('')
  # Another operator consumes one of the two pieces while this form is open.
  state=page.request.get(f['base']+'/api/state').json()
  response=page.request.post(f['base']+'/api/tools/commands',data={'type':'BORROW','payload':{'assetId':f['bulk'],'quantity':1,'borrower':'并发领用人','dueAt':'2099-01-01T10:00:00+08:00'},'actor':'另一经办人','requestId':'context-concurrent','revision':state['revision']});assert response.ok,response.text()
  qty.fill('2');page.locator('[data-modal-confirm]').click();expect(qty).to_have_attribute('max','1');expect(qty).to_be_focused();expect(page.locator('[data-tool-quantity-limit]')).to_contain_text('已更新');expect(page.locator('[data-tool-batch-state]')).to_contain_text('在库 1件');expect(page.locator('[data-f=borrower]')).to_have_value('数量错误不应保存')
  page.screenshot(path=str(out/'quantity-error.png'),full_page=True);close()
  note('F06 native upper bound, inline focus, concurrency recheck and preserved input')
  query('CONTEXT-DELETE');page.locator('[data-tool-clear-selection]').click();page.locator(f'[data-tool-check="asset:{f["del"]}"]').check();page.locator('[data-tool-table-action=delete]').click();expect(page.locator('.modal-body')).to_contain_text('CONTEXT-DELETE');expect(page.locator('.modal-body')).to_contain_text('无法在页面直接恢复');page.locator('[data-f=actor]').fill('上下文删除员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached')
  navigate('tool-records','[data-record-form]');page.locator('[data-record-audit]').click();page.locator('.modal [data-record-query]').fill('CONTEXT-DELETE');expect(page.locator('.modal [data-record-table]')).to_contain_text('删除工具实物');expect(page.locator('.modal [data-record-table]')).to_contain_text('检修工具库')
  deletion=page.locator('.modal tr').filter(has_text='删除工具实物').first;deletion.locator('[data-record-id]').check();page.locator('[data-record-action=audit-detail]').click();expect(page.locator('.modal')).to_contain_text('操作前');expect(page.locator('.modal')).to_contain_text('CONTEXT-DELETE');expect(page.locator('.modal')).to_contain_text('记录不存在');close();close()
  note('F05 deletion retains identity, searchable original code and before/after detail')
  # Verify source links override old ledger conditions and scoped reset remains reset after reload.
  page.goto(f['base']+'/#/functions/assets/tool-register?query=CONTEXT-BULK&noKits=1',wait_until='networkidle');expect(page.locator('[name=query]')).to_have_value('CONTEXT-BULK');page.locator('[data-tool-reset-query]').click();page.reload(wait_until='networkidle');expect(page.locator('[name=query]')).to_have_value('')
  note('F04 explicit source scope overrides remembered criteria; reset removes URL context')
  # Layout at common sizes, plus every one of the six tool entries.
  for width,height in [(1366,768),(1024,800),(390,844)]:
   page.set_viewport_size({'width':width,'height':height})
   for name in ['tool-dashboard','tool-register','tool-inventory','tool-records','tool-warnings','tool-data']:
    open_page(name);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,name)
   page.screenshot(path=str(out/f'layout-{width}.png'),full_page=True)
  assert not errors,errors
  note('six tool pages fit desktop, tablet and phone without body horizontal overflow')
 finally:
  (out/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'productionWrites':False},ensure_ascii=False,indent=2),encoding='utf8');browser.close()
