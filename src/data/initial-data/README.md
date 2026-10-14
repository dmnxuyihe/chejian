# V0.1 初版初始化数据（CSV审阅版）

这些文件是依据当前 `src/data` 初始化模块整理的只读审阅副本，供确认初版数据使用。它们不替代运行时 JavaScript 数据，也没有修改 `docs/数据库.xlsx`。

- `tasks.csv`：构架 4 个作业、轮驱 16 个作业，字段与 `src/data/process.js` 一致。
- `dependencies.csv`：全部 FS 关系；2014 → 2015 的等待为 2880 分钟（48 小时）。
- `resource_catalog.csv`：班组、人员、工位、设备、工具、物料和备件目录摘要。
- `component_instances.csv`：配件实例台账及状态。
- `vehicle_repairs.csv`：初始车辆检修计划。
- `schedules.csv`：初始版本的 20 条任务时间。

CSV 只用于审阅和后续确认，当前页面仍从 `src/data` 加载内存演示数据，尚未接入数据库持久化。
