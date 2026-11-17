import csv,json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
f=json.load(sys.stdin);out=Path(f['out']);checks=[];errors=[]
def note(title):checks.append(title);print(title,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);ctx=b.new_context(viewport={'width':1366,'height':768},timezone_id='Asia/Shanghai');page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def state():return page.request.get(f['base']+'/api/state').json()
 def raw_post(kind,payload):
  s=state();return page.request.post(f['base']+'/api/tools/commands',data={'type':kind,'payload':payload,'actor':'另一管理员','requestId':f'fixes-{s["revision"]}-{kind}','revision':s['revision']})
 def post(kind,payload):
  r=raw_post(kind,payload);assert r.ok,r.text();return r.json()
 def open_page(name):page.goto(f['base']+'/#/functions/assets/'+name,wait_until='networkidle');page.locator('main h1').wait_for()
 def nav(name,selector):page.locator(f'a[href="#/functions/assets/{name}"]').first.click();page.locator(selector).wait_for()
 def action(key):return page.locator(f'[data-tool-table-action="{key}"]')
 def query(s):page.locator('[name=query]').fill(s);page.locator('[data-tool-query] button[type=submit]').click()
 def close():page.locator('.modal [data-modal-cancel]').click()
 def count(id):return next(c for c in state()['snapshot']['data']['toolManagement']['counts'] if c['id']==id)
 def open_count(id):page.locator(f'[data-tool-count-select][value="{id}"]').check();action('count-open-selected').click();page.locator('[data-count-save-status]').wait_for()
 def wait_progress(id,minimum):
  for _ in range(60):
   if count(id).get('progressRevision',0)>=minimum:return
   page.wait_for_timeout(50)
  raise AssertionError('count progress not saved')
 try:
  open_page('tool-register');query('R3-PARTIAL');page.locator(f'[data-tool-check="asset:{f["bulk"]}"]').check();action('return').click()
  pick=page.locator('[data-return-pick="0"]');qty=page.locator('[data-return-line="0"]');pick.check();qty.fill('1');pick.uncheck();pick.check();expect(qty).to_have_value('1')
  page.locator('[data-return-all]').check();page.locator('[data-return-line="1"]').fill('2');page.locator('[data-return-all]').uncheck();page.locator('[data-return-all]').check();expect(qty).to_have_value('1');expect(page.locator('[data-return-line="1"]')).to_have_value('2');note('G01 checkbox and select-all toggles retain partial return quantities')
  for invalid in ['0','-1','','1.5','6']:
   qty.fill(invalid);expect(page.locator('[data-modal-confirm]')).to_be_disabled();expect(qty).to_have_attribute('aria-invalid','true');expect(page.locator('[data-return-error="0"]')).not_to_have_text('')
  pick.uncheck();expect(page.locator('[data-modal-confirm]')).to_be_enabled();pick.check();expect(qty).to_have_value('6');expect(page.locator('[data-modal-confirm]')).to_be_disabled();qty.fill('1');page.locator('[data-return-line="1"]').fill('1');expect(page.locator('[data-modal-confirm]')).to_be_enabled()
  page.locator('[data-f=returner]').fill('部分归还人员');page.locator('[data-f=actor]').fill('收回员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');loans=state()['snapshot']['data']['toolManagement']['loans'];assert [next(l for l in loans if l['id']==id)['lines'][0]['returned'] for id in f['loans']]==[1,1];note('G02 zero, negative, blank, decimal and over-limit returns blocked inline; corrected partial returns persist')
  nav('tool-records','[data-record-form]');page.locator('[data-record-query]').fill('R3-PARTIAL');page.locator('[data-record-form] button[type=submit]').click();page.locator(f'[data-record-id="{f["loans"][1]}"]').check();page.locator('[data-record-action=loan-detail]').click();expect(page.locator('.modal h3')).to_contain_text(f'借用单 #{f["loans"][1]}');expect(page.locator('[data-current-loan-info]')).to_contain_text('乙领用人');assert page.locator(f'[data-current-loan="{f["loans"][1]}"][aria-current=true]').count()>0;page.screenshot(path=str(out/'loan-detail.png'),full_page=True);close();note('G03 selected loan number, borrower and highlighted history visible')
  open_page('tool-warnings');page.locator('[name=kind]').select_option('overdue');expect(page.locator('main')).to_contain_text('已超期人员');expect(page.locator('[data-warning-ledger]')).to_have_count(1);page.screenshot(path=str(out/'overdue.png'),full_page=True);page.locator('[data-warning-ledger]').click();page.locator('[data-tool-check]').first.check();action('return').click();expect(page.locator('[data-return-line]')).to_have_count(1);page.locator('[data-f=returner]').fill('超期归还人');page.locator('[data-f=actor]').fill('超期收回员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');open_page('tool-warnings');expect(page.locator('[data-warning-ledger]')).to_have_count(0);note('G04 overdue queue opens existing return form and removes repaid loan')
  open_page('tool-inventory');open_count(f['exportCount'])
  with page.expect_download() as d:action('count-export').click()
  rows=list(csv.reader(Path(d.value.path()).read_text(encoding='utf-8-sig').splitlines()));assert rows[1][-1]=='2026-11-11 11:45';action('count-exit').click();note('G05 count export timestamp matches local display')
  held=[]
  def hold(route):
   if route.request.post_data_json.get('type')=='COUNT_PROGRESS':held.append(route)
   else:route.continue_()
  page.route('**/api/tools/commands',hold);open_count(f['inFlight']);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('FOUND')
  for _ in range(60):
   if held:break
   page.wait_for_timeout(50)
  assert held;nav('tool-register','[data-tool-query]')
  with page.expect_response(lambda r:'/api/tools/commands' in r.url):held.pop().continue_()
  wait_progress(f['inFlight'],1);page.unroute('**/api/tools/commands',hold);nav('tool-inventory','[data-count-save-status]');expect(page.locator('[data-count-save-status]')).to_contain_text('已保存');page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('MISSING');wait_progress(f['inFlight'],2);expect(page.locator('[data-count-save-status]')).to_contain_text('已保存');assert next(l for l in count(f['inFlight'])['lines'] if l['assetId']==f['counter'])['counted']==0
  current=count(f['inFlight']);r=raw_post('COUNT_PROGRESS',{'id':f['inFlight'],'progressRevision':current['progressRevision']-1,'lines':[{'assetId':f['counter'],'counted':1}]});assert r.status==400;assert next(l for l in count(f['inFlight'])['lines'] if l['assetId']==f['counter'])['counted']==0;page.screenshot(path=str(out/'count-saved.png'),full_page=True);note('G06 save completes across navigation, next edit saves, true stale version rejected')
  action('count-exit').click();open_count(f['inFlight']);expect(page.locator(f'[data-count-verified="{f["counter"]}"]')).to_have_value('MISSING');note('G06 exit and reopen retains confirmed count progress')
  open_page('tool-register');page.locator('[data-tool-reset-query]').click()
  if page.locator('[data-tool-clear-selection]').count():page.locator('[data-tool-clear-selection]').click()
  page.locator(f'[data-tool-check="asset:{f["replacement"]}"]').check();nav('tool-records','[data-record-form]');post('ASSET_DELETE',{'assetId':f['replacement']});new=post('ASSET_CREATE',{'toolId':f['tool'],'warehouseId':f['warehouse'],'code':'FIX-REPLACEMENT','quantity':1,'mode':'NUMBERED'});assert new['id']>f['replacement'];page.reload(wait_until='networkidle');nav('tool-register','[data-tool-query]');expect(page.locator('[data-tool-check]:checked')).to_have_count(0);note('G07 deleted object IDs never reused and old selection does not select replacement')
  original=post('ASSET_CREATE',{'toolId':f['tool'],'warehouseId':f['warehouse'],'code':'FIX-FORM-ORIGINAL','quantity':1,'mode':'NUMBERED'});page.reload(wait_until='networkidle');query('FIX-FORM-ORIGINAL');page.locator(f'[data-tool-check="asset:{original["id"]}"]').check();action('borrow').click();page.locator('[data-f=borrower]').fill('不得借错工具');page.locator('[data-f=dueAt]').fill('2099-01-01T10:00');page.locator('[data-f=actor]').fill('发放员');original_identity=next(a for a in state()['snapshot']['data']['toolManagement']['assets'] if a['id']==original['id'])['identity']
  post('ASSET_DELETE',{'assetId':original['id']});replacement=post('ASSET_CREATE',{'toolId':f['tool'],'warehouseId':f['warehouse'],'code':'FIX-FORM-NEW','quantity':1,'mode':'NUMBERED'});page.locator('[data-modal-confirm]').click();expect(page.locator('[data-tool-form-error]')).to_contain_text('重新选择');expect(page.locator('[data-modal-confirm]')).to_be_disabled();assert not any(l['borrower']=='不得借错工具' for l in state()['snapshot']['data']['toolManagement']['loans']);page.screenshot(path=str(out/'stale-form-blocked.png'),full_page=True);close()
  denied=raw_post('BORROW',{'assetId':replacement['id'],'quantity':1,'borrower':'错误身份','dueAt':'2099-01-01','expectedObjects':[{'kind':'asset','id':replacement['id'],'identity':original_identity}]});assert denied.status==400 and denied.json()['toolTargetChanged'];note('G07 stale form blocked after refresh and server atomically rejects mismatched object identity')
  page.locator('[data-tool-reset-query]').click();query('R3-RETRY');page.locator(f'[data-tool-check="asset:{f["retry"]}"]').check();action('borrow').click();page.locator('[data-f=borrower]').fill('丢响应幂等重试');page.locator('[data-f=dueAt]').fill('2099-01-01T10:00');page.locator('[data-f=actor]').fill('发放员');lost=[]
  def lose(route):
   if route.request.post_data_json.get('type')=='BATCH' and not lost:lost.append(route.fetch().status);route.abort('failed')
   else:route.continue_()
  page.route('**/api/tools/commands',lose);page.locator('[data-modal-confirm]').click();expect(page.locator('[data-tool-form-error]')).not_to_have_text('');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');page.unroute('**/api/tools/commands',lose);assert len([l for l in state()['snapshot']['data']['toolManagement']['loans'] if l['borrower']=='丢响应幂等重试'])==1;note('lost successful response can still retry idempotently with identity guard')
  for width,height in [(1366,768),(1024,800),(390,844)]:
   page.set_viewport_size({'width':width,'height':height});open_page('tool-warnings');page.locator('[name=kind]').select_option('overdue');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert not errors,errors
 finally:(out/'report.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'productionWrites':False},ensure_ascii=False,indent=2),encoding='utf8');b.close()
