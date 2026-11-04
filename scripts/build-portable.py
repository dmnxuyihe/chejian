"""Build an offline Windows x64 distribution from explicit local runtime paths."""
from pathlib import Path
import argparse,shutil,json,subprocess,hashlib,zipfile,os
p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--postgres',required=True);p.add_argument('--node-license',required=True);p.add_argument('--materials',required=True);p.add_argument('--output',required=True)
a=p.parse_args();ROOT=Path(__file__).resolve().parents[1];OUT=Path(a.output).resolve()
if OUT.exists():raise SystemExit('Output already exists; choose a new destination.')
sample=ROOT/'demo-materials/01_计划导入/两车月度计划_主流程.xlsx'
if sample.exists():subprocess.run([a.node,str(ROOT/'scripts/check-demo-import.mjs'),str(sample)],cwd=ROOT,check=True)
OUT.mkdir(parents=True);APP=OUT/'app';APP.mkdir()
for name in ['src','server','vendor','scripts','docs','tests','acceptance','demo-materials']:
 shutil.copytree(ROOT/name,APP/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
for name in ['index.html','demo.html','package.json','package-lock.json','start.js','README.md','.env.example']:
 shutil.copy2(ROOT/name,APP/name)
for name in ['CURRENT_IMPLEMENTATION.md','start.bat','start.sh','.gitignore']:
 if (ROOT/name).exists():shutil.copy2(ROOT/name,APP/name)
modules=APP/'node_modules';modules.mkdir()
for folder in (ROOT/'node_modules').iterdir():
 if folder.is_dir()and folder.name not in ['.bin','playwright','playwright-core']:
  shutil.copytree(folder,modules/folder.name)
node=OUT/'runtime/node';node.mkdir(parents=True);shutil.copy2(a.node,node/'node.exe');shutil.copy2(a.node_license,node/'LICENSE.txt')
PG=Path(a.postgres);pgout=OUT/'runtime/postgresql';(pgout/'bin').mkdir(parents=True)
for part in ['lib','share']:shutil.copytree(PG/part,pgout/part)
executables={'postgres.exe','initdb.exe','pg_ctl.exe','pg_dump.exe','pg_restore.exe','pg_isready.exe','psql.exe','pg_controldata.exe'}
for file in (PG/'bin').iterdir():
 if file.is_file()and(file.name in executables or(file.suffix.lower()=='.dll' and not file.name.startswith(('wx','testplug')))):shutil.copy2(file,pgout/'bin'/file.name)
# App-local release runtime DLLs; no debug runtime or installed service is copied.
for name in ['vcruntime140.dll','vcruntime140_1.dll','vcruntime140_threads.dll','msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','concrt140.dll']:
 file=Path(os.environ['WINDIR'])/'System32'/name
 if file.exists():shutil.copy2(file,pgout/'bin'/name)
for name in ['server_license.txt','commandlinetools_3rd_party_licenses.txt']:shutil.copy2(PG/name,pgout/name)
support=OUT/'support';support.mkdir();shutil.copy2(PG/'installer/vcredist_x64.exe',support/'vcredist_x64.exe')
shutil.copytree(a.materials,OUT/'演示资料',ignore=shutil.ignore_patterns('*.inspect.ndjson'))
if (ROOT/'demo-materials').exists():shutil.copytree(ROOT/'demo-materials',OUT/'演示资料',dirs_exist_ok=True)
cfg={'mode':'portable','entry':'demo','httpPort':5193,'databasePort':55432,'schema':'pc1','seedSchema':'pc1','databaseUrl':''}
(OUT/'config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding='utf-8')
for name,arg in [('启动演示.bat',''),('停止演示.bat','--stop'),('备份数据库.bat','--backup'),('检查演示.bat','--check')]:
 text='@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node\\node.exe" "%~dp0app\\scripts\\portable-launcher.mjs" '+arg+'\r\n'
 text+='if errorlevel 1 pause\r\n' if not arg else 'pause\r\n'
 (OUT/name).write_bytes(text.encode('utf-8'))
readme='''PC1 智能检修｜Windows 64位免安装演示版

使用：
1. 完整解压到本地可写文件夹（例如 D:\\PC1演示），不要直接在压缩包里运行。
2. 双击“启动演示.bat”。首次建立独立PostgreSQL并恢复随包演示数据，稍等浏览器自动打开。
3. 演示结束双击“停止演示.bat”。也可在启动窗口按Ctrl+C。不要在运行时搬动文件夹。

不需要预装Node.js、PostgreSQL、Python或Git，不需要联网下载依赖。使用Windows 10/11的x64电脑，以及Edge/Chrome等现代浏览器。
如系统提示缺少VC运行库，运行 support/vcredist_x64.exe 后重试；普通电脑已带运行库时不需要此步骤。

数据与资料：
- 包含当前PC1演示业务数据、检修记录及数据库中的图片/视频。
- “演示资料”包含详细流程PDF、速查表、两车导入表、检测填写示例和上传附件。
- 新一轮排程导入“两车月度计划_主流程.xlsx”；备用CSV不要重复导入。
- 相同车号已存在时沿用已有计划；已开工的车不要重新模拟，可换全新车号重演。
- 查看既有计划可定位2026年10月；新增演示导入和排程选择2026年11月，使用HXD1C-DR1102A/B，详见演示资料/01_计划导入/先读我_本次导入.txt。

保存：
- 首次运行后，所有新增数据保存在 data/postgres；后续启动会保留，不会重新覆盖为随包数据。
- 双击“备份数据库.bat”会在backups里生成包含30张业务表、辅助状态和图片视频的完整.dump备份。
- 备份要求演示正在运行。迁移或恢复备份请先停止演示，不要运行中直接拷贝data/postgres。
- 使用全新解压的包可重新得到本次随包初始演示数据，勿删除旧包数据来复位。

把后续新增数据搬到另一台电脑：
1. 原电脑演示运行时点击“备份数据库.bat”，保留生成的.dump文件。
2. 另一台电脑全新解压本包，先不要启动。
3. 将该.dump复制为新包的 seed/current-demo.dump，再启动新包即可恢复。
4. 此方法只用于全新解压、尚未初始化的包；旧目录和旧数据保留。

配置：
- 默认只监听127.0.0.1；网页默认5193，独立数据库默认55432；冲突会自动寻找附近可用端口，以启动窗口实际地址为准。
- 默认模式portable，无需编辑config.json。独立数据库随机口令首次运行在本机生成，不包含原电脑的.env或原数据库密码。
- 若要连接已有PostgreSQL，可把mode改为external并填写databaseUrl（postgresql://用户:URL编码密码@主机:端口/数据库）。
- external模式下目标数据库须已建立；空pc1数据区将恢复随包数据，已有应用数据保留。不会停止外部PostgreSQL服务。
- 程序源码和初始化脚本位于app，数据库结构为app/server/schema.sql，完整种子备份位于seed/current-demo.dump。

本包包含18个角色、145个页面的统一图形界面；明确标注待开发的页面仍未实现对应业务。本次完整业务演示以PC1流程为准。
本地包未实现生产账号权限系统，当前默认仅本机演示。
第三方软件及运行库的许可见runtime目录和support内的Redistributable，Node许可证来源为官方nodejs/node v24.19.0 LICENSE。
'''
(OUT/'先读我_使用说明.txt').write_text(readme,encoding='utf-8-sig')
(OUT/'第三方软件来源.txt').write_text('Node.js：随包LICENSE.txt（https://github.com/nodejs/node/blob/v24.19.0/LICENSE）\nPostgreSQL：随包server_license.txt及commandlinetools_3rd_party_licenses.txt\nMicrosoft Visual C++ Redistributable：support/vcredist_x64.exe；app-local release runtime DLLs。\nJavaScript依赖：app/node_modules内各包的LICENSE与package.json。\n未附原机器数据库目录、登录凭据或开发浏览器依赖。\n',encoding='utf-8-sig')
seed=OUT/'seed/current-demo.dump'
subprocess.run([a.node,str(ROOT/'scripts/export-portable-seed.mjs'),str(seed),str(PG/'bin/pg_dump.exe')],cwd=ROOT,check=True)
info=json.loads((OUT/'seed/seed-info.json').read_text());cfg['seedSchema']=info['schema'];cfg['schema']=info['schema'];(OUT/'config.json').write_text(json.dumps(cfg,indent=2),encoding='utf-8')
print(json.dumps({'output':str(OUT),'files':sum(1 for x in OUT.rglob('*')if x.is_file()),'seedBytes':seed.stat().st_size},ensure_ascii=False))
