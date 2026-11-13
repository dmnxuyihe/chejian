import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
f=json.load(sys.stdin);out=Path(f['out']);checks=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':1366,'height':768},timezone_id='Asia/Shanghai');page.on('pageerror',lambda e:errors.append(str(e)))
 def note(s):checks.append(s);print(s,flush=True)
 def state():return page.request.get(f['base']+'/api/state').json()
 def m():return state()['snapshot']['data']['toolManagement']
 def post(kind,payload):
  s=state();r=page.request.post(f['base']+'/api/tools/commands',data={'type':kind,'payload':payload,'actor':'另一管理员','requestId':f'fix4-{s["revision"]}-{kind}','revision':s['revision']});assert r.ok,r.text();return r.json()
 def nav(name):page.goto(f['base']+'/#/functions/assets/'+name,wait_until='networkidle')
 def action(key):return page.locator(f'[data-tool-table-action="{key}"]')
 def query(s):page.locator('[name=query]').fill(s);page.locator('[data-tool-query] button[type=submit]').click()
 def close():page.locator('.modal [data-modal-cancel]').click()
 def wait(check):
  for _ in range(160):
   if check():return
   page.wait_for_timeout(50)
  raise AssertionError('Database progress did not reach expected state')
 def count(id):return next(c for c in m()['counts'] if c['id']==id)
 def open_count(id):page.locator(f'[data-tool-count-select][value="{id}"]').check();action('count-open-selected').click();page.locator('[data-count-save-status]').wait_for()
 def kit(id):
  nav('tool-data');page.locator('[data-base-tab=kits]').click();page.locator(f'[name=base-record][value="{id}"]').check();page.locator('[data-base-action=edit]').click();page.locator('[data-f=actor]').fill('套装维护员')
 try:
  kit(f['kit']);expect(page.locator(f'[data-kit-quantity="{f["unused"]}"]')).to_be_disabled()
  page.locator(f'[data-kit-quantity="{f["unused"]}"]').evaluate('(e)=>e.value=0');page.locator('[data-f=name]').fill('日常工具包-修订');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert next(k for k in m()['kits'] if k['id']==f['kit'])['name']=='日常工具包-修订';note('H01 unselected invalid input does not block save')
  kit(f['kit']);other=page.locator(f'[data-kit-asset="{f["counter"]}"]');expect(other).to_be_disabled();expect(other).not_to_be_visible();assert '整备工具库' in other.locator('..').inner_text();wid=next(a['warehouseId'] for a in m()['assets'] if a['id']==f['counter']);page.locator('[data-f=kitWarehouseId]').select_option(str(wid));expect(other).to_be_visible();expect(other).to_be_enabled();assert not page.locator(f'[data-kit-asset="{f["a"]}"]').is_checked();close();note('H02 warehouse visible, other warehouse unavailable until explicit switch')
  kit(f['largeKit']);page.locator('[data-f=name]').fill('301成员-已更名');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert next(k for k in m()['kits'] if k['id']==f['largeKit'])['name']=='301成员-已更名';note('H05 301-member kit rename saved with identity protection')
  nav('tool-register');page.locator('[data-tool-reset-query]').click();query('R4-SERVICE-');page.locator('[data-tool-select-all]').check();action('inspection').click();page.locator('[data-f=provider]').fill('检'*120);page.locator('[data-f=reason]').fill('校'*500);page.locator('[data-f=actor]').fill('批量送检员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert len(m()['services'])==100;assert all(len(s['reason'])==500 and len(s['provider'])==120 for s in m()['services']);note('H04 100-item maximum-length public fields saved atomically')
  page.locator('[data-tool-clear-selection]').click();query('R4-GOOD');page.locator(f'[data-tool-check="asset:{f["good"]}"]').check();query('R4-DELETE');page.locator(f'[data-tool-check="asset:{f["bad"]}"]').check();action('borrow').click();page.locator('[data-f=borrower]').fill('批量恢复领用人');page.locator('[data-f=dueAt]').fill('2099-01-01T10:00');page.locator('[data-f=actor]').fill('批量恢复发放员');post('ASSET_DELETE',{'assetId':f['bad']});page.locator('[data-modal-confirm]').click();expect(page.locator('[data-tool-target-error]')).to_contain_text('R4-DELETE');assert not m()['loans'];page.locator('[data-tool-remove-invalid]').click();expect(page.locator('[data-f=borrower]')).to_have_value('批量恢复领用人');expect(page.locator('[data-f=actor]')).to_have_value('批量恢复发放员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert len(m()['loans'])==1 and m()['loans'][0]['lines'][0]['assetId']==f['good'];note('H06 invalid item named and removed explicitly; retained draft saved only after second confirmation')
  nav('tool-inventory');open_count(f['count1']);gate={}
  def hold(route):
   if route.request.post_data_json.get('type')=='COUNT_PROGRESS' and not gate:gate['route']=route
   else:route.continue_()
  page.route('**/api/tools/commands',hold);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('FOUND');wait(lambda:bool(gate));page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('MISSING');gate['route'].continue_();wait(lambda:count(f['count1']).get('progressRevision',0)==2);expect(page.locator('[data-count-save-status]')).to_contain_text('已保存');page.unroute('**/api/tools/commands',hold);action('count-exit').click();note('H03 slow successful save with newer draft remains correct')
  open_count(f['count2']);gate={}
  def lose(route):
   if route.request.post_data_json.get('type')=='COUNT_PROGRESS' and not gate:gate['response']=route.fetch().status;gate['route']=route
   else:route.continue_()
  page.route('**/api/tools/commands',lose);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('FOUND');wait(lambda:'route' in gate);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('MISSING');gate['route'].abort('failed');expect(page.locator('[data-count-save-status]')).to_contain_text('保存未完成');page.unroute('**/api/tools/commands',lose);action('count-retry').click();wait(lambda:count(f['count2']).get('progressRevision',0)==2);expect(page.locator('[data-count-save-status]')).to_contain_text('已保存');assert count(f['count2'])['lines'][0]['counted']==0;note('H03 committed response lost plus newer edit recovers in two revisions')
  page.screenshot(path=str(out/'fixed-count.png'),full_page=True)
  # Recover after a full reload, with an unresolved first request and newer draft.
  action('count-exit').click();new=post('COUNT_CREATE',{'warehouseId':wid});page.reload(wait_until='networkidle');open_count(new['id']);gate={};page.route('**/api/tools/commands',lose);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('FOUND');wait(lambda:'route' in gate);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('MISSING');gate['route'].abort('failed');expect(page.locator('[data-count-save-status]')).to_contain_text('保存未完成');page.unroute('**/api/tools/commands',lose);page.reload(wait_until='networkidle');open_count(new['id']);wait(lambda:count(new['id']).get('progressRevision',0)==2);expect(page.locator('[data-count-save-status]')).to_contain_text('已保存');assert count(new['id'])['lines'][0]['counted']==0;note('H03 unresolved request and newer edit survive browser reload')
  action('count-exit').click();new=post('COUNT_CREATE',{'warehouseId':wid});page.reload(wait_until='networkidle');open_count(new['id']);gate={};page.route('**/api/tools/commands',lose);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('FOUND');wait(lambda:'route' in gate);page.locator(f'[data-count-verified="{f["counter"]}"]').select_option('MISSING');post('COUNT_PROGRESS',{'id':new['id'],'progressRevision':1,'lines':[{'assetId':f['counter'],'counted':1}]});gate['route'].abort('failed');expect(page.locator('[data-count-save-status]')).to_contain_text('保存未完成');page.unroute('**/api/tools/commands',lose);action('count-retry').click();expect(page.locator('[data-count-save-status]')).to_contain_text('其他页面');assert count(new['id'])['progressRevision']==2 and count(new['id'])['lines'][0]['counted']==1;note('H03 actual other-operator edit remains protected after lost-response replay')
  assert not errors,errors
 finally:
  (out/'results.json').write_text(json.dumps({'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf8');b.close()
