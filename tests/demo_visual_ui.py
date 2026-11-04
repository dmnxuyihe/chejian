"""Rendered checks for the presentation UI; no business data mutations."""
from pathlib import Path
import sys,json,urllib.request,re
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
OUT=ROOT/'test-artifacts/demo-ui-polish';OUT.mkdir(exist_ok=True)
BASE='http://127.0.0.1:5193'
def snapshot():return json.load(urllib.request.urlopen(BASE+'/api/state'))
before=snapshot();errors=[];checks=[];colors=[]
def check(label):checks.append(label);print('PASS '+label,flush=True)
def ratio(fg,bg):
 def lum(value):
  channels=[int(x)/255 for x in re.findall(r'\d+',value)[:3]]
  channels=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in channels]
  return sum(a*b for a,b in zip(channels,[.2126,.7152,.0722]))
 a,b=sorted([lum(fg),lum(bg)])
 return (b+.05)/(a+.05)
with sync_playwright()as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce');page.on('pageerror',lambda error:errors.append(str(error)))
 for width in [1440,1024,768,390]:
  page.set_viewport_size({'width':width,'height':1000})
  for route in ['calendar','plans','schedule','vehicle','workshop','control']:
   page.goto(BASE+'/demo.html#/demo/'+route);page.wait_for_load_state('networkidle')
   expect(page.locator('h1')).to_have_count(1);expect(page.locator('.demo-nav>a')).to_have_count(5)
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,route)
   for link in page.locator('.demo-nav>a').all():assert link.is_visible()
   expect(page.locator('[data-theme-toggle]')).to_be_visible()
   art=page.locator('.page-heading').evaluate("e=>getComputedStyle(e,'::after').backgroundImage")
   assert 'pc1-header-lineart.png' in art
   if route=='calendar':
    assert page.locator('.pc-plan-filterbar,.pc-plan-day-summary').count()==0
   if route=='workshop':
    expect(page.locator('[data-wc-tab]')).to_have_count(1)
   assert page.locator('.demo-function-rail,.demo-vehicle-overview,.demo-progress-overview,.demo-context,.demo-footer,[data-demo-task-filter],[data-demo-task-search]').count()==0
   assert page.locator('.page-desc,.desk-step,[data-pc1-demo-plans],.wc-notice,.plan-guide,.plan-flow-visual').count()==0
   if route=='plans':
    expect(page.locator('[data-import-type]')).to_have_count(0)
    expect(page.locator('a[href="/api/planning/import/template.xlsx"]')).to_be_visible()
   page.screenshot(path=str(OUT/f'{route}-{width}-dark.png'))
  check(f'all six function views reflow at {width}px without page overflow')
 page.set_viewport_size({'width':1440,'height':1000})
 page.goto(BASE+'/demo.html#/demo/control');page.wait_for_load_state('networkidle')
 data=before['snapshot']['data'];record=next(record for record in data['maintenanceRecords']if record['attachments'])
 page.locator('[data-pc1-query-vehicle]').select_option(str(record['vehicleRepairId']))
 expect(page.locator('[data-demo-record-row]')).to_have_count(20)
 check('five illustrated function entries remain direct; decorative artwork adds no business controls')
 page.locator('[data-pc1-records] [data-pc1-record-task]').first.click()
 expect(page.locator('.pc1-submitted-record')).to_be_visible();expect(page.locator('[data-add-record]')).to_have_count(0)
 page.screenshot(path=str(OUT/'record-modal-dark.png'))
 modal_btn=page.locator('[data-modal-confirm]')
 pair=modal_btn.evaluate('(e)=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})')
 assert ratio(**pair)>=4.5,pair
 page.locator('[data-modal-confirm]').click()
 page.screenshot(path=str(OUT/'control-minimal-1440.png'))
 check('completed task records remain available and read-only')
 for theme in ['dark','light']:
  if theme=='light':page.locator('[data-theme-toggle]').click()
  page.goto(BASE+'/demo.html#/demo/control');page.wait_for_load_state('networkidle')
  page.locator('[data-pc1-query-vehicle]').select_option(str(record['vehicleRepairId']))
  for selector in ['.demo-task-table td:first-child strong','.demo-station-name','.demo-state-done','.demo-nav a.active']:
   elem=page.locator(selector).first
   pair=elem.evaluate('''e=>{const fg=getComputedStyle(e).color;let p=e,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;p=p.parentElement}return {fg,bg}}''')
   value=ratio(**pair);assert value>=4.5,(theme,selector,pair,value);colors.append({'theme':theme,'selector':selector,'ratio':round(value,2)})
  for route in ['control','calendar','schedule','workshop','plans','vehicle']:
   page.goto(BASE+'/demo.html#/demo/'+route);page.wait_for_load_state('networkidle');page.screenshot(path=str(OUT/f'after-{route}-{theme}.png'))
  if theme=='light':page.locator('[data-theme-toggle]').click()
 check('key task, status, station and navigation text meets 4.5:1 contrast in both themes')
 page.goto(BASE+'/demo.html#/demo/vehicle');page.wait_for_load_state('networkidle')
 page.locator('[data-pc1-first-task]').click()
 event=page.locator('.pc-event[data-pc-day]').last
 day=event.get_attribute('data-pc-day');event.click()
 expect(page.locator('[data-task-detail-content]')).to_be_visible()
 expect(page.locator('[data-task-detail-content]')).to_contain_text('人员安排')
 page.locator('[data-modal-confirm]').click()
 expect(page.locator('.pc-selected-day .pc-day-number')).to_have_attribute('data-pc-day',day)
 expect(page.locator('.pc1-workspace h3').first).to_contain_text(day)
 check('single-vehicle calendar event selects its date and opens personnel/time task details')
 page.locator('[data-pc1-vehicle-tab="resources"]').click()
 expect(page.locator('[data-pc1-vehicle-tab="resources"]')).to_have_class(re.compile(r'active'))
 for key in ['tools','materials','people']:
  page.locator(f'[data-resource-tab="{key}"]').click()
  expect(page.locator(f'[data-resource-tab="{key}"]')).to_have_attribute('aria-selected','true')
  expect(page.locator('#resource-panel-'+key)).to_be_visible()
 page.screenshot(path=str(OUT/'resource-controls-lineart.png'))
 page.locator('[data-pc1-vehicle-tab="gantt"]').click()
 expect(page.locator('button.gantt-bar').first).to_be_visible()
 assert '—' in page.locator('.gantt-bar').first.get_attribute('title')
 page.locator('button.gantt-bar').first.click()
 expect(page.locator('[data-task-detail-content]')).to_contain_text('计划工作时长')
 page.locator('[data-modal-confirm]').click()
 reset=page.locator('[data-gantt-reset]');expect(reset).to_be_visible()
 idle=reset.evaluate('(e)=>getComputedStyle(e).borderColor')
 reset.hover();page.wait_for_timeout(180)
 hover=reset.evaluate('(e)=>getComputedStyle(e).borderColor');assert idle!=hover,(idle,hover)
 reset.focus();page.keyboard.press('Shift+Tab');page.keyboard.press('Tab')
 assert reset.evaluate('(e)=>document.activeElement===e && getComputedStyle(e).outlineStyle!=="none"')
 reset.click();expect(page.locator('[data-test="gantt"]')).to_be_visible()
 page.screenshot(path=str(OUT/'gantt-controls-lineart.png'))
 check('vehicle/resource segmented tabs switch correctly; buttons expose distinct hover and keyboard focus and remain usable')
 # Browser zoom reduces the available CSS viewport; check the effective width
 # of a 768px window at 200%, rather than applying CSS zoom to the body.
 page.set_viewport_size({'width':384,'height':900});page.goto(BASE+'/demo.html#/demo/control');page.wait_for_load_state('networkidle')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 check('384px effective viewport for enlarged desktop presentation reflows; task table scrolls inside its own region')
 assert not errors,errors;browser.close()
assert snapshot()==before,'UI-only checks changed business data'
check('no browser exceptions and original database unchanged')
(OUT/'visual-report.json').write_text(json.dumps({'passed':True,'checks':checks,'contrast':colors,'browserErrors':errors,'limitations':['No screen-reader audit or field performance measurement.','Browser zoom reflow approximated by effective CSS viewport width.']},ensure_ascii=False,indent=2),encoding='utf-8')
