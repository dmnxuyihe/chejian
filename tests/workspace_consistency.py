"""Read-only rendered checks for the shared visual system across all role routes."""
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright, expect
BASE='http://127.0.0.1:5193'
OUT=ROOT/'test-artifacts/workspace-unified'
OUT.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto(BASE+'/#/select')
    expect(page.locator('[data-role-card]')).to_have_count(18)
    expect(page.locator('html')).to_have_class('dark')
    before=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    routes=page.evaluate("""async()=>{const {roles}=await import('/src/roles/index.js');return Object.values(roles).flatMap(role=>Object.keys(role.pages).map(page=>({role:role.id,page}))) }""")
    reference=None
    checks=[]
    for width,dark in [(1440,True),(375,True),(1440,False)]:
        page.set_viewport_size({'width':width,'height':1000})
        page.evaluate('(dark)=>document.documentElement.classList.toggle("dark",dark)',dark)
        page.evaluate('location.hash="#/select"')
        expect(page.locator('[data-role-card]')).to_have_count(18)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),('select',width,dark)
        assert page.locator('.topbar').evaluate('e=>Math.abs(e.getBoundingClientRect().width-innerWidth)<1'),('entry header width',width)
        if width==1440:
            page.screenshot(path=str(OUT/('01-select-dark.png' if dark else '01-select.png')),full_page=True)
        for route in routes:
            path=route['role']+'/'+route['page']
            page.evaluate('(path)=>location.hash="#/"+path',path)
            page.wait_for_function('(route)=>window.__APP_DEBUG__.getRoute().role===route.role && window.__APP_DEBUG__.getRoute().page===route.page',arg=route)
            expect(page.locator('.workspace-shell')).to_have_count(1)
            expect(page.locator('.workspace-brand')).to_be_visible()
            expect(page.locator('main h1:visible')).to_have_count(1)
            expect(page.locator('.sidebar')).not_to_be_in_viewport()
            overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
            if overflow:
                offenders=page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && !e.closest('.table-wrap,.gantt,.pc1-timeline-scroll,.pc-calendar-scroll,.tabs')).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))")
                raise AssertionError((path,width,dark,offenders))
            if width==1440:
                appearance=page.evaluate("""()=>{const style=selector=>getComputedStyle(document.querySelector(selector));return {header:style('.topbar').backgroundColor,titleSize:style('main h1').fontSize,titleWeight:style('main h1').fontWeight,padding:style('main').padding,font:style('main').fontFamily}}""")
                if not dark:
                    if reference is None: reference=appearance
                    assert appearance==reference,(path,appearance,reference)
                assert appearance['header']==('rgb(43, 53, 66)' if dark else 'rgb(255, 255, 255)'),(path,appearance)
            if dark and page.locator('main th').count():
                header_color=page.locator('main th').first.evaluate('e=>getComputedStyle(e).backgroundColor')
                assert header_color=='rgb(48, 61, 73)',(path,header_color)
            checks.append({'route':path,'width':width,'dark':dark})
            if path in ['planning/plans','foreman/team-tasks','worker/my-tasks','technical/process','tool-management/resources','approval/g1-p1'] and width==1440 and dark:
                page.screenshot(path=str(OUT/(path.replace('/','-')+'.png')))
        # Complete role navigation remains available even for roles with only planned pages.
        page.locator('[data-mobile-nav]').click()
        expect(page.locator('.sidebar')).to_be_in_viewport()
        assert page.evaluate("Math.abs(document.querySelector('.sidebar').getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().bottom)<1"),('drawer position',width)
        page.keyboard.press('Escape')
        expect(page.locator('.sidebar')).not_to_be_in_viewport()
    page.evaluate('location.hash="#/select"')
    expect(page.locator('[data-role-card]')).to_have_count(18)
    page.locator('[data-theme-toggle]').click()
    expect(page.locator('html')).to_have_class('dark')
    page.reload()
    expect(page.locator('html')).to_have_class('dark')
    page.locator('[data-role-card="worker"]').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    expect(page.locator('.modal-head [data-modal-close]')).to_be_focused()
    primary=page.locator('.modal .btn-primary').evaluate('e=>getComputedStyle(e).backgroundColor')
    assert primary=='rgb(40, 95, 99)',primary
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(page.locator('[data-role-card="worker"]')).to_be_focused()
    page.locator('[data-role-card="foreman"]').click()
    expect(page.locator('a[aria-current="page"]')).to_have_attribute('href','#/foreman/team-tasks')
    # Other roles must keep their own contextual links rather than PC1 links.
    assert all(href.startswith('#/foreman/') for href in page.locator('.workspace-nav a').evaluate_all('(links)=>links.map(a=>a.getAttribute("href"))'))
    after=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    for key in ['vehicleRepairs','scheduleVersions','schedules','employeeAssignments','maintenanceRecords','pc1Dispatches']:
        assert before[key]==after[key],f'business data changed: {key}'
    assert not errors,errors
    report={'passed':True,'routeCount':len(routes),'renderChecks':len(checks),'widths':[375,1440],'themes':['light','dark'],'checks':['shared header, title, spacing and font','all role routes','no page overflow','contextual role navigation','default reference palette and theme persistence','body-level modal primary action','modal focus return','live business data unchanged'],'pageErrors':errors}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    browser.close()
