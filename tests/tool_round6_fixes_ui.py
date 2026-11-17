import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
f=json.load(sys.stdin);out=Path(f['out']);checks=[];errors=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':1366,'height':768},timezone_id='Asia/Shanghai');page.on('pageerror',lambda e:errors.append(str(e)))
 def note(s):checks.append(s);print(s,flush=True)
 def state():return page.request.get(f['base']+'/api/state').json()
 def nav(name):page.goto(f['base']+'/#/functions/assets/'+name,wait_until='networkidle')
 def close():page.locator('.modal [data-modal-cancel]').click()
 def bind():page.locator('[data-base-tab=tools]').click();page.locator(f'[name=base-record][value="{f["bindingTool"]}"]').check();page.locator('[data-base-action=bind]').click()
 def bindings():return [r for r in state()['snapshot']['data']['toolRequirements'] if r['toolId']==f['bindingTool']]
 def query(q):page.locator('[data-warning-query] [name=query]').fill(q);page.locator('[data-warning-query] button[type=submit]').click()
 try:
  nav('tool-data');bind();page.locator('[data-f=taskId]').select_option(str(f['task']));page.locator('[data-f=quantity]').fill('2');page.locator('[data-f=actor]').fill('绑定维护员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert bindings()[0]['quantity']==2
  bind();page.locator('[data-f=taskId]').select_option(str(f['task']));expect(page.locator('[data-f=quantity]')).to_have_value('2');page.locator('[data-f=quantity]').fill('3');page.locator('[data-f=actor]').fill('绑定维护员');page.locator('[data-modal-confirm]').click();page.locator('.modal').wait_for(state='detached');assert len(bindings())==1 and bindings()[0]['quantity']==3
  bind();page.locator('[data-tool-unbind]').click();page.locator('[data-f=actor]').fill('解除维护员');page.locator('[data-modal-confirm]').click();page.locator('[data-tool-bindings]').wait_for();assert not bindings();assert any(r['action']=='REQUIREMENT_DELETE' and r['objects'][0]['before']['quantity']==3 for r in state()['snapshot']['data']['toolManagement']['audit']);close();note('K01 binding add/update/remove complete with historical snapshot')
  nav('tool-warnings');page.locator('[name=kind]').select_option('inspection');query('R6-EXP');expect(page.locator('.tool-overview-table tbody')).to_contain_text('已超期');expect(page.locator('.tool-overview-table tbody')).not_to_contain_text('即将到期');query('R6-IN20');expect(page.locator('.tool-overview-table tbody')).to_contain_text('20 天');alert=next(a for a in page.request.get(f['base']+'/api/tools/alerts').json()['alerts'] if a.get('assetId')==f['future20']);assert '30天内到期' in alert['message'];assert page.locator('.tool-overview-table tbody tr td').nth(5).inner_text() in alert['message'];query('R6-TOMORROW');expect(page.locator('.tool-overview-table tbody')).to_contain_text('即将到期');note('K02 recent expiry, 20-day window, local date and future control consistent')
  query('R6-EXP');page.locator('.tool-overview-table a').first.click();expect(page.locator('[data-tool-row]')).to_have_count(1);expect(page.locator('[data-tool-row]')).to_have_attribute('data-tool-row',f'asset:{f["expired"]}');assert page.locator('[data-tool-check]:checked').count()==0;page.screenshot(path=str(out/'fixed-exact-link.png'),full_page=True);page.locator('[data-tool-context-clear]').click();page.locator('[name=query]').fill('R6-EXP');page.locator('[data-tool-query] button[type=submit]').click();expect(page.locator('[data-tool-row]')).to_have_count(2);note('K03 exact warning link resolves one object; manual fuzzy search still returns both')
  assert not errors,errors
 finally:
  (out/'results.json').write_text(json.dumps({'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf8');b.close()
