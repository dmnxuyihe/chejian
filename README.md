# Rail Maintenance Scheduler V1

高级修车间智能排程第一版演示工程。页面以中文为主，项目目录与代码文件使用英文命名。

本版本的目标不是一次性覆盖完整 MES，而是先把 **车辆检修计划 → 智能排程 → 工班长微调 → 作业执行 → 简化质量确认** 这一条主链跑通，并将排程精确到具体人员、工位、设备和必要的具体配件实例。

## 1. Quick Start

无需安装第三方前端依赖，只需要 Node.js（建议 Node.js 20+）。

### Windows

双击：

```text
start.bat
```

### macOS / Linux

```bash
./start.sh
```

### Command line

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:5173
```

启动脚本会自动尝试打开浏览器。若只想启动服务：

```bash
npm run serve
```

## 2. Entry Flow

进入网站后不会出现账号密码登录页，而是先选择角色：

1. 系统管理员
2. 计划管理人员
3. 生产排程 / 调度人员
4. 工班长 / 组长
5. 作业人员
6. 质量人员
7. 技术人员

作业人员角色会再选择具体人员，例如“走行01”“走行02”“天车01”，用于展示不同人员自己的任务，不要求重复登录。

## 3. V1 Role Scope

### System Admin

第一版只做排程所需基础资源的简单维护 / 查看：

- 人员、班组
- 人员休假
- 工位、设备
- 工具、物料、备件简单查询
- 配件类型与具体配件实例
- 配件状态简单调整

配件是新增的排程资源，不替换原数据库中的备件概念。

### Planning

第一版将计划编制、审核、审批合并在一个用户中：

- 新增车辆检修计划
- 设置车型 / 修程
- 设置计划进场、计划交车时间
- 设置优先级
- 保存并提交排程

复杂审批链暂不实现。

### Scheduling

这是第一版重点角色，也是页面最完整的部分：

- 智能排程驾驶台
- 自动重新排程
- 排程版本与发布
- 车辆任务甘特图
- 具体人员排程与负荷
- 工位负荷
- 设备占用
- 配件实例占用
- 排程异常 / 资源冲突
- 任务锁定 / 解锁
- 保留轮对压装 → 轮对反压的 48 小时 FS 等待

智能排程按当前数据考虑：

- FS 前后置依赖与 lag
- 工位容量
- 班组人数
- 具体人员时间占用
- 人员累计负荷均衡
- 设备占用
- 配件类型、数量与具体实例可用性

### Foreman

不从零重新派工，而是基于系统初排做现场微调：

- 查看班组任务
- 查看系统已排人员
- 同班组换人
- 现场增员
- 自动检查人员时间冲突
- 保存调整来源与原因

### Worker

第一版只保留最小执行闭环：

- 选择具体作业人员
- 查看“我的任务”
- 查看同组人员和必要配件
- 开始作业
- 完成作业
- 实际时间回写
- 完成后自动进入质量待检

### Quality

第一版合并专检 / 验收：

- 查看待检任务
- 通过
- 不通过
- 填写简要意见

### Technical

流程配置页面只读：

- 查看构架 4 个任务
- 查看轮驱 16 个任务
- 查看标准工时
- 查看 FS 关系
- 查看班组、设备、配件需求
- 查看原流程步骤提示

**该页面不提供新增、删除、重排流程节点的操作，避免擅自改变原流程。**

## 4. Process Boundary

当前流程节点严格按提供的《构架_轮驱检修流程》与冻结初始化数据库组织：

### Frame Process

1. 构架清洗
2. 构架抛丸
3. 构架探伤
4. 构架喷漆

### Wheel Drive Process

1. 入库前轮对运用数据分析
2. 轮对清洁
3. 分解检查
4. 轴箱轴承拆解
5. 轮对分解（轮盘和车轴）
6. 车轴检修
7. 抱轴箱检修
8. 轮盘分解（制动盘+车轮）
9. 制动盘检修
10. 车轮检修
11. 轮盘组装
12. 轮盘静平衡试验
13. 轮对组装
14. 轮对压装
15. 轮对反压
16. 轮对尺寸测量

其中轮对压装到轮对反压继续使用 `FS + lag 2880 minutes`，即 48 小时工艺等待。

## 5. Component Supplement

原初始化库缺少配件内容，本演示只做排程必要的最小补充，没有扩成采购 / 仓储系统。

当前补充：

- `component_type`: 配件类型
- `component_instance`: 一件一条的具体配件实例
- `task_component_requirement`: 任务所需配件类型、数量与动作
- `schedule_component_assignment`: 排程绑定具体配件实例
- `component_movement_record`: 数据库设计中预留的配件流转记录概念

页面只增加：

1. 系统管理员的“配件台账”页
2. 排程“工位与资源”页中的配件占用展示

没有增加完整采购、领料审批、合同、供应商等流程。

## 6. Project Structure

```text
rail-maintenance-scheduler/
├── README.md
├── package.json
├── index.html
├── start.js
├── start.bat
├── start.sh
├── docs/
│   ├── implementation-scope.md
│   └── source-mapping.md
├── src/
│   ├── main.js
│   ├── core/
│   │   ├── app.js
│   │   ├── actions.js
│   │   ├── derived.js
│   │   ├── layout.js
│   │   ├── state.js
│   │   └── ui.js
│   ├── data/
│   │   ├── process.js
│   │   ├── resources.js
│   │   ├── schedule.js
│   │   └── simple-resources.js
│   ├── role-selection/
│   │   └── index.js
│   ├── shared/
│   │   └── templates.js
│   ├── styles/
│   │   └── global.css
│   └── roles/
│       ├── system-admin/
│       │   ├── index.js
│       │   └── pages/
│       ├── planning/
│       │   ├── index.js
│       │   └── pages/
│       ├── scheduling/
│       │   ├── index.js
│       │   └── pages/
│       │       ├── dashboard.js
│       │       ├── gantt.js
│       │       ├── workforce.js
│       │       ├── resources.js
│       │       └── exceptions.js
│       ├── foreman/
│       │   ├── index.js
│       │   └── pages/
│       ├── worker/
│       │   ├── index.js
│       │   └── pages/
│       ├── quality/
│       │   ├── index.js
│       │   └── pages/
│       └── technical/
│           ├── index.js
│           └── pages/
├── tests/
│   ├── ui_smoke.py
│   └── schedule_logic.mjs
├── test-results/
│   ├── ui-smoke-report.json
│   └── schedule-logic-report.json
└── test-artifacts/
    ├── 01-role-selector.png
    └── 02-scheduling-gantt.png
