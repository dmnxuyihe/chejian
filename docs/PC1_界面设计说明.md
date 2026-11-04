# 智能检修界面设计说明

## 视觉方向

本轮使用前端设计、UI/UX Pro Max 制作界面。根据最新反馈，正式页面采用简洁图标，移除大幅车间插画。

按用户提供的车间截图，默认采用深灰蓝工作区、灰蓝卡片、浅灰文字与青绿色高亮，保留小型线性图标。背景为#202A33，卡片为#2B3542，表头和次级面板为#303D49，文字为#E6EDF2，青绿高亮为#A0DED6，主操作底色为#285F63。顶部保留一套工作区导航，列表、日历与预览分别呈现。导入页左侧是实际计划，右侧是三步文字指引；模拟页左侧操作甘特图，右侧校验和发布。

新主题使用独立的`scheduler-workspace-theme-v4`偏好键，旧版浅色偏好不会阻止本次配色生效；用户仍可手动切换并保存明暗偏好。

所有角色页面共用 `workspace-shell`，角色选择页也使用同一品牌栏与主题。字体、标题、内容边距、按钮、表单、卡片、表格、标签页、弹窗和状态颜色统一由 `src/styles/workspace.css` 控制。`--primary`、`--radius-control`、`--radius-panel`、`--font-body`、`--control-height` 是共用参数。PC1沿用四个流程入口，其他角色保留自身功能入口；全部功能在导航抽屉中可达。待开发页仅统一外观，仍明确标为待开发。

字号以31px主标题、17—21px区域标题、13—14px主要正文为基础。手机输入框使用16px，密集日历和甘特图保留较小的辅助标注。背景、卡片、文字、输入框和按钮采用同一组主题参数，避免单独页面出现旧版纯黑或亮白色块。

## 图形与素材

- 2026-10-30：`src/shared/workspace-art.js`新增六种原生SVG图形：计划、排程、机车、车间、资源、检查。角色入口使用简洁检修线示意图，18个角色按四个工作环节分组，并配有职责图标。图形不包含虚构业务指标。
- 全页面扩展：图形库现有15种主题，增加人员、工具、设备、监控、工艺、安全、售后、系统管理、检修资料。所有145个路由共用角色位置提示、主题导航图标与图形标题；统计卡片、空状态、表单弹窗、资源台账和车辆信息使用同一套线条与间距。
- 待开发页面展示与正式功能目录对应的图形范围图，保留明确的待开发标识。工位完成环使用真实已完成任务数和总任务数，同时保留有名称的原生进度条供辅助技术读取；0%不绘制虚假的完成弧。
- 工具、物料、设备角色进入资源页时默认选择相应台账，切换分类和编辑功能沿用原有接口。监控面板在中等宽度下采用可收缩网格，宽任务表仅在表格容器内滚动。
- `src/styles/illustrations.css`控制图形大小和分组布局，沿用现有明暗主题变量。业务页共用标题图形，导入指引图形与标题并排，避免增加面板高度；手机端保留全部角色和操作。
- src/assets/workshop-planning.webp：前期设计探索素材，正式页面不再加载。
- src/shared/rail-visuals.js：24px车辆线性图标，复用于列表、选车区域及单车信息；三阶段流程提示使用可读的HTML文字、小图标和细线。
- 去掉图标的大圆形底板和列表强制高度，减少装饰与空白。车号、修程、入段时间、状态、人数和任务数均沿用现有数据。
- 生成的效果图属于设计参考，其中示例配属信息没有写入业务数据。实际界面以数据库记录为准。

设计稿及原始插画保存在本次任务的outputs目录。图片使用内置图像生成工具生成，网页版本仅进行了尺寸及WebP格式优化。

## 验证

2026-10-30图形调整后重新通过145个路由、435次明暗主题与手机布局检查，以及独立PostgreSQL测试区中的PC1浏览器业务流程：40项模拟、拖动锁定、重算、发布、查询和图片视频回读。正式数据库业务数据保持不变。入口和月度计划对比图位于`test-artifacts/ui-diagrams/`。

全页面扩展后：`tests/workspace_graphics_ui.py`另完成768/1280宽度的290次页面检查，校验全部路由的图形标题、角色位置、待开发范围图、角色默认资源分类和实际进度环。与明暗主题435次检查合计725次。PC1实际入段、跨标签作业监控、计划维护和完整排程/附件浏览器测试再次通过。覆盖清单见[全页面图形界面覆盖](全页面图形界面覆盖.md)，截图位于`test-artifacts/workspace-graphics/`。

tests/workspace_ui.py检查了375、390、768、1024、1440宽度，简洁图标、无大幅插画、流程提示、键盘操作、主题保存、深色输入框、记录弹窗及已有业务数据保持一致。截图与报告保存在test-artifacts/workspace-simple/。

