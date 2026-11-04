"""Check graphical coverage, truthful scope and role-specific views on every route."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
BASE='http://127.0.0.1:5193'
OUT=ROOT/'test-artifacts/workspace-graphics'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1280,'height':1000},reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'/#/select');page.wait_for_load_state('networkidle')
    before=page.request.get(BASE+'/api/state').json()
    routes=page.evaluate("""async()=>{const{roles}=await import('/src/roles/index.js');return Object.values(roles).flatMap(r=>Object.keys(r.pages).map(p=>({role:r.id,page:p,label:r.label}))) }""")
    checks=[];families=set();planned=0
    samples={'planning/plans','scheduling/dashboard','scheduling/workforce','scheduling/gantt','scheduling/workshop-calendar','foreman/team-tasks','worker/my-tasks','technical/process','tool-management/resources','equipment-management/resources','material-warehouse/resources','system-admin/resources','component-management/components','inspector/inspections','approval/g1-p1','safety-management/g1-p1','after-sales/g1-p1','workshop-management/control'}
    for width in [1280,768]:
        page.set_viewport_size({'width':width,'height':1000})
        for route in routes:
            path=route['role']+'/'+route['page']
            page.evaluate('(path)=>location.hash="#/"+path',path)
            page.wait_for_function('(r)=>window.__APP_DEBUG__.getRoute().role===r.role&&window.__APP_DEBUG__.getRoute().page===r.page',arg=route)
            expect(page.locator('.page-art-mark svg[data-art-kind]')).to_have_count(1)
            expect(page.locator('.workspace-location>a')).to_contain_text(route['label'])
            expect(page.locator('main h1:visible')).to_have_count(1)
            kinds=page.locator('main [data-art-kind]').evaluate_all('(els)=>els.map(e=>e.dataset.artKind)');families.update(kinds)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(path,width,'document overflow')
            if page.locator('[data-test="planned-page"]').count():
                expect(page.locator('.planned-copy')).to_contain_text('尚未实现')
                expect(page.locator('.scope-map .is-current')).to_have_count(1)
                expect(page.locator('.scope-map .is-current')).to_contain_text(page.locator('main h1').inner_text())
                if width==1280:planned+=1
            if path in ['tool-management/resources','equipment-management/resources','material-warehouse/resources']:
                active={'tool-management':'tools','equipment-management':'equipment','material-warehouse':'materials'}[route['role']]
                expect(page.locator('[data-resource-tab].active')).to_have_attribute('data-resource-tab',active)
                expect(page.locator('.collection-heading')).to_be_visible()
            if width==1280 and path in samples:
                page.screenshot(path=str(OUT/(path.replace('/','-')+'.png')),full_page=True)
            checks.append({'route':path,'width':width,'graphics':kinds})
    # Ring graphics use the same actual values as the accessible native progress.
    page.goto(BASE+'/#/scheduling/control');page.wait_for_load_state('networkidle')
    rings=page.locator('.station-progress-choice').evaluate_all("""els=>els.map(el=>{const p=el.querySelector('progress'),t=el.querySelector('.completion-ring text');return {value:p.value,max:p.max,text:t.textContent}})""")
    for ring in rings:assert ring['text']==str(int(ring['value']/ring['max']*100+0.5))+'%',ring
    page.locator('[data-mobile-nav]').click();expect(page.locator('.sidebar .nav-icon svg').first).to_be_visible();page.keyboard.press('Escape')
    after=page.request.get(BASE+'/api/state').json()
    assert before['snapshot']['data']==after['snapshot']['data'],'Business data changed'
    assert not errors,errors
    report={'passed':True,'routes':len(routes),'renderChecks':len(checks),'widths':[768,1280],'plannedPages':planned,'graphicFamilies':sorted(families),'checkedProgressRings':rings,'pageErrors':errors,'checks':checks}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items()if k!='checks'},ensure_ascii=False))
    browser.close()
