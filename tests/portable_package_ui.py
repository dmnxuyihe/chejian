"""Use only bundled binaries from a fresh copied Windows package directory."""
from pathlib import Path
import sys,json,subprocess,shutil,os,time,urllib.request,urllib.parse,hashlib
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-artifacts/python-deps'))
from playwright.sync_api import sync_playwright,expect
source=Path(sys.argv[1]).resolve();QA=Path(sys.argv[2]).resolve();DEST=QA/'全新电脑 模拟运行'
if DEST.exists():raise SystemExit('Fresh validation directory already exists')
QA.mkdir(parents=True,exist_ok=True);shutil.copytree(source,DEST)
node=DEST/'runtime/node/node.exe';launcher=DEST/'app/scripts/portable-launcher.mjs'
env={k:v for k,v in os.environ.items()if not k.startswith(('PG','DATABASE_','PC1_DB'))}
env['PATH']=str(Path(os.environ['WINDIR'])/'System32')
env['NO_OPEN']='1'
before=json.load(urllib.request.urlopen('http://127.0.0.1:5193/api/state'))
checks=[];server=None;browser=None;ready=None
def check(name):checks.append(name);print('PASS '+name,flush=True)
def command(*args):return subprocess.run([str(node),str(launcher),*args],cwd=DEST,env=env,capture_output=True,text=True,encoding='utf-8',timeout=70,creationflags=subprocess.CREATE_NO_WINDOW)
def start(use_defaults=False):
 argv=[str(node),str(launcher),'--no-open']+([]if use_defaults else ['--http-port=0','--db-port=0'])
 proc=subprocess.Popen(argv,cwd=DEST,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
 lines=[]
 while True:
  line=proc.stdout.readline();lines.append(line)
  if line.startswith('PC1_PORTABLE_READY '):return proc,json.loads(line.split(' ',1)[1]),lines
  if not line and proc.poll()is not None:raise RuntimeError(''.join(lines))
try:
 server,ready,logs=start();(QA/'startup.log').write_text(''.join(logs),encoding='utf-8')
 u=urllib.parse.urlsplit(ready['url']);base=f'{u.scheme}://{u.netloc}'
 health=json.load(urllib.request.urlopen(base+'/api/health'));assert health['storage']=='postgresql',health
 initial=json.load(urllib.request.urlopen(base+'/api/state'))
 assert initial['snapshot']['data']==before['snapshot']['data'],'Seed differs from original business state'
 check('fresh Chinese/space path starts using packaged Node and packaged PostgreSQL with PATH limited to Windows System32')
 duplicate=command('--no-open');assert duplicate.returncode==0 and '已在运行' in duplicate.stdout,duplicate.stdout+duplicate.stderr
 check('repeated launch reuses same package service without a second database')
 with sync_playwright()as p:
  browser=p.chromium.launch(channel='msedge',headless=True);context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(ready['url']);page.wait_for_load_state('networkidle');expect(page.locator('.demo-nav>a')).to_have_count(5)
  assert '/demo.html#/demo/calendar' in ready['url']
  expect(page.locator('a[href="#/demo/plans"] .drawn-action-icon')).to_be_visible()
  page.goto(base+'/demo.html#/demo/vehicle');page.wait_for_load_state('networkidle')
  expect(page.locator('.demo-vehicle-day')).to_be_visible();expect(page.locator('[data-pc1-first-task] .drawn-action-icon')).to_be_visible()
  page.screenshot(path=str(QA/'portable-current-demo.png'))
  check('default entry opens current five-function demo with drawn buttons and single-vehicle daily details')
  page.goto(base+'/#/select');expect(page.locator('[data-role-card]')).to_have_count(18)
  page.goto(base+'/#/planning/plans');page.wait_for_load_state('networkidle');expect(page.locator('.page-art-mark svg')).to_be_visible()
  page.screenshot(path=str(QA/'portable-plans.png'))
  file=DEST/'演示资料/01_计划导入/两车月度计划_主流程.xlsx'
  result=context.request.post(base+'/api/planning/import/preview',data={'filename':file.name,'contentBase64':__import__('base64').b64encode(file.read_bytes()).decode(),'importType':'MONTHLY','month':'2026-11'})
  assert result.ok,result.text();preview=result.json();assert (preview['importable'],preview['errors'])==(2,0),preview
  context.request.delete(base+'/api/planning/import/preview/'+preview['id'])
  check('packaged UI shows 18 roles, new art and monthly import validates both supplied vehicles')
  data=initial['snapshot']['data'];record=next((r for r in data['maintenanceRecords'] if any(f['mimeType'].startswith('video/')for f in r['attachments'])),None)
  assert record,'Source demo must carry video record'
  for item in record['attachments']:
   got=context.request.get(base+item['url']);original=context.request.get('http://127.0.0.1:5193'+item['url'])
   assert got.ok and got.body()==original.body(),item['name']
  video=next(x for x in record['attachments']if x['mimeType'].startswith('video/'));image=next(x for x in record['attachments']if x['mimeType'].startswith('image/'))
  page.goto(base+'/#/scheduling/workforce');page.locator('[data-pc1-query-vehicle]').select_option(str(record['vehicleRepairId']));page.locator('[data-pc1-vehicle-tab="records"]').click()
  page.locator(f'[data-pc1-record-task="{record["scheduleTaskId"]}"]').click();expect(page.locator('.pc1-submitted-record')).to_be_visible()
  page.wait_for_function("document.querySelector('.pc1-attachments img')?.naturalWidth>0")
  played=page.evaluate("""async()=>{const v=document.querySelector('.pc1-attachments video');v.muted=true;await v.play();await new Promise(r=>setTimeout(r,350));v.pause();return {width:v.videoWidth,time:v.currentTime}}""")
  assert played['width']>0 and played['time']>0,played
  page.screenshot(path=str(QA/'portable-records.png'),full_page=True)
  check('all stored attachments restored byte-for-byte; image decodes and source video really plays')
  for secret in ['/config.json','/data/local-database.json','/seed/current-demo.dump','/.env','/server/config.js']:
   assert context.request.get(base+secret).status in [403,404],secret
  denied=context.request.post(base+'/__portable__/stop');assert denied.status==403
  check('configuration, credentials, database dump and unauthenticated stop request are inaccessible through the website')
  assert not errors,errors
  # Add fresh plans so restart preservation cannot pass by merely reloading the seed.
  changed=context.request.post(base+'/api/planning/import/preview',data={'filename':file.name,'contentBase64':__import__('base64').b64encode(file.read_bytes()).decode(),'importType':'MONTHLY','month':'2026-11'}).json()
  confirmed=context.request.post(base+'/api/planning/import/confirm',data={'previewId':changed['id']});assert confirmed.ok,confirmed.text()
  persisted=context.request.get(base+'/api/state').json()
  assert len(persisted['snapshot']['data']['vehicleRepairs'])==len(initial['snapshot']['data']['vehicleRepairs'])+2
  check('two new monthly plans really write into the portable PostgreSQL database')
  browser.close();browser=None
 backup=command('--backup');assert backup.returncode==0,backup.stdout+backup.stderr
 files=list((DEST/'backups').glob('*.dump'));assert len(files)==1 and files[0].stat().st_size>1000
 inspected=subprocess.run([str(DEST/'runtime/postgresql/bin/pg_restore.exe'),'--list',str(files[0])],capture_output=True,text=True,encoding='utf-8',timeout=20)
 assert inspected.returncode==0 and 'pc1_maintenance_media' in inspected.stdout
 check('one-command backup creates a PostgreSQL archive including media table')
 current=command('--check');assert current.returncode==0 and 'postgresql' in current.stdout
 stopped=command('--stop');assert stopped.returncode==0,stopped.stdout+stopped.stderr;server.wait(timeout=40)
 assert server.returncode==0
 status=subprocess.run([str(DEST/'runtime/postgresql/bin/pg_ctl.exe'),'status','-D',str(DEST/'data/postgres')],capture_output=True,timeout=10);assert status.returncode!=0
 check('stop command shuts down only the portable application and its own PostgreSQL cluster')
 server,second,logs=start(use_defaults=True);u=urllib.parse.urlsplit(second['url']);saved=json.load(urllib.request.urlopen(f'{u.scheme}://{u.netloc}/api/state'))
 assert second['httpPort']!=5193,'Must not reuse original app occupying default port'
 assert saved['snapshot']['data']==persisted['snapshot']['data'],'Restart reset persisted data'
 check('normal configuration automatically avoids the existing application on port 5193')
 check('restart preserves database state and does not restore the seed over existing data')
 command('--stop');server.wait(timeout=40);server=None
 after=json.load(urllib.request.urlopen('http://127.0.0.1:5193/api/state'))
 assert before['revision']==after['revision'] and before['snapshot']['data']==after['snapshot']['data']
 check('original working database and original application stay untouched')
 report={'passed':True,'checks':checks,'node':str(node),'webPort':ready['httpPort'],'databasePort':ready['databasePort'],'attachments':len(record['attachments']),'playback':played,'backupBytes':files[0].stat().st_size}
 (QA/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({k:v for k,v in report.items()if k!='node'},ensure_ascii=False))
finally:
 if browser:
  try:browser.close()
  except Exception:pass
 if server and server.poll()is None:
  try:command('--stop');server.wait(timeout=35)
  except Exception:server.terminate()