tests/workspace_consistency.py覆盖18个角色、145个路由的435次页面检查：1440宽深色、375宽深色和1440宽浅色。检查默认参考配色、主题保存、共用标题/字体/边距/页眉、角色导航、无页面水平溢出、入口主题按钮、人员选择弹窗键盘关闭与焦点恢复，并核对业务数据不变。截图与报告保存在test-artifacts/workspace-unified/。

tests/planning_page_ui.mjs、tests/pc1_workflow_ui.py及tests/ui_smoke.mjs已通过，覆盖导入与预览、两车40项模拟任务、真实拖动、锁定重算、正式发布、查询、实际图片视频附件及129个页面的回归。

上述自动化结果不等同于完整无障碍认证或性能现场指标。

## 前期页面效果图提示词（留档，非当前图形方案）

Create a polished high fidelity desktop WEB APPLICATION UI DESIGN MOCKUP for a Chinese railway locomotive maintenance planning system, 16:10 landscape, not a landing page. Product: PC1 智能检修. The output should look like a meticulously designed real professional Figma screen, crisp UI typography in Chinese, full realistic desktop viewport. Main task: import monthly plans, review locomotive entries, continue to scheduling.
Visual direction: sophisticated Swiss editorial grid + contemporary industrial product UI. Soft ivory gray page #F4F6F8, deep ink navy #132A39 typography, warm white surfaces, restrained teal #176E64 primary actions, subtle cool blue accents. Avoid excessive purple, excessive small boxes or glossy effects.
One top navigation only, off-white bar with small elegant rail symbol and 智能检修 wordmark at left; tabs 月度计划 (active), 智能排程, 单车检修, 车间日历; a small PC1 badge and role control on the right.
Main content centered with generous but purposeful margins. Large clean Chinese page title 检修计划, short muted subtitle 从月度计划开始，安排每一辆机车的检修. Right aligned single primary teal button 导入计划文件 with upload icon, and subdued text 手动新建.
Under title a thin local tab row 计划列表 / 月度日历, no duplicate navigation rail.
Main composition: broad left panel (~72% width) for a professional sparse data table, narrower right panel (~28%) for beautifully illustrated contextual workflow guidance. Table panel heading 本月检修计划 and small inline count 2辆, a month picker 2026年10月. Table columns 机车 / 修程 / 计划入段 / 状态 / 操作. Two clean spacious rows only, no fake extra data: HXD1C-YS001, HXD1C高级修, 2026-10-29, 已排程, 查看详情; second HXD1C-YS002, 2026-10-30. Left of each locomotive number a small pale-blue technical outline locomotive pictogram badge, distinct strong car identifier and readable smaller secondary metadata. Elegant row dividers and status pills.
Right panel: an art-directed pale blue-gray isometric locomotive and miniature workshop with a small calendar, exquisite 3D editorial illustration, useful restrained scale (~200px tall), NOT a huge hero. Below illustration heading 从计划到检修 and three vertically connected steps: 填写模板 / 上传校验 / 确认导入. Compact bordered link 下载 Excel 模板. Maintain calm whitespace. Tiny caption 支持 XLSX、XLS、CSV. A quiet bottom workflow ribbon visually maps 月度计划 → 模拟排程 → 正式发布 using thin lines and three consistent outline icons.
Prioritize readable 14-16px body, 30px title, precise spacing, strong information hierarchy, coherent alignment, distinct focus and hover affordances. No giant marketing slogans, no charts, no fabricated KPIs, no random stock photographs, no emoji. This is a design concept illustration; do not depict a browser address bar.

## 前期检修车间插画提示词（留档，正式页面已移除）

Create a premium 3D isometric editorial illustration for the right-side guidance card of a Chinese railway maintenance planning web application. A single modern silver-blue electric freight locomotive on short parallel rails INSIDE an airy maintenance bay, 3/4 front view, overhead frame gantry, yellow safety catwalks, a few very small maintenance technicians in blue, a workbench. A small standing desk calendar on the right has a clean blank grid and a single teal highlighted date square, absolutely NO words, letters, numbers, logos, badges, captions or watermark anywhere. The locomotive is visually the focal point. Soft white / icy pale blue background matching #F4F7FA, precise architectural lines, sophisticated miniature clay/metal materials with gentle realistic lighting, soft ambient shadows, restrained blue/gray/navy with tiny warm yellow details and subtle teal. Elegant contemporary enterprise product illustration, not childish and not an action photograph. Landscape composition ratio 3:2, high viewpoint, ample edge breathing room. Everything should fit within the image with no cropped wheels or cut-off calendar. Clearly an illustrative concept, not an actual inspection record. Intended to be displayed at 320px wide; avoid unnecessary tiny clutter.
