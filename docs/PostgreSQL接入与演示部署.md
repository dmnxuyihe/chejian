# PostgreSQL 接入与演示部署

2026年10月27日，PC1计划日历页面已接入真实PostgreSQL。浏览器通过Node后端读写，数据库为业务数据来源；localStorage仅保留旧版数据供手动迁移，不再承担默认业务保存。

## 当前本机配置

- PostgreSQL 16服务已运行。
- 当前数据库：`workshop_schedule`；本项目使用独立schema `pc1`。
- 连接信息在项目根目录`.env`中，该文件已被Git忽略，HTTP服务禁止读取。
- 本机演示地址：`http://127.0.0.1:5193/#/planning/plans`，使用时需保持Node服务运行。
- 初次建表仅在新数据区初始化一车和20条工序；以后重启不会重新覆盖数据库数据。两车计划通过页面模板导入，模拟排程与清单仍按各成员分工接入。

原数据库中其他schema和旧项目业务表保持原样。没有导入整个历史Excel数据库，本次保存的是当前PC1演示使用的计划、排程、资源基础数据与模拟草稿。

## 数据表

| 表 | 用途 |
| --- | --- |
| `pc1.vehicle_repairs` | 车辆编号、入段、要求完成时间、状态及计划附加字段 |
| `pc1.schedule_versions` | 车辆排程版本与发布状态 |
| `pc1.schedules` | 工序、车辆、版本、工位、起止时间、锁定及进度 |
| `pc1.resource_assignments` | 人员、设备和配件实例与任务的对应关系 |
| `pc1.reference_data` | 人员班组、工艺依赖、工具物料等现有基础集合；模拟草稿单独保存为JSONB |
| `pc1.metadata` | 共享数据版本、更新时间与结构版本 |

车辆与任务采用关系表，可直接按车辆、日期查询。补充字段及现有基础集合用JSONB保留当前字段结构。时间使用无时区timestamp，保持工艺中本地08:00等时间的原意；保存时间使用带时区时间戳。

## 在新电脑部署

需要Node.js 20.12或以上版本及可连接的PostgreSQL。只需在运行Node服务的电脑配置数据库，其他电脑打开网页即可。

### 1. 准备空数据库

已有数据库和账号时跳过这一步。需要新建时，在pgAdmin等管理工具中用管理员账号分别执行以下两条SQL，密码自行替换；`CREATE DATABASE`需单独执行，不放在事务中：

```sql
CREATE ROLE workshop LOGIN PASSWORD '替换为自行设置的密码';
CREATE DATABASE workshop_schedule OWNER workshop;
```

初始化脚本在这个数据库内创建`pc1`数据区和表，不需要向应用提供PostgreSQL管理员密码。

### 2. 下载代码并配置连接

```powershell
git clone https://github.com/dmnxuyihe/chejian.git
cd chejian
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

在`.env`中填好连接信息，格式如下（示例中的密码需替换；密码里的`@`、`#`等字符需按URL编码）：

```dotenv
DATABASE_URL=postgresql://workshop:YOUR_PASSWORD@127.0.0.1:5432/workshop_schedule
PC1_DB_SCHEMA=pc1
HOST=127.0.0.1
PORT=5193
```

`.env`由服务端`server/config.js`统一加载，也支持服务器直接注入同名环境变量，环境变量优先。账号需对目标schema有建表和读写权限，首次新建schema还需对数据库有CREATE权限。本机已有配置，不覆盖现有`.env`。

### 3. 初始化并启动

```powershell
npm run db:init
npm run db:check
npm start
```

打开`http://127.0.0.1:5193/#/planning/plans`。无需自动打开浏览器时使用`npm run serve`。

`scripts/database.mjs`执行初始化，`server/schema.sql`提供表结构。初始化事务内完成建表和写入默认资源、计划与工序；失败会回滚。首次返回`initialized: true`，重复执行返回`initialized: false`并保留已有记录和版本，不追加重复数据。`db:check`只检查连接和读取记录数量，不建表、不改数据。

启动时仍会自动检查并初始化空数据区；正式部署先单独执行`db:init`，便于在启动网页前确认配置有效。连接失败直接报错退出，不会静默退回本地存储。`--local-demo`只用于明确选择的离线演示及回归测试。

### 4. 将当前演示数据搬到新数据库

在原页面“保存与恢复”中导出JSON备份，放到新服务器项目的`backups/`目录（已被Git忽略）或项目以外的位置。在**新数据库首次初始化前**执行：

