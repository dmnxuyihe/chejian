# PostgreSQL 接入与演示部署

PC1应用完整连接《数据库.xlsx》中定义的30张业务表，共261个字段。浏览器通过Node后端读写PostgreSQL，业务实体逐表持久化；额外的`application_state`只保存演示视图、兼容字段和共享版本号，不取代业务关系表。

## 当前本机配置

- PostgreSQL 16服务已运行。
- 当前数据库：`workshop_schedule`；本项目使用独立schema `pc1`。
- 连接信息在项目根目录`.env`中，该文件已被Git忽略，HTTP服务禁止读取。
- 本机演示地址：`http://127.0.0.1:5193/#/planning/plans`，使用时需保持Node服务运行。
- 首次部署在空schema中初始化基础演示资源、一辆机车及20条工序。初始化命令遇到原六表schema时，会在一个事务内搬入30表并核对约束；迁移失败会回滚，成功后清理旧六表。以后重复执行不会重置已有业务数据。

其他schema保持原样。空数据库初始化写入演示样例，不会把Excel字典误当作生产记录导入。

## 数据表

| 数据域 | 业务表 |
| --- | --- |
| 班组、人员、休假 | `team`、`employee`、`employee_leave` |
| 工具、备件、物料 | `tool`、`spare_part`、`material` |
| 工位、机型、修程、设备、工作日历 | `workstation`、`locomotive_model`、`repair_program`、`equipment`、`work_calendar` |
| 检修任务与资源需求 | `maintenance_task`、`task_dependency`、`task_team_requirement`、`task_tool_requirement`、`task_part_requirement`、`task_material_requirement`、`task_equipment_requirement`、`task_component_requirement` |
| 车辆、排程、人员/设备分配、版本、异常、审批 | `vehicle_repair`、`schedule_version`、`vehicle_repair_schedule`、`schedule_employee_assignment`、`schedule_equipment_assignment`、`schedule_exception`、`approval_record` |
| 配件与流转 | `component_type`、`component_instance`、`schedule_component_assignment`、`component_movement_record` |
| 应用同步辅助数据 | `application_state`（版本号、视图设置及字典未定义的页面扩展字段） |

业务表、字段、主键、唯一索引、数据类型及已列外键均由`server/tables.json`记录的Excel字典生成；`npm run db:schema`可重新生成`server/schema.sql`。包括重复版本号、任务资源需求、设备和配件分配、审批及流转历史的表都已加入数据库读写映射。数据库另外有一张`application_state`做应用版本同步和保留页面兼容字段，因此实际共31张表，其中业务表严格30张。

SQL列保存字典规定的业务字段。应用兼容属性放在`application_state.payload`中，带稳定业务主键，与30张业务表在同一个事务中读写；它不复制业务表记录。时间列使用无时区时间戳，保留工艺本地时间；同步更新时间使用带时区时间戳。

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

`scripts/database.mjs`执行初始化，`server/tables.json`列出字典字段，`server/schema.sql`提供PostgreSQL表结构。初始化事务内完成建表、关系迁移和演示数据写入；失败会回滚。首次返回`initialized: true`，重复执行返回`initialized: false`并保留已有记录和版本。`db:check`只检查连接和读取30张业务表的数据量，不建表、不改数据。

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

当前版本重复初始化不会覆盖数据。业务库升级由schema结构版本控制；新增字段和约束需更新Excel字典、schema生成文件及迁移逻辑。仓库提交`package-lock.json`固定依赖版本，不提交`.env`、备份和`node_modules`。

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
