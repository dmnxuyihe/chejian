"""Function routes, catalog and responsive layout; requires enabled browser control."""
import json, os, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('PC1_TEST_BASE_URL','http://127.0.0.1:5193').rstrip('/')
OUT=ROOT/'test-artifacts/function-navigation';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'/#/select')
    expect(page.locator('[data-function-entry="monthly-calendar"]')).to_be_visible()
    expect(page).to_have_url(BASE+'/#/functions/plans/monthly-calendar')
    before=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    entries=page.evaluate("async()=> (await import('/src/functions/catalog.js')).functionEntries")
    assert len([entry for entry in entries if entry['status']=='implemented'])==28
    expect(page.locator('[data-nav-group]')).to_have_count(5)
    expect(page.locator('.sidebar .function-item')).to_have_count(20)
    expect(page.locator('.workspace-nav,.function-primary-card,[data-role-card],[data-switch-role]')).to_have_count(0)
    page.goto(BASE+'/#/functions/catalog')
    expect(page.locator('[data-function-directory]')).to_be_visible()
    expect(page.locator('[data-function-label]')).to_have_count(19)
    page.locator('[data-function-search]').fill('工具')
    expect(page.locator('.function-group:not([hidden])')).to_have_count(1)
    expect(page.locator('[data-function-label]:visible')).to_have_count(1)
    expect(page.locator('[data-function-label]:visible')).to_contain_text('工具管理')
    page.locator('[data-function-search]').fill('不存在XYZ')
    expect(page.locator('[data-function-empty]')).to_be_visible()
    page.locator('[data-function-search]').fill('')
    checks=0
    for width,dark in [(1440,True),(390,True),(1440,False),(390,False)]:
        page.set_viewport_size({'width':width,'height':1000})
        page.evaluate('(dark)=>document.documentElement.classList.toggle("dark",dark)',dark)
        for entry in entries:
            path=f"functions/{entry['group']}/{entry['id']}"
            page.evaluate('(path)=>location.hash="#/"+path',path)
            expect(page.locator('[data-function-entry="'+entry['id']+'"]')).to_be_visible()
            expect(page.locator('main h1:visible')).to_have_count(1)
            expect(page.locator('[data-role-card],[data-switch-role],.role-chip')).to_have_count(0)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(path,width,dark)
            assert not page.locator('a[href^="#/planning/"],a[href^="#/scheduling/"]').count(),path
            checks+=1
        page.goto(BASE+'/#/functions/catalog')
        expect(page.locator('[data-function-directory]')).to_be_visible()
        page.screenshot(path=str(OUT/f'catalog-{width}-{dark}.png'),full_page=True)
    for old,target in [('planning/plans','plans/plan-import'),('scheduling/dashboard','schedule/schedule'),('worker/my-tasks','execution/execution'),('system-admin/resources','settings/resources')]:
        page.goto(BASE+'/#/'+old)
        expect(page).to_have_url(BASE+'/#/functions/'+target)
    after=page.request.get(BASE+'/api/state').json()['snapshot']['data']
    for key in ['vehicleRepairs','scheduleVersions','schedules','employeeAssignments','maintenanceRecords','pc1Dispatches']:
        assert before[key]==after[key],f'business data changed: {key}'
    assert not errors,errors
    report={'passed':True,'functionCount':len(entries),'renderChecks':checks,'navigationEntries':18,'widths':[390,1440],'themes':['light','dark'],'checks':['monthly default','five sidebar groups','explicit catalog with alias search','all function routes','legacy deep links','business data unchanged'],'pageErrors':errors}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False));browser.close()