```powershell
npm run db:init -- --seed="backups/PC1备份.json"
npm run db:check
npm start
```

这会用备份里的车辆、工序、资源及模拟草稿作为初始数据，替代默认演示数据。目标数据区已有数据时，即使指定`--seed`也保留原数据。需要恢复到已经使用的数据库时，通过页面已有的“恢复备份”流程确认操作。

### 5. 更新已部署版本

先在页面导出备份，再停止Node服务，执行：

```powershell
git pull --ff-only
npm ci
npm run db:init
npm run db:check
npm start
```

当前版本重复初始化不会覆盖数据；未来涉及表结构变更时需要随版本提供迁移脚本，不能通过修改初始数据来更新已有记录。仓库提交`package-lock.json`固定依赖版本，不提交`.env`、备份和`node_modules`。

## 页面保存与迁移

1. 刷新页面后，顶部应显示“已连接PostgreSQL”和数据版本。
2. 导入计划、新增编辑及排程操作产生的共享数据会提交数据库。只有请求成功才显示“已保存到PostgreSQL”。
3. 日历月份、选车和当前标签属于本页面设置，用sessionStorage记住当前标签页的位置，刷新可恢复，不写入共享业务数据，不会覆盖其他电脑的界面。
4. “保存与恢复”中可导出、恢复备份及复位；数据库模式下这些操作影响共享数据，执行前有明确确认并下载操作前备份。
5. 如果数据库刚初始化、尚无任何业务修改，首次打开有旧记录的浏览器时会自动迁移有效旧数据，原localStorage记录保留。如果数据库已有修改则不会自动替换，“保存与恢复”显示“迁移本机旧数据”，可查看记录数量后确认替换。手动迁移是替换当前PC1数据，不是合并不同来源记录。
6. 其他页面每3秒检查数据库新版本，当前页面有未保存修改时不会被自动覆盖。两边同时修改会提示版本冲突；先导出本页修改，再点击“加载数据库最新数据”重新操作。
7. 数据库断线时保留当前页修改并显示“未保存”，可重试或导出备份；初次加载失败时停止进入业务界面并提供重试。离线修改不能靠刷新保留，应先导出备份。

## 多台电脑演示

建议由一台电脑运行Node服务及数据库，其他电脑打开这台服务电脑的局域网地址。服务可用以下命令监听局域网：

```powershell
node start.js --host=0.0.0.0 --port=5193 --no-open
```

其他电脑打开`http://服务电脑局域网IP:5193/#/planning/plans`，按需要允许该服务端口通过防火墙。客户端只连接网页，不需要数据库密码；不必开放PostgreSQL端口给客户端。当前是沿用原项目角色选择的演示服务，尚未增加账号登录或权限系统，应在受控演示网络使用。

## API与一致性

- `GET /api/config`：确认当前模式。
- `GET /api/health`：实际查询PostgreSQL，返回连接状态。
- `GET /api/state`：返回同一事务快照中的共享数据和revision。
- `PUT /api/state`：提交revision和snapshot，验证后在单个事务内保存车辆、版本、任务、资源及草稿。

PUT用数据库行锁和revision比较，过期写入返回409；格式、关联或唯一约束失败不改变原数据。当前采用整份演示数据提交，适用于两车演示；没有把排程算法迁到服务器，也没有提供独立的库存扣减接口。后续成员仍通过现有共享state及页面重绘接入，数据库持久化会统一保存合法变更。

数据库凭据仅在服务端读取，`.env`、`server`及`node_modules`不会作为静态文件开放。参数化SQL及表约束用于保存验证。

## 验证

- `npm run test:db-init`：真实数据库首次初始化、重复执行保留修改、备份初始化、无写入的连接检查、无效配置和无效备份处理。
- `npm run test:postgres`：真实PostgreSQL关系表计数、计划和排程往返、任务资源分配、模拟锁定、时间不偏移、版本冲突、失败事务回滚、重启保留、敏感文件禁止访问。
- `npm run test:postgres:ui`：浏览器导入写入数据库、刷新、两个独立浏览器共享、跨客户端排程及草稿同步、冲突保留、重试、旧本机数据迁移、数据库复位与撤销。需要测试环境中的Playwright及Edge。
- `npm test`：原导航、排程、V0.1、日历、本地备份兼容性和129页面冒烟回归。

数据库测试只创建并清理自身带随机后缀的`pc1_test_...`数据区，不使用`pc1`业务数据区。
