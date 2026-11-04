"""Read-only UI review against live PC1; business data is checked unchanged."""
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright, expect
OUT=ROOT/'test-artifacts/workspace-simple'
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5193'
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    before=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    routes=[('planning/plans','01-import'),('scheduling/dashboard','02-planning'),('scheduling/workforce','03-vehicle'),('scheduling/workshop-calendar','04-workshop'),('scheduling/gantt','05-dispatch')]
    for route,name in routes:
        page.goto(BASE+'/#/'+route)
        page.wait_for_load_state('networkidle')
        expect(page.locator('h1').first).to_be_visible()
        expect(page.locator('h1:visible')).to_have_count(1)
        assert page.locator('.btn-primary:visible').count() <= 1,route
        expect(page.locator('html')).to_have_class('dark')
        expect(page.locator('[data-mobile-nav]')).to_be_visible()
        expect(page.locator('.sidebar')).not_to_be_in_viewport()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),route
        if route=='scheduling/workforce':
            vehicle=next((v for v in before['vehicleRepairs'] if v['locomotiveNo']=='HXD1C-YS001'),None)
            if vehicle: page.locator('[data-pc1-query-vehicle]').select_option(str(vehicle['id']))
            page.locator('[data-pc1-vehicle-tab="records"]').click()
        if route=='planning/plans':
            expect(page.locator('.plan-guide img')).to_have_count(0)
            expect(page.locator('.guide-heading svg')).to_be_visible()
            expect(page.locator('.plan-flow-visual li')).to_have_count(3)
            assert page.locator('.plan-car-identity .locomotive-drawing').count()==len(page.locator('.plan-car-identity').all())
        page.screenshot(path=str(OUT/(name+'.png')))
        if route=='planning/plans':
            page.screenshot(path=str(OUT/'01-import-full.png'),full_page=True)
    page.goto(BASE+'/#/planning/plans')
    page.locator('[data-skip-content]').focus()
    page.keyboard.press('Enter')
    expect(page.locator('#main-content')).to_be_focused()
    assert page.url.endswith('#/planning/plans')
    menu=page.locator('.guide-other summary')
    menu.focus()
    page.keyboard.press('Enter')
    expect(page.get_by_role('link',name='下载 CSV 模板')).to_be_visible()
    page.locator('[data-open-manual]').click()
    expect(page.locator('[data-manual-loco]')).to_be_visible()
    page.screenshot(path=str(OUT/'06-import-controls.png'))
    page.locator('[data-theme-toggle]').click()
    expect(page.locator('html')).not_to_have_class('dark')
    page.reload()
    expect(page.locator('html')).not_to_have_class('dark')
    page.locator('[data-open-manual]').click()
    page.locator('[data-theme-toggle]').click()
    expect(page.locator('html')).to_have_class('dark')
    page.wait_for_function("getComputedStyle(document.querySelector('[data-manual-loco]')).backgroundColor==='rgb(38, 50, 61)' && getComputedStyle(document.querySelector('[data-manual-loco]')).color==='rgb(230, 237, 242)'")
    dark_field=page.locator('[data-manual-loco]').evaluate("e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color})")
    assert dark_field['background']=='rgb(38, 50, 61)' and dark_field['color']=='rgb(230, 237, 242)',dark_field
    page.screenshot(path=str(OUT/'07-dark.png'))
    page.reload()
    expect(page.locator('html')).to_have_class('dark')
    for width in [1024,768,390,375]:
        page.set_viewport_size({'width':width,'height':900})
        for route,name in routes[:4]:
            page.goto(BASE+'/#/'+route)
            page.wait_for_load_state('networkidle')
            overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth+1')
            if overflow:
                print(page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,16).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))"))
            assert not overflow,(route,width)
        page.locator('[data-mobile-nav]').click()
        expect(page.locator('[data-mobile-nav]')).to_have_attribute('aria-expanded','true')
        expect(page.locator('.sidebar')).to_be_in_viewport()
        page.locator('[data-mobile-nav]').click()
        expect(page.locator('.sidebar')).not_to_be_in_viewport()
        expect(page.locator('.toast')).to_have_count(0,timeout=5000)
        page.screenshot(path=str(OUT/f'08-mobile-{width}.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.goto(BASE+'/#/scheduling/workforce')
    page.wait_for_load_state('networkidle')
    page.locator('[data-pc1-vehicle-tab="records"]').click()
    record=page.locator('[data-pc1-record-task]').first
    if record.count():
        record.click()
        expect(page.locator('[role="dialog"]')).to_be_visible()
        page.screenshot(path=str(OUT/'09-record-modal.png'))
        page.keyboard.press('Escape')
        expect(page.locator('[role="dialog"]')).to_have_count(0)
        expect(record).to_be_focused()
    after=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    for key in ['vehicleRepairs','scheduleVersions','schedules','employeeAssignments','maintenanceRecords','pc1Dispatches']:
        assert before[key]==after[key],f'business data changed: {key}'
    assert not errors,errors
    (OUT/'report.json').write_text(json.dumps({'passed':True,'routes':[r for r,n in routes],'widths':[1440,1024,768,390,375],'checks':['single top navigation','role navigation drawer','task-first plan list and import guide','compact line icon without large illustration','SVG vehicle identity and three-stage flow diagram','template keyboard access','theme persistence and dark input contrast','mobile navigation','no document overflow','record modal focus restore','business data unchanged'],'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print('PASS: UI routes, themes, menus, mobile navigation, modal focus and unchanged live business data')
    browser.close()
