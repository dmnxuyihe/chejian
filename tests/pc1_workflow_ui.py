"""PC1 browser acceptance; writes only an isolated PostgreSQL test schema."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test-artifacts' / 'python-deps'))
from playwright.sync_api import sync_playwright, expect

OUT = ROOT / 'test-artifacts' / 'pc1-complete'
OUT.mkdir(parents=True, exist_ok=True)
creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
server = subprocess.Popen([shutil.which('node'), 'tests/pc1_ui_server.mjs'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', creationflags=creationflags)
page = None
checks = []

def check(name):
    checks.append(name)
    print('PASS: ' + name, flush=True)

def wait_saved(page):
    page.wait_for_function('window.__APP_DEBUG__.getPersistence().status.ok')
    page.evaluate('window.__APP_DEBUG__.getPersistence().save()')

try:
    ready = json.loads(server.stdout.readline())
    base = ready['base']
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=os.environ.get('PC1_BROWSER_CHANNEL', 'msedge'), headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/#/scheduling/dashboard')
        page.wait_for_load_state('networkidle')
        expect(page.locator('[data-pc1-planning]')).to_be_visible()
        page.screenshot(path=str(OUT / '01-initial.png'), full_page=True)
        initial = page.evaluate('JSON.stringify(window.__APP_STATE__.schedules)')
        page.locator('.workspace-menu > summary').click()
        page.locator('[data-pc1-demo-plans]').click()
        wait_saved(page)
        expect(page.locator('[data-pc1-select-vehicle]:checked')).to_have_count(2)
        assert page.evaluate('window.__APP_STATE__.vehicleRepairs.length') == 3
        check('monthly calendar selects two adjacent-day plans without changing formal tasks')

        stock = page.evaluate("window.__APP_STATE__.materials.find(row=>row.name==='螺栓').quantity")
        page.evaluate("() => { window.__APP_STATE__.materials.find(row=>row.name==='螺栓').quantity=0; window.__APP_DEBUG__.render() }")
        wait_saved(page)
        page.locator('[data-pc1-simulate]').click()
        expect(page.locator('[data-pc1-preflight-result]')).to_contain_text('物料不足')
        assert page.evaluate('!window.__APP_STATE__.pc1SchedulePreview')
        assert page.evaluate('JSON.stringify(window.__APP_STATE__.schedules)') == initial
        page.evaluate("value=>{window.__APP_STATE__.materials.find(row=>row.name==='螺栓').quantity=value;window.__APP_DEBUG__.render()}",stock)
        wait_saved(page)
        check('insufficient material blocks simulation and preserves formal data')

        page.locator('[data-pc1-simulate]').click()
        expect(page.locator('[data-pc1-drag-task]')).to_have_count(40)
        expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
        assert page.evaluate('JSON.stringify(window.__APP_STATE__.schedules)') == initial
        wait_saved(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
        check('40 simulated tasks persist after reload without false stale detection')

        page.locator('[data-pc1-cancel]').click()
        wait_saved(page)
        assert page.evaluate('JSON.stringify(window.__APP_STATE__.schedules)') == initial
        assert not page.evaluate('Boolean(window.__APP_STATE__.pc1SchedulePreview)')
        check('cancelling a simulation keeps the old formal schedule')
        page.locator('[data-pc1-simulate]').click()
        bar = page.locator('[data-pc1-drag-task]').first
        task_id = int(bar.get_attribute('data-pc1-drag-task'))
        start = page.evaluate('id=>window.__APP_STATE__.pc1SchedulePreview.schedules.find(row=>row.id===id).plannedStartAt',task_id)
        bar.scroll_into_view_if_needed()
        box = bar.bounding_box()
        page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width']/2 + 24, box['y'] + box['height']/2, steps=8)
        page.mouse.up()
        page.wait_for_function('window.__APP_STATE__.pc1SchedulePreview.needsRecompute')
        moved = page.evaluate('id=>window.__APP_STATE__.pc1SchedulePreview.schedules.find(row=>row.id===id)',task_id)
        assert moved['plannedStartAt'] != start and moved['isLocked']
        expect(page.locator('[data-pc1-confirm]')).to_be_disabled()
        assert page.evaluate('JSON.stringify(window.__APP_STATE__.schedules)') == initial
        page.locator('[data-pc1-simulate]').click()
        expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
        assert page.evaluate('id=>window.__APP_STATE__.pc1SchedulePreview.schedules.find(row=>row.id===id).plannedStartAt',task_id) == moved['plannedStartAt']
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(OUT / '02-drag-lock-recompute.png'))
        check('real mouse drag changes and locks time; recompute preserves the lock')

        page.locator('[data-pc1-deadline]').fill('2026-10-28T09:00')
        page.locator('[data-pc1-deadline]').dispatch_event('change')
        page.locator('[data-pc1-simulate]').click()
        expect(page.locator('[data-pc1-preview-status]')).to_contain_text('超过最晚完成时间')
        expect(page.locator('[data-pc1-confirm]')).to_be_disabled()
        page.locator('[data-pc1-deadline]').fill('2026-11-15T18:00')
        page.locator('[data-pc1-deadline]').dispatch_event('change')
        page.locator('[data-pc1-simulate]').click()
        expect(page.locator('[data-pc1-confirm]')).to_be_enabled()
        check('deadline violations are visible and block confirmation')

        page.locator('[data-pc1-confirm]').click()
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('.modal-backdrop')).to_have_count(0)
        page.wait_for_function('!window.__APP_STATE__.pc1SchedulePreview && window.__APP_STATE__.pc1Dispatches.length===4')
        data = page.request.get(base+'/api/state').json()['snapshot']['data']
        assert len(data['schedules']) == 60
        car_id = next(row['id'] for row in data['vehicleRepairs'] if row['locomotiveNo']=='HXD1C-DEMO01')
        car = next(row for row in data['vehicleRepairs'] if row['id']==car_id)
        assert next(row for row in data['scheduleVersions'] if row['id']==car['currentVersionId'])['status']=='PUBLISHED'
        page.goto(base+'/#/scheduling/gantt')
        expect(page.locator('[data-pc1-dispatch]')).to_be_visible()
        expect(page.locator('.pc1-dispatch-item')).to_have_count(4)
        page.locator('.pc1-dispatch-item summary').first.click()
        expect(page.locator('.pc1-dispatch-item').first).to_contain_text('物料清单')
        check('atomic confirmation writes 40 formal tasks and four team dispatch lists to PostgreSQL')

        page.goto(base+'/#/scheduling/workforce')
        expect(page.locator('[data-pc1-vehicle-center]')).to_be_visible()
        page.locator('[data-pc1-query-vehicle]').select_option(str(car_id))
        page.locator('[data-pc1-vehicle-tab="calendar"]').click()
        expect(page.locator('.pc-calendar')).to_be_visible()
        page.locator('[data-pc1-vehicle-tab="gantt"]').click()
        expect(page.locator('[data-pc1-query-task]')).to_have_count(20)
        page.locator('[data-pc1-vehicle-tab="resources"]').click()
        expect(page.locator('[data-resource-lists]')).to_be_visible()
        for tab in ['people','tools','materials']:
            page.locator('[data-resource-tab="'+tab+'"]').click()
            expect(page.locator('#resource-panel-'+tab)).to_be_visible()
        page.goto(base+'/#/scheduling/workshop-calendar')
        expect(page.locator('[data-test="workshop-calendar"]')).to_be_visible()
        expect(page.locator('.wc-event').first).to_be_visible()
        check('single-car calendar, 20-task Gantt, three resource lists and workshop calendar use confirmed data')

        page.goto(base+'/#/scheduling/workforce')
        page.locator('[data-pc1-vehicle-tab="records"]').click()
        page.evaluate("""async id=>{
          const s=window.__APP_STATE__, v=s.vehicleRepairs.find(row=>row.id===id);
          const task=s.schedules.find(row=>row.vehicleRepairId===id&&row.versionId===v.currentVersionId&&row.taskId===1001);
          const owner=s.employeeAssignments.find(row=>row.scheduleTaskId===task.id).employeeId;
          const actions=await import('/src/core/actions.js');
          if(!actions.startTask(s,task.id,owner).ok||!actions.completeTask(s,task.id,owner).ok)throw Error('fixture completion failed');
          window.__APP_DEBUG__.render(); await window.__APP_DEBUG__.getPersistence().save();
        }""",car_id)
        expect(page.locator('[data-pc1-record-task]')).to_have_count(1)
        image = page.screenshot()
        encoded_video = page.evaluate("""async()=>{
          const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#635bff';ctx.fillRect(0,0,160,90);
          const stream=canvas.captureStream(10), recorder=new MediaRecorder(stream,{mimeType:'video/webm'}), parts=[];
          const done=new Promise(resolve=>{recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};recorder.onstop=resolve});
          recorder.start();await new Promise(resolve=>setTimeout(resolve,300));ctx.fillStyle='#10b981';ctx.fillRect(15,15,100,50);
          await new Promise(resolve=>setTimeout(resolve,300));recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
          return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(parts,{type:'video/webm'}))});
        }""")
        page.locator('[data-pc1-record-task]').click()
        expect(page.locator('.modal-body')).to_contain_text('尚未提交检测数据或附件')
        page.locator('[data-add-record]').click()
        page.locator('#pc1-record-person').fill('PC1验收人员')
        page.locator('#pc1-record-notes').fill('隔离测试数据：已完成任务的检测数据、图片和视频记录。')
        page.locator('[data-measure-name]').fill('检测温度')
        page.locator('[data-measure-value]').fill('25')
        page.locator('[data-measure-unit]').fill('℃')
        page.locator('#pc1-record-files').set_input_files([
            {'name':'检修照片.png','mimeType':'image/png','buffer':image},
            {'name':'检修视频.webm','mimeType':'video/webm','buffer':base64.b64decode(encoded_video)},
        ])
        page.locator('[data-modal-confirm]').click()
        expect(page.locator('.modal-backdrop')).to_have_count(0)
        page.locator('[data-pc1-record-task]').click()
        expect(page.locator('.pc1-submitted-record')).to_contain_text('检测温度')
        expect(page.locator('.pc1-attachments img')).to_have_count(1)
        expect(page.locator('.pc1-attachments video')).to_have_count(1)
        page.wait_for_function("document.querySelector('.pc1-attachments img')?.naturalWidth>0")
        page.wait_for_function("document.querySelector('.pc1-attachments video')?.videoWidth===160")
        playback = page.evaluate("""async()=>{const video=document.querySelector('.pc1-attachments video');video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,200));const at=video.currentTime;video.pause();return at}""")
        assert playback > 0, 'submitted WebM must actually play, not only render a video element'
        page.screenshot(path=str(OUT/'03-records-image-video.png'),full_page=True)
        page.locator('[data-modal-confirm]').click()
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('[data-pc1-vehicle-tab="records"]').click()
        page.locator('[data-pc1-record-task]').click()
        expect(page.locator('.pc1-submitted-record')).to_contain_text('PC1验收人员')
        expect(page.locator('.pc1-attachments video')).to_have_count(1)
        page.locator('[data-modal-confirm]').click()
        page.set_viewport_size({'width':390,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        page.screenshot(path=str(OUT/'04-mobile-control.png'),full_page=True)
        assert not errors, '\n'.join(errors)
        check('real image and playable WebM submit, display and survive reload; mobile does not overflow')
        browser.close()
    report = {'passed':True,'checks':checks,'schema':ready['schema'],'screenshots':str(OUT)}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
except Exception:
    if page:
        try:
            page.screenshot(path=str(OUT/'failure.png'),full_page=True)
            (OUT/'failure.html').write_text(page.content(),encoding='utf-8')
        except Exception:
            pass
    raise
finally:
    try:
        server.stdin.write('close\n');server.stdin.flush()
        server.wait(timeout=20)
    except Exception:
        server.terminate()
