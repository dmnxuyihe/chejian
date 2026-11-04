"""Actual reception, plan maintenance and cross-page execution in isolated PostgreSQL."""
import base64,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
OUT=ROOT/'test-artifacts/pc1-operations'
OUT.mkdir(parents=True,exist_ok=True)
server=subprocess.Popen([shutil.which('node'),'tests/pc1_ui_server.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
page=None
try:
    ready=json.loads(server.stdout.readline());base=ready['base']
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='msedge',headless=True)
        context=browser.new_context(viewport={'width':1440,'height':1000})
        page=context.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/#/scheduling/workforce')
        expect(page.locator('[data-vehicle-facts]')).to_contain_text('实际入段')
        expect(page.locator('[data-vehicle-facts]')).to_contain_text('未填写')
        actual=page.evaluate("async()=>{const {formatLocalDateTime}=await import('/src/core/derived.js');return {entry:formatLocalDateTime(new Date(Date.now()-86400000)).slice(0,16),stand:formatLocalDateTime(new Date(Date.now()-82800000)).slice(0,16)}}")
        page.locator('[data-vehicle-milestones]').click()
        page.locator('#actual-entry').fill('2099-01-01T08:00')
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('[data-vehicle-operation-error]')).to_contain_text('未来')
        page.locator('#actual-entry').fill(actual['entry'])
        page.locator('#on-stand').fill(actual['stand'])
        page.locator('#milestone-note').fill('隔离测试：现场接车与上台记录')
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('.modal-backdrop')).to_have_count(0)
        page.reload()
        expect(page.locator('[data-vehicle-facts]')).to_contain_text(actual['stand'].replace('T',' '))
        page.screenshot(path=str(OUT/'01-vehicle-details.png'),full_page=True)
        saved=page.request.get(base+'/api/state').json()['snapshot']['data']
        assert saved['vehicleRepairs'][0]['onStandAt'].startswith(actual['stand'])
        print('PASS: reception form rejects future dates, persists actual time and distinguishes missing data',flush=True)

        monitor=context.new_page();monitor.on('pageerror',lambda error:errors.append(str(error)))
        monitor.goto(base+'/#/scheduling/control')
        expect(monitor.locator('[data-workstation-monitor]')).to_be_visible()
        calendar=context.new_page();calendar.on('pageerror',lambda error:errors.append(str(error)))
        calendar.goto(base+'/#/planning/g2-p2')
        calendar.locator('[data-calendar-month]').fill('2026-10');calendar.locator('[data-calendar-month]').dispatch_event('change')
        calendar.locator('[data-open-vehicle="1"]').first.click()
        expect(calendar.locator('.pc-plan-drawer')).to_contain_text('已排程')
        fixture=page.evaluate("()=>{const s=window.__APP_STATE__,task=s.schedules.find(r=>r.vehicleRepairId===1&&r.taskId===1001);return {id:task.id,person:s.employeeAssignments.find(r=>r.scheduleTaskId===task.id).employeeId}}")
        page.goto(base+'/#/worker/my-tasks')
        page.locator('[data-worker-select]').select_option(str(fixture['person']))
        page.locator('[data-start-task="'+str(fixture['id'])+'"]').click()
        expect(monitor.locator('[data-monitor-task="'+str(fixture['id'])+'"]')).to_contain_text('进行中',timeout=15000)
        expect(calendar.locator('.pc-plan-drawer')).to_contain_text('检修中',timeout=15000)
        page.locator('[data-complete-task="'+str(fixture['id'])+'"]').click()
        expect(monitor.locator('[data-monitor-task="'+str(fixture['id'])+'"]')).to_contain_text('已完成',timeout=15000)
        monitor.locator('[data-pc1-record-task="'+str(fixture['id'])+'"]').click()
        expect(monitor.locator('.modal-body')).to_contain_text('尚未提交检测数据或附件')
        monitor.keyboard.press('Escape')
        expect(monitor.get_by_role('dialog')).to_have_count(0)
        expect(monitor.locator('[data-vehicle-facts]')).to_contain_text('实际第2天')
        monitor.evaluate('window.scrollTo(0,0)')
        monitor.screenshot(path=str(OUT/'02-workstation-progress.png'),full_page=True)
        monitor.reload()
        expect(monitor.locator('[data-monitor-task="'+str(fixture['id'])+'"]')).to_contain_text('已完成')
        calendar.close()
        print('PASS: published worker execution updates monitor and open monthly detail through PostgreSQL; progress survives reload',flush=True)

        today=page.evaluate("async()=>{const {dateKey}=await import('/src/core/planning-view.js');return dateKey(new Date())}")
        csv='机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\r\nOPS-UI-NEW,HXD1C,HXD1C高级修,1,'+today+',测试局,测试段,100.5,待修改计划\r\n'
        preview=page.request.post(base+'/api/planning/import/preview',data={'filename':'operations.csv','contentBase64':base64.b64encode(csv.encode('utf-8-sig')).decode(),'importType':'MONTHLY'}).json()
        assert preview['importable']==1,preview
        response=page.request.post(base+'/api/planning/import/confirm',data={'previewId':preview['id']})
        assert response.ok,response.text()
        page.goto(base+'/#/planning/plans')
        page.locator('[data-import-month]').fill(today[:7]);page.locator('[data-import-month]').dispatch_event('change')
        row=page.locator('.plan-record-table tr').filter(has_text='OPS-UI-NEW')
        expect(row).to_be_visible()
        row.locator('[data-plan-detail]').click()
        # Refresh the application state before maintenance; imported rows arrive through polling.
        page.evaluate('window.__APP_DEBUG__.getPersistence().load()')
        page.locator('[data-close-detail]').click();row.locator('[data-plan-detail]').click()
        page.locator('[data-plan-edit]').click()
        expect(page.get_by_role('dialog').filter(has=page.locator('[data-plan-edit-field]'))).to_be_visible()
        page.locator('[data-plan-edit-field="ownerDepot"]').fill('更正配属段')
        page.locator('[data-plan-edit-field="remark"]').fill('已通过界面修改')
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('.modal-backdrop')).to_have_count(0)
        row.locator('[data-plan-detail]').click()
        expect(page.locator('.pc-plan-drawer')).to_contain_text('更正配属段')
        page.screenshot(path=str(OUT/'03-plan-edited.png'))
        page.locator('[data-plan-delete]').click()
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('.modal-backdrop')).to_have_count(0)
        expect(page.locator('.plan-record-table tr').filter(has_text='OPS-UI-NEW')).to_have_count(0)
        assert not any(row['locomotiveNo']=='OPS-UI-NEW' for row in page.request.get(base+'/api/state').json()['snapshot']['data']['vehicleRepairs'])
        print('PASS: imported unscheduled plan edits and deletes through UI; PostgreSQL returns the changed facts',flush=True)
        monitor.set_viewport_size({'width':375,'height':900})
        assert monitor.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        monitor.screenshot(path=str(OUT/'04-mobile-monitor.png'),full_page=True)
        assert not errors,errors
        browser.close()
        (OUT/'report.json').write_text(json.dumps({'passed':True,'schema':ready['schema'],'checks':['actual-time validation and persistence','cross-tab execution and monthly-calendar feedback','station monitoring and completed records','plan maintenance persists','mobile monitor layout'],'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
except Exception:
    if page:
        try:page.screenshot(path=str(OUT/'failure.png'),full_page=True)
        except Exception:pass
    raise
finally:
    try:server.stdin.write('close\n');server.stdin.flush();server.wait(timeout=20)
    except Exception:server.terminate()
