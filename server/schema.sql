CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
CREATE TABLE IF NOT EXISTS __SCHEMA__.metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1
);
INSERT INTO __SCHEMA__.metadata(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS __SCHEMA__.reference_data (
  collection text PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.vehicle_repairs (
  id bigint PRIMARY KEY,
  locomotive_no text NOT NULL,
  planned_entry_at timestamp without time zone NOT NULL,
  requested_exit_at timestamp without time zone NOT NULL,
  status text NOT NULL,
  details jsonb NOT NULL,
  CHECK (requested_exit_at > planned_entry_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_entry_unique ON __SCHEMA__.vehicle_repairs(upper(trim(locomotive_no)), (planned_entry_at::date));
CREATE TABLE IF NOT EXISTS __SCHEMA__.schedule_versions (
  id bigint PRIMARY KEY,
  vehicle_repair_id bigint NOT NULL REFERENCES __SCHEMA__.vehicle_repairs(id),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  details jsonb NOT NULL,
  UNIQUE(vehicle_repair_id, id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.schedules (
  id bigint PRIMARY KEY,
  vehicle_repair_id bigint NOT NULL REFERENCES __SCHEMA__.vehicle_repairs(id),
  task_id bigint NOT NULL,
  version_id bigint,
  workstation_id bigint NOT NULL,
  planned_start_at timestamp without time zone NOT NULL,
  planned_end_at timestamp without time zone NOT NULL,
  status text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL,
  CHECK (planned_end_at >= planned_start_at),
  FOREIGN KEY (vehicle_repair_id, version_id) REFERENCES __SCHEMA__.schedule_versions(vehicle_repair_id, id),
  UNIQUE(vehicle_repair_id, task_id)
);
CREATE INDEX IF NOT EXISTS schedules_vehicle_dates ON __SCHEMA__.schedules(vehicle_repair_id, planned_start_at, planned_end_at);
CREATE TABLE IF NOT EXISTS __SCHEMA__.resource_assignments (
  kind text NOT NULL CHECK (kind IN ('employee', 'equipment', 'component')),
  id bigint NOT NULL,
  schedule_id bigint NOT NULL REFERENCES __SCHEMA__.schedules(id),
  resource_id bigint NOT NULL,
  details jsonb NOT NULL,
  PRIMARY KEY(kind, id)
);
CREATE INDEX IF NOT EXISTS assignment_schedule ON __SCHEMA__.resource_assignments(schedule_id);
