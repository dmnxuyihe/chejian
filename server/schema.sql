-- Generated from the 30-table PostgreSQL data dictionary in docs/数据库.xlsx. Do not edit by hand.
CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
-- 班组基本信息表 (team): 维护检修班组基础信息，供人员归属、任务班组需求和排程使用。
CREATE TABLE IF NOT EXISTS __SCHEMA__."team" (
  "team_id" BIGINT,
  "team_name" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("team_id"),
  UNIQUE ("team_name")
);
-- 人员基本信息表 (employee): 维护参与检修作业的人员信息及所属班组。
CREATE TABLE IF NOT EXISTS __SCHEMA__."employee" (
  "employee_id" BIGINT,
  "employee_no" VARCHAR(32),
  "employee_name" VARCHAR(64) NOT NULL,
  "team_id" BIGINT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("employee_id"),
  UNIQUE ("employee_no")
);
-- 人员休假信息表 (employee_leave): 记录人员请假、培训、借调等不可参与排程的时间段。
CREATE TABLE IF NOT EXISTS __SCHEMA__."employee_leave" (
  "leave_id" BIGINT,
  "employee_id" BIGINT NOT NULL,
  "leave_type" VARCHAR(32),
  "start_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "end_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'VALID',
  "remark" VARCHAR(255),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("leave_id"),
  CHECK ("end_at" > "start_at")
);
-- 工具信息表 (tool): 维护排程需要考虑的工具品种、数量、状态和位置；第一版按数量管理。
CREATE TABLE IF NOT EXISTS __SCHEMA__."tool" (
  "tool_id" BIGINT,
  "tool_code" VARCHAR(64),
  "tool_name" VARCHAR(128) NOT NULL,
  "quantity" INT NOT NULL DEFAULT 0,
  "manufacturer" VARCHAR(128),
  "inspection_cycle_months" INT,
  "last_inspection_at" TIMESTAMP WITHOUT TIME ZONE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  "location" VARCHAR(128),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tool_id"),
  UNIQUE ("tool_code")
);
-- 备件信息表 (spare_part): 维护备件品种及数量。第一版不做序列号级一物一码。
CREATE TABLE IF NOT EXISTS __SCHEMA__."spare_part" (
  "part_id" BIGINT,
  "part_code" VARCHAR(64),
  "part_name" VARCHAR(128) NOT NULL,
  "specification" VARCHAR(128),
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "unit" VARCHAR(16),
  "manufacturer" VARCHAR(128),
  "manufacture_date" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  "location" VARCHAR(128),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "wastage_tate" DECIMAL(3,2) DEFAULT 0,
  PRIMARY KEY ("part_id"),
  UNIQUE ("part_code")
);
-- 物料信息表 (material): 维护润滑油、清洗剂、胶等耗材/辅料及可用数量，与备件分开。
CREATE TABLE IF NOT EXISTS __SCHEMA__."material" (
  "material_id" BIGINT,
  "material_code" VARCHAR(64),
  "material_name" VARCHAR(128) NOT NULL,
  "specification" VARCHAR(128),
  "unit" VARCHAR(16) NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "manufacturer" VARCHAR(128),
  "status" VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  "location" VARCHAR(128),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("material_id"),
  UNIQUE ("material_code")
);
-- 工位信息表 (workstation): 维护车间工位、产线和并发容量等排程资源。
CREATE TABLE IF NOT EXISTS __SCHEMA__."workstation" (
  "workstation_id" BIGINT,
  "workstation_code" VARCHAR(32),
  "workstation_name" VARCHAR(128) NOT NULL,
  "production_line" VARCHAR(64),
  "capacity" INT NOT NULL DEFAULT 1,
  "status" VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workstation_id"),
  UNIQUE ("workstation_code")
);
-- 机车类型表 (locomotive_model): 维护机车型号字典。
CREATE TABLE IF NOT EXISTS __SCHEMA__."locomotive_model" (
  "model_id" BIGINT,
  "model_code" VARCHAR(32) NOT NULL,
  "model_name" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("model_id"),
  UNIQUE ("model_code")
);
-- 修程表 (repair_program): 定义某机车型号下的修程基础信息。
CREATE TABLE IF NOT EXISTS __SCHEMA__."repair_program" (
  "repair_program_id" BIGINT,
  "model_id" BIGINT NOT NULL,
  "repair_program_code" VARCHAR(32),
  "repair_program_name" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("repair_program_id"),
  UNIQUE ("model_id", "repair_program_name")
);
-- 检修任务信息表 (maintenance_task): 定义修程下的标准检修任务/工序模板；任务先后顺序由任务依赖关系表表达。
CREATE TABLE IF NOT EXISTS __SCHEMA__."maintenance_task" (
  "task_id" BIGINT,
  "repair_program_id" BIGINT NOT NULL,
  "task_name" VARCHAR(255) NOT NULL,
  "workstation_id" BIGINT,
  "standard_duration_min" INT NOT NULL,
  "sequence_no" INT,
  "is_progress_node" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("task_id"),
  CHECK ("standard_duration_min" > 0)
);
-- 检修任务依赖关系表 (task_dependency): 定义检修任务之间的前后置约束。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_dependency" (
  "dependency_id" BIGINT,
  "parent_task_id" BIGINT NOT NULL,
  "child_task_id" BIGINT NOT NULL,
  "dependency_type" VARCHAR(8) NOT NULL DEFAULT 'FS',
  "lag_minutes" INT NOT NULL DEFAULT 0,
  PRIMARY KEY ("dependency_id"),
  UNIQUE ("parent_task_id", "child_task_id", "dependency_type")
);
-- 检修任务-班组关系表 (task_team_requirement): 定义标准任务需要哪个班组、多少人及可选的班组作业时长。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_team_requirement" (
  "operation_id" BIGINT,
  "task_id" BIGINT NOT NULL,
  "team_id" BIGINT NOT NULL,
  "headcount" INT NOT NULL DEFAULT 1,
  "work_duration_min" INT,
  "remark" VARCHAR(255),
  PRIMARY KEY ("operation_id"),
  UNIQUE ("task_id", "team_id"),
  CHECK ("headcount" > 0),
  CHECK ("work_duration_min" IS NULL OR "work_duration_min" > 0)
);
-- 检修任务-工具关系表 (task_tool_requirement): 定义任务执行所需工具及数量。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_tool_requirement" (
  "task_id" BIGINT,
  "tool_id" BIGINT,
  "quantity" INT NOT NULL DEFAULT 1,
  PRIMARY KEY ("task_id", "tool_id"),
  CHECK ("quantity" > 0)
);
-- 检修任务-备件关系表 (task_part_requirement): 定义任务执行所需备件及数量。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_part_requirement" (
  "task_id" BIGINT,
  "part_id" BIGINT,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "is_mandatory" BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY ("task_id", "part_id"),
  CHECK ("quantity" > 0)
);
-- 检修任务-物料关系表 (task_material_requirement): 定义任务执行所需耗材/物料及数量。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_material_requirement" (
  "task_id" BIGINT,
  "material_id" BIGINT,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  PRIMARY KEY ("task_id", "material_id"),
  CHECK ("quantity" > 0)
);
-- 设备信息表 (equipment): 维护天车、试验台等具体设备资源。
CREATE TABLE IF NOT EXISTS __SCHEMA__."equipment" (
  "equipment_id" BIGINT,
  "equipment_code" VARCHAR(64),
  "equipment_name" VARCHAR(128) NOT NULL,
  "equipment_type" VARCHAR(64) NOT NULL,
  "workstation_id" BIGINT,
  "status" VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
  "location" VARCHAR(128),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("equipment_id"),
  UNIQUE ("equipment_code")
);
-- 检修任务-设备关系表 (task_equipment_requirement): 定义任务对某类设备的数量需求；第一版按设备类型+数量配置。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_equipment_requirement" (
  "requirement_id" BIGINT,
  "task_id" BIGINT NOT NULL,
  "equipment_type" VARCHAR(64) NOT NULL,
  "quantity" INT NOT NULL DEFAULT 1,
  "use_duration_min" INT,
  "remark" VARCHAR(255),
  PRIMARY KEY ("requirement_id"),
  UNIQUE ("task_id", "equipment_type"),
  CHECK ("quantity" > 0),
  CHECK ("use_duration_min" IS NULL OR "use_duration_min" > 0)
);
-- 工作日历表 (work_calendar): 配置工作日、节假日和班次时间，用于将“第几天”转换成实际日期。
CREATE TABLE IF NOT EXISTS __SCHEMA__."work_calendar" (
  "calendar_date" DATE,
  "is_workday" BOOLEAN NOT NULL DEFAULT TRUE,
  "work_start_time" TIME,
  "work_end_time" TIME,
  "calendar_type" VARCHAR(16) NOT NULL DEFAULT 'WORKDAY',
  "remark" VARCHAR(255),
  PRIMARY KEY ("calendar_date")
);
-- 车辆维修表 (vehicle_repair): 一条记录表示一台机车的一次检修；年度/月度计划导入后直接落本表。
CREATE TABLE IF NOT EXISTS __SCHEMA__."vehicle_repair" (
  "vehicle_repair_id" BIGINT,
  "locomotive_no" VARCHAR(64) NOT NULL,
  "repair_program_id" BIGINT NOT NULL,
  "planned_entry_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "planned_exit_at" TIMESTAMP WITHOUT TIME ZONE,
  "actual_entry_at" TIMESTAMP WITHOUT TIME ZONE,
  "actual_exit_at" TIMESTAMP WITHOUT TIME ZONE,
  "status" VARCHAR(32) NOT NULL DEFAULT 'UNSCHEDULED',
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "current_version_id" BIGINT,
  "owner_bureau" VARCHAR(64),
  "owner_depot" VARCHAR(64),
  "repair_sequence" INT,
  "mileage_km" DECIMAL(12,1),
  "plan_source" VARCHAR(16),
  "priority" INT NOT NULL DEFAULT 100,
  "remark" VARCHAR(500),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("vehicle_repair_id"),
  CHECK ("planned_exit_at" IS NULL OR "planned_exit_at" > "planned_entry_at")
);
-- 版本表 (schedule_version): 保存同一次车辆检修的多个排程版本，支持自动排程、人工调整和发布。
CREATE TABLE IF NOT EXISTS __SCHEMA__."schedule_version" (
  "version_id" BIGINT,
  "vehicle_repair_id" BIGINT NOT NULL,
  "version_no" INT NOT NULL,
  "parent_version_id" BIGINT,
  "adjust_reason" VARCHAR(255),
  "remark" VARCHAR(500),
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP WITHOUT TIME ZONE,
  "published_by" BIGINT,
  "created_by" BIGINT,
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("version_id"),
  UNIQUE ("vehicle_repair_id", "version_no")
);
-- 车辆维修排程表 (vehicle_repair_schedule): 保存某个版本中每个标准检修任务的具体计划时间、工位和执行状态。
CREATE TABLE IF NOT EXISTS __SCHEMA__."vehicle_repair_schedule" (
  "schedule_task_id" BIGINT,
  "vehicle_repair_id" BIGINT NOT NULL,
  "task_id" BIGINT NOT NULL,
  "version_id" BIGINT NOT NULL,
  "workstation_id" BIGINT,
  "planned_start_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "planned_end_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "actual_start_at" TIMESTAMP WITHOUT TIME ZONE,
  "actual_end_at" TIMESTAMP WITHOUT TIME ZONE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
  "is_locked" BOOLEAN NOT NULL DEFAULT FALSE,
  "delay_minutes" INT NOT NULL DEFAULT 0,
  "remark" VARCHAR(500),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("schedule_task_id"),
  UNIQUE ("version_id", "task_id"),
  CHECK ("planned_end_at" >= "planned_start_at"),
  CHECK ("delay_minutes" >= 0)
);
-- 排程人员分配表 (schedule_employee_assignment): 将具体排程任务分配到具体人员，用于冲突判断和派工查询。
CREATE TABLE IF NOT EXISTS __SCHEMA__."schedule_employee_assignment" (
  "assignment_id" BIGINT,
  "schedule_task_id" BIGINT NOT NULL,
  "employee_id" BIGINT NOT NULL,
  "assignment_source" VARCHAR(16) NOT NULL DEFAULT 'AUTO',
  "status" VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
  "assigned_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remark" VARCHAR(255),
  PRIMARY KEY ("assignment_id"),
  UNIQUE ("schedule_task_id", "employee_id")
);
-- 排程设备分配表 (schedule_equipment_assignment): 排程阶段记录具体排程任务最终分配的具体设备，例如2号天车。
CREATE TABLE IF NOT EXISTS __SCHEMA__."schedule_equipment_assignment" (
  "allocation_id" BIGINT,
  "schedule_task_id" BIGINT NOT NULL,
  "equipment_id" BIGINT NOT NULL,
  "start_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "end_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
  "remark" VARCHAR(255),
  PRIMARY KEY ("allocation_id"),
  UNIQUE ("schedule_task_id", "equipment_id"),
  CHECK ("end_at" > "start_at")
);
-- 排程异常表 (schedule_exception): 记录工位冲突、人员不足、设备冲突、工具/备件/物料不足等排程异常。
CREATE TABLE IF NOT EXISTS __SCHEMA__."schedule_exception" (
  "exception_id" BIGINT,
  "vehicle_repair_id" BIGINT NOT NULL,
  "version_id" BIGINT NOT NULL,
  "schedule_task_id" BIGINT,
  "exception_type" VARCHAR(32) NOT NULL,
  "severity" VARCHAR(16) NOT NULL DEFAULT 'WARNING',
  "message" VARCHAR(500) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP WITHOUT TIME ZONE,
  PRIMARY KEY ("exception_id")
);
-- 审批记录表 (approval_record): 记录审核/审批流程的每一级处理人、结果、意见和时间。
CREATE TABLE IF NOT EXISTS __SCHEMA__."approval_record" (
  "approval_id" BIGINT,
  "business_type" VARCHAR(32) NOT NULL,
  "business_id" BIGINT NOT NULL,
  "approval_level" INT NOT NULL DEFAULT 1,
  "approval_role" VARCHAR(64),
  "approver_id" BIGINT,
  "approval_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "approval_opinion" VARCHAR(500),
  "approved_at" TIMESTAMP WITHOUT TIME ZONE,
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("approval_id")
);
-- 配件类型信息表 (component_type): 维护配件品种/规格主数据。这里的“配件”与原有“备件”独立，不替换 spare_part。
CREATE TABLE IF NOT EXISTS __SCHEMA__."component_type" (
  "component_type_id" BIGINT,
  "component_code" VARCHAR(64) NOT NULL,
  "component_name" VARCHAR(128) NOT NULL,
  "specification" VARCHAR(128),
  "unit" VARCHAR(16) NOT NULL DEFAULT '件',
  "manufacturer" VARCHAR(128),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("component_type_id"),
  UNIQUE ("component_code")
);
-- 配件实例信息表 (component_instance): 按“一件一条”管理具体配件实体，保存序列号、二维码、状态和当前位置，用于上下车、检修、周转和智能排程。
CREATE TABLE IF NOT EXISTS __SCHEMA__."component_instance" (
  "component_instance_id" BIGINT,
  "component_type_id" BIGINT NOT NULL,
  "serial_no" VARCHAR(128) NOT NULL,
  "asset_code" VARCHAR(64),
  "qr_code" VARCHAR(128),
  "lifecycle_status" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  "location_type" VARCHAR(16) NOT NULL DEFAULT 'WAREHOUSE',
  "current_workstation_id" BIGINT,
  "current_locomotive_no" VARCHAR(64),
  "location_text" VARCHAR(128),
  "manufacturer" VARCHAR(128),
  "manufacture_date" DATE,
  "service_start_date" DATE,
  "accumulated_mileage_km" DECIMAL(12,1) DEFAULT 0,
  "wastage_rate" DECIMAL(5,2) DEFAULT 0,
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("component_instance_id"),
  UNIQUE ("serial_no"),
  UNIQUE ("asset_code"),
  UNIQUE ("qr_code"),
  CHECK ("wastage_rate" >= 0 AND "wastage_rate" <= 100)
);
-- 检修任务-配件需求关系表 (task_component_requirement): 定义标准检修任务需要哪类配件、需要多少件以及对配件执行的动作；与原 task_part_requirement（任务-备件关系）并存。
CREATE TABLE IF NOT EXISTS __SCHEMA__."task_component_requirement" (
  "requirement_id" BIGINT,
  "task_id" BIGINT NOT NULL,
  "component_type_id" BIGINT NOT NULL,
  "quantity" INT NOT NULL DEFAULT 1,
  "component_action" VARCHAR(16) NOT NULL DEFAULT 'USE',
  "is_mandatory" BOOLEAN NOT NULL DEFAULT TRUE,
  "remark" VARCHAR(255),
  PRIMARY KEY ("requirement_id"),
  UNIQUE ("task_id", "component_type_id", "component_action"),
  CHECK ("quantity" > 0)
);
-- 排程配件分配表 (schedule_component_assignment): 在排程阶段为具体任务选择并锁定具体配件实例，支持精确到序列号的配件资源约束。
CREATE TABLE IF NOT EXISTS __SCHEMA__."schedule_component_assignment" (
  "allocation_id" BIGINT,
  "schedule_task_id" BIGINT NOT NULL,
  "component_instance_id" BIGINT NOT NULL,
  "component_action" VARCHAR(16) NOT NULL DEFAULT 'USE',
  "assignment_source" VARCHAR(16) NOT NULL DEFAULT 'AUTO',
  "status" VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
  "assigned_by_employee_id" BIGINT,
  "assigned_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remark" VARCHAR(255),
  PRIMARY KEY ("allocation_id"),
  UNIQUE ("schedule_task_id", "component_instance_id", "component_action")
);
-- 配件流转记录表 (component_movement_record): 记录具体配件从下车、检修、转运、入库、出库到再次装车的流转历史，形成一物一码履历。
CREATE TABLE IF NOT EXISTS __SCHEMA__."component_movement_record" (
  "movement_id" BIGINT,
  "component_instance_id" BIGINT NOT NULL,
  "vehicle_repair_id" BIGINT,
  "schedule_task_id" BIGINT,
  "movement_type" VARCHAR(24) NOT NULL,
  "from_location_type" VARCHAR(16),
  "from_location" VARCHAR(128),
  "to_location_type" VARCHAR(16),
  "to_location" VARCHAR(128),
  "operator_employee_id" BIGINT,
  "moved_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remark" VARCHAR(255),
  PRIMARY KEY ("movement_id")
);
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_employee_team_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."employee" ADD CONSTRAINT "fk_employee_team_id" FOREIGN KEY ("team_id") REFERENCES __SCHEMA__."team" ("team_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_employee_leave_employee_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."employee_leave" ADD CONSTRAINT "fk_employee_leave_employee_id" FOREIGN KEY ("employee_id") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_repair_program_model_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."repair_program" ADD CONSTRAINT "fk_repair_program_model_id" FOREIGN KEY ("model_id") REFERENCES __SCHEMA__."locomotive_model" ("model_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_maintenance_task_repair_program_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."maintenance_task" ADD CONSTRAINT "fk_maintenance_task_repair_program_id" FOREIGN KEY ("repair_program_id") REFERENCES __SCHEMA__."repair_program" ("repair_program_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_maintenance_task_workstation_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."maintenance_task" ADD CONSTRAINT "fk_maintenance_task_workstation_id" FOREIGN KEY ("workstation_id") REFERENCES __SCHEMA__."workstation" ("workstation_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_dependency_parent_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_dependency" ADD CONSTRAINT "fk_task_dependency_parent_task_id" FOREIGN KEY ("parent_task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_dependency_child_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_dependency" ADD CONSTRAINT "fk_task_dependency_child_task_id" FOREIGN KEY ("child_task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_team_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_team_requirement" ADD CONSTRAINT "fk_task_team_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_team_requirement_team_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_team_requirement" ADD CONSTRAINT "fk_task_team_requirement_team_id" FOREIGN KEY ("team_id") REFERENCES __SCHEMA__."team" ("team_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_tool_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_tool_requirement" ADD CONSTRAINT "fk_task_tool_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_tool_requirement_tool_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_tool_requirement" ADD CONSTRAINT "fk_task_tool_requirement_tool_id" FOREIGN KEY ("tool_id") REFERENCES __SCHEMA__."tool" ("tool_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_part_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_part_requirement" ADD CONSTRAINT "fk_task_part_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_part_requirement_part_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_part_requirement" ADD CONSTRAINT "fk_task_part_requirement_part_id" FOREIGN KEY ("part_id") REFERENCES __SCHEMA__."spare_part" ("part_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_material_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_material_requirement" ADD CONSTRAINT "fk_task_material_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_material_requirement_material_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_material_requirement" ADD CONSTRAINT "fk_task_material_requirement_material_id" FOREIGN KEY ("material_id") REFERENCES __SCHEMA__."material" ("material_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_equipment_workstation_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."equipment" ADD CONSTRAINT "fk_equipment_workstation_id" FOREIGN KEY ("workstation_id") REFERENCES __SCHEMA__."workstation" ("workstation_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_equipment_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_equipment_requirement" ADD CONSTRAINT "fk_task_equipment_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_repair_program_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair" ADD CONSTRAINT "fk_vehicle_repair_repair_program_id" FOREIGN KEY ("repair_program_id") REFERENCES __SCHEMA__."repair_program" ("repair_program_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_current_version_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair" ADD CONSTRAINT "fk_vehicle_repair_current_version_id" FOREIGN KEY ("current_version_id") REFERENCES __SCHEMA__."schedule_version" ("version_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_version_vehicle_repair_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_version" ADD CONSTRAINT "fk_schedule_version_vehicle_repair_id" FOREIGN KEY ("vehicle_repair_id") REFERENCES __SCHEMA__."vehicle_repair" ("vehicle_repair_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_version_parent_version_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_version" ADD CONSTRAINT "fk_schedule_version_parent_version_id" FOREIGN KEY ("parent_version_id") REFERENCES __SCHEMA__."schedule_version" ("version_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_version_published_by' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_version" ADD CONSTRAINT "fk_schedule_version_published_by" FOREIGN KEY ("published_by") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_version_created_by' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_version" ADD CONSTRAINT "fk_schedule_version_created_by" FOREIGN KEY ("created_by") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_schedule_vehicle_repair_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair_schedule" ADD CONSTRAINT "fk_vehicle_repair_schedule_vehicle_repair_id" FOREIGN KEY ("vehicle_repair_id") REFERENCES __SCHEMA__."vehicle_repair" ("vehicle_repair_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair_schedule" ADD CONSTRAINT "fk_vehicle_repair_schedule_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_schedule_version_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair_schedule" ADD CONSTRAINT "fk_vehicle_repair_schedule_version_id" FOREIGN KEY ("version_id") REFERENCES __SCHEMA__."schedule_version" ("version_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_vehicle_repair_schedule_workstation_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."vehicle_repair_schedule" ADD CONSTRAINT "fk_vehicle_repair_schedule_workstation_id" FOREIGN KEY ("workstation_id") REFERENCES __SCHEMA__."workstation" ("workstation_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_employee_assignment_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_employee_assignment" ADD CONSTRAINT "fk_schedule_employee_assignment_schedule_task_id" FOREIGN KEY ("schedule_task_id") REFERENCES __SCHEMA__."vehicle_repair_schedule" ("schedule_task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_employee_assignment_employee_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_employee_assignment" ADD CONSTRAINT "fk_schedule_employee_assignment_employee_id" FOREIGN KEY ("employee_id") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_equipment_assignment_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_equipment_assignment" ADD CONSTRAINT "fk_schedule_equipment_assignment_schedule_task_id" FOREIGN KEY ("schedule_task_id") REFERENCES __SCHEMA__."vehicle_repair_schedule" ("schedule_task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_equipment_assignment_equipment_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_equipment_assignment" ADD CONSTRAINT "fk_schedule_equipment_assignment_equipment_id" FOREIGN KEY ("equipment_id") REFERENCES __SCHEMA__."equipment" ("equipment_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_exception_vehicle_repair_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_exception" ADD CONSTRAINT "fk_schedule_exception_vehicle_repair_id" FOREIGN KEY ("vehicle_repair_id") REFERENCES __SCHEMA__."vehicle_repair" ("vehicle_repair_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_exception_version_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_exception" ADD CONSTRAINT "fk_schedule_exception_version_id" FOREIGN KEY ("version_id") REFERENCES __SCHEMA__."schedule_version" ("version_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_exception_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_exception" ADD CONSTRAINT "fk_schedule_exception_schedule_task_id" FOREIGN KEY ("schedule_task_id") REFERENCES __SCHEMA__."vehicle_repair_schedule" ("schedule_task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_approval_record_approver_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."approval_record" ADD CONSTRAINT "fk_approval_record_approver_id" FOREIGN KEY ("approver_id") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_instance_component_type_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_instance" ADD CONSTRAINT "fk_component_instance_component_type_id" FOREIGN KEY ("component_type_id") REFERENCES __SCHEMA__."component_type" ("component_type_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_instance_current_workstation_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_instance" ADD CONSTRAINT "fk_component_instance_current_workstation_id" FOREIGN KEY ("current_workstation_id") REFERENCES __SCHEMA__."workstation" ("workstation_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_component_requirement_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_component_requirement" ADD CONSTRAINT "fk_task_component_requirement_task_id" FOREIGN KEY ("task_id") REFERENCES __SCHEMA__."maintenance_task" ("task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_task_component_requirement_component_type_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."task_component_requirement" ADD CONSTRAINT "fk_task_component_requirement_component_type_id" FOREIGN KEY ("component_type_id") REFERENCES __SCHEMA__."component_type" ("component_type_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_component_assignment_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_component_assignment" ADD CONSTRAINT "fk_schedule_component_assignment_schedule_task_id" FOREIGN KEY ("schedule_task_id") REFERENCES __SCHEMA__."vehicle_repair_schedule" ("schedule_task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_component_assignment_component_instance_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_component_assignment" ADD CONSTRAINT "fk_schedule_component_assignment_component_instance_id" FOREIGN KEY ("component_instance_id") REFERENCES __SCHEMA__."component_instance" ("component_instance_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_schedule_component_assignment_assigned_by_employee_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."schedule_component_assignment" ADD CONSTRAINT "fk_schedule_component_assignment_assigned_by_employee_id" FOREIGN KEY ("assigned_by_employee_id") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_movement_record_component_instance_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_movement_record" ADD CONSTRAINT "fk_component_movement_record_component_instance_id" FOREIGN KEY ("component_instance_id") REFERENCES __SCHEMA__."component_instance" ("component_instance_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_movement_record_vehicle_repair_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_movement_record" ADD CONSTRAINT "fk_component_movement_record_vehicle_repair_id" FOREIGN KEY ("vehicle_repair_id") REFERENCES __SCHEMA__."vehicle_repair" ("vehicle_repair_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_movement_record_schedule_task_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_movement_record" ADD CONSTRAINT "fk_component_movement_record_schedule_task_id" FOREIGN KEY ("schedule_task_id") REFERENCES __SCHEMA__."vehicle_repair_schedule" ("schedule_task_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_component_movement_record_operator_employee_id' AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__."component_movement_record" ADD CONSTRAINT "fk_component_movement_record_operator_employee_id" FOREIGN KEY ("operator_employee_id") REFERENCES __SCHEMA__."employee" ("employee_id") DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;
CREATE INDEX IF NOT EXISTS "idx_employee_2" ON __SCHEMA__."employee" ("team_id", "status");
CREATE INDEX IF NOT EXISTS "idx_employee_leave_1" ON __SCHEMA__."employee_leave" ("employee_id", "start_at", "end_at");
CREATE INDEX IF NOT EXISTS "idx_tool_2" ON __SCHEMA__."tool" ("status");
CREATE INDEX IF NOT EXISTS "idx_spare_part_2" ON __SCHEMA__."spare_part" ("status");
CREATE INDEX IF NOT EXISTS "idx_material_2" ON __SCHEMA__."material" ("status");
CREATE INDEX IF NOT EXISTS "idx_workstation_2" ON __SCHEMA__."workstation" ("production_line", "status");
CREATE INDEX IF NOT EXISTS "idx_maintenance_task_1" ON __SCHEMA__."maintenance_task" ("repair_program_id", "sequence_no", "status");
CREATE INDEX IF NOT EXISTS "idx_task_tool_requirement_2" ON __SCHEMA__."task_tool_requirement" ("tool_id");
CREATE INDEX IF NOT EXISTS "idx_task_part_requirement_2" ON __SCHEMA__."task_part_requirement" ("part_id");
CREATE INDEX IF NOT EXISTS "idx_task_material_requirement_2" ON __SCHEMA__."task_material_requirement" ("material_id");
CREATE INDEX IF NOT EXISTS "idx_equipment_2" ON __SCHEMA__."equipment" ("equipment_type", "status");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_1" ON __SCHEMA__."vehicle_repair" ("planned_entry_at", "status");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_2" ON __SCHEMA__."vehicle_repair" ("locomotive_no");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_3" ON __SCHEMA__."vehicle_repair" ("repair_program_id");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_4" ON __SCHEMA__."vehicle_repair" ("approval_status");
CREATE INDEX IF NOT EXISTS "idx_schedule_version_2" ON __SCHEMA__."schedule_version" ("vehicle_repair_id", "status");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_schedule_2" ON __SCHEMA__."vehicle_repair_schedule" ("workstation_id", "planned_start_at", "planned_end_at");
CREATE INDEX IF NOT EXISTS "idx_vehicle_repair_schedule_3" ON __SCHEMA__."vehicle_repair_schedule" ("vehicle_repair_id", "version_id");
CREATE INDEX IF NOT EXISTS "idx_schedule_employee_assignment_2" ON __SCHEMA__."schedule_employee_assignment" ("employee_id");
CREATE INDEX IF NOT EXISTS "idx_schedule_equipment_assignment_2" ON __SCHEMA__."schedule_equipment_assignment" ("equipment_id", "start_at", "end_at");
CREATE INDEX IF NOT EXISTS "idx_schedule_exception_1" ON __SCHEMA__."schedule_exception" ("version_id", "status");
CREATE INDEX IF NOT EXISTS "idx_schedule_exception_2" ON __SCHEMA__."schedule_exception" ("schedule_task_id");
CREATE INDEX IF NOT EXISTS "idx_approval_record_1" ON __SCHEMA__."approval_record" ("business_type", "business_id");
CREATE INDEX IF NOT EXISTS "idx_approval_record_2" ON __SCHEMA__."approval_record" ("approver_id", "approval_status");
CREATE INDEX IF NOT EXISTS "idx_component_type_2" ON __SCHEMA__."component_type" ("component_name", "status");
CREATE INDEX IF NOT EXISTS "idx_component_instance_4" ON __SCHEMA__."component_instance" ("component_type_id", "lifecycle_status");
CREATE INDEX IF NOT EXISTS "idx_component_instance_5" ON __SCHEMA__."component_instance" ("current_locomotive_no");
CREATE INDEX IF NOT EXISTS "idx_component_instance_6" ON __SCHEMA__."component_instance" ("current_workstation_id", "lifecycle_status");
CREATE INDEX IF NOT EXISTS "idx_task_component_requirement_2" ON __SCHEMA__."task_component_requirement" ("component_type_id");
CREATE INDEX IF NOT EXISTS "idx_task_component_requirement_3" ON __SCHEMA__."task_component_requirement" ("task_id", "is_mandatory");
CREATE INDEX IF NOT EXISTS "idx_schedule_component_assignment_2" ON __SCHEMA__."schedule_component_assignment" ("component_instance_id", "status");
CREATE INDEX IF NOT EXISTS "idx_schedule_component_assignment_3" ON __SCHEMA__."schedule_component_assignment" ("schedule_task_id", "status");
CREATE INDEX IF NOT EXISTS "idx_component_movement_record_1" ON __SCHEMA__."component_movement_record" ("component_instance_id", "moved_at");
CREATE INDEX IF NOT EXISTS "idx_component_movement_record_2" ON __SCHEMA__."component_movement_record" ("vehicle_repair_id", "moved_at");
CREATE INDEX IF NOT EXISTS "idx_component_movement_record_3" ON __SCHEMA__."component_movement_record" ("schedule_task_id");
CREATE INDEX IF NOT EXISTS "idx_component_movement_record_4" ON __SCHEMA__."component_movement_record" ("movement_type", "moved_at");
CREATE TABLE IF NOT EXISTS __SCHEMA__.application_state (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), schema_version integer NOT NULL DEFAULT 2, payload jsonb NOT NULL DEFAULT '{}'::jsonb);
INSERT INTO __SCHEMA__.application_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION __SCHEMA__.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $trigger$ BEGIN NEW.updated_at=CURRENT_TIMESTAMP; RETURN NEW; END; $trigger$;
DROP TRIGGER IF EXISTS "trg_team_updated_at" ON __SCHEMA__."team"; CREATE TRIGGER "trg_team_updated_at" BEFORE UPDATE ON __SCHEMA__."team" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_employee_updated_at" ON __SCHEMA__."employee"; CREATE TRIGGER "trg_employee_updated_at" BEFORE UPDATE ON __SCHEMA__."employee" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_tool_updated_at" ON __SCHEMA__."tool"; CREATE TRIGGER "trg_tool_updated_at" BEFORE UPDATE ON __SCHEMA__."tool" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_spare_part_updated_at" ON __SCHEMA__."spare_part"; CREATE TRIGGER "trg_spare_part_updated_at" BEFORE UPDATE ON __SCHEMA__."spare_part" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_material_updated_at" ON __SCHEMA__."material"; CREATE TRIGGER "trg_material_updated_at" BEFORE UPDATE ON __SCHEMA__."material" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_workstation_updated_at" ON __SCHEMA__."workstation"; CREATE TRIGGER "trg_workstation_updated_at" BEFORE UPDATE ON __SCHEMA__."workstation" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_locomotive_model_updated_at" ON __SCHEMA__."locomotive_model"; CREATE TRIGGER "trg_locomotive_model_updated_at" BEFORE UPDATE ON __SCHEMA__."locomotive_model" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_repair_program_updated_at" ON __SCHEMA__."repair_program"; CREATE TRIGGER "trg_repair_program_updated_at" BEFORE UPDATE ON __SCHEMA__."repair_program" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_maintenance_task_updated_at" ON __SCHEMA__."maintenance_task"; CREATE TRIGGER "trg_maintenance_task_updated_at" BEFORE UPDATE ON __SCHEMA__."maintenance_task" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_equipment_updated_at" ON __SCHEMA__."equipment"; CREATE TRIGGER "trg_equipment_updated_at" BEFORE UPDATE ON __SCHEMA__."equipment" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_vehicle_repair_updated_at" ON __SCHEMA__."vehicle_repair"; CREATE TRIGGER "trg_vehicle_repair_updated_at" BEFORE UPDATE ON __SCHEMA__."vehicle_repair" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_vehicle_repair_schedule_updated_at" ON __SCHEMA__."vehicle_repair_schedule"; CREATE TRIGGER "trg_vehicle_repair_schedule_updated_at" BEFORE UPDATE ON __SCHEMA__."vehicle_repair_schedule" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_component_type_updated_at" ON __SCHEMA__."component_type"; CREATE TRIGGER "trg_component_type_updated_at" BEFORE UPDATE ON __SCHEMA__."component_type" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
DROP TRIGGER IF EXISTS "trg_component_instance_updated_at" ON __SCHEMA__."component_instance"; CREATE TRIGGER "trg_component_instance_updated_at" BEFORE UPDATE ON __SCHEMA__."component_instance" FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();