```

每个大角色独立目录，角色内部再拆页面文件，避免所有业务堆在一个长文件中。

## 7. Data Used by the Demo

核心初始化数据包括：

- 2 个班组：走行班、天车班
- 16 名人员：走行 8 人、天车 8 人
- 2 个工位：构架检修工位、轮驱检修工位
- 20 台 / 类设备资源
- 构架 4 个任务
- 轮驱 16 个任务
- 18 条 FS 依赖
- HXD1C0001 一次初始化检修计划与排程
- 4 类最小配件资源：轮对总成、车轴、车轮、制动盘
- 12 个具体配件实例

## 8. Test Results

已执行真实 Chromium 页面测试，不只是静态检查。

最新报告：`test-results/ui-smoke-report.json`

测试结果：

- 页面展示校验：192 次
- 实际点击操作：235 次
- 业务状态断言：172 次
- UI 测试操作总数：**599 次**
- JavaScript 静态语法检查：34 个文件
- 截图：2 张
- UI 测试最低要求：200 次
- 结果：**PASS**

覆盖内容包括：

- 7 类角色入口
- 角色页面切换
- 自动排程
- 排程发布
- 甘特详情
- 任务锁定 / 解锁
- 人员负荷
- 工位与资源
- 48 小时 FS 提示
- 工班长微调
- 作业开始 / 完成
- 作业人员切换
- 质量处理
- 基础资源标签页
- 配件状态修改
- 计划新增 / 提交
- 技术流程只读

排程逻辑额外执行 `tests/schedule_logic.mjs`，校验：

- 18 条依赖关系
- 人员时间不重叠
- 设备时间不重叠
- 班组人数满足
- 配件需求数量满足

结果：**PASS，0 个排程异常。**

运行测试：

```bash
npm run test:logic
npm run test:ui
```

`test:ui` 需要本机安装 Chromium 和 Python 的 `requests`、`websocket-client`。工程运行本身不需要这些测试依赖。

## 9. Current Limitations

第一版故意不做以下复杂模块：

- 真实后端 / 数据库连接（当前为浏览器内存演示数据）
- 账号密码登录
- 计划多级审核审批
- 采购计划、采购订单、物资 3.1 同步
- 领料审批链
- 完整仓储 / 物流
- 工具完整借还生命周期
- 复杂质量问题闭环
- 完整配件采购 / 委外 / 报废审批

这些都不会阻碍当前核心排程演示。

## 10. Style Reference

页面视觉参考用户给出的现有 MES / production-dashboard 风格：左侧导航、浅色工业后台、圆角卡片、Indigo/Violet 主色、KPI 卡片、表格、甘特和人员负荷等形式。当前工程没有复制其依赖栈，而是使用无第三方依赖的原生 ES Modules 实现，以保证拿到项目后直接启动。
