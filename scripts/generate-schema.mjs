import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const definitions = JSON.parse(await fs.readFile(path.join(root, 'server/tables.json'), 'utf8'))
const expected = ['team','employee','employee_leave','tool','spare_part','material','workstation','locomotive_model','repair_program','maintenance_task','task_dependency','task_team_requirement','task_tool_requirement','task_part_requirement','task_material_requirement','equipment','task_equipment_requirement','work_calendar','vehicle_repair','schedule_version','vehicle_repair_schedule','schedule_employee_assignment','schedule_equipment_assignment','schedule_exception','approval_record','component_type','component_instance','task_component_requirement','schedule_component_assignment','component_movement_record']
if (definitions.length !== 30 || expected.some((name, i) => definitions[i]?.table !== name)) throw new Error('数据库.xlsx中的30张业务表次序或名称变化，请先人工复核映射。')
const q = value => `"${String(value).replaceAll('"', '""')}"`
const lit = value => `'${String(value).replaceAll("'", "''")}'`
const type = value => String(value).toUpperCase() === 'DATETIME' ? 'TIMESTAMP WITHOUT TIME ZONE' : String(value).toUpperCase()
const defaults = value => {
  if (value == null || String(value).trim() === '' || String(value) === '31') return ''
  if (/^CURRENT_TIMESTAMP$/i.test(String(value))) return ' DEFAULT CURRENT_TIMESTAMP'
  if (/^(TRUE|FALSE)$/i.test(String(value))) return ` DEFAULT ${String(value).toUpperCase()}`
  if (/^-?\d+(?:\.\d+)?$/.test(String(value))) return ` DEFAULT ${value}`
  return ` DEFAULT '${String(value).replaceAll("'", "''")}'`
}
const sql = ['-- Generated from the 30-table PostgreSQL data dictionary in docs/数据库.xlsx. Do not edit by hand.', 'CREATE SCHEMA IF NOT EXISTS __SCHEMA__;']
for (const table of definitions) {
  sql.push(`-- ${table.label} (${table.table}): ${table.purpose.replaceAll('\n', ' ')}`)
  const fields = table.columns.map(column => {
    const primary = /\bPK\b/.test(column.key)
    return `  ${q(column.name)} ${type(column.type)}${column.nullable || primary ? '' : ' NOT NULL'}${defaults(column.default)}`
  })
  const primaryFields = table.columns.filter(column => /\bPK\b/.test(column.key)).map(column => q(column.name))
  const constraints = primaryFields.length ? [`  PRIMARY KEY (${primaryFields.join(', ')})`] : []
  for (const index of table.indexes) {
    const unique = index.match(/^UK\(([^)]+)\)$/)
    if (unique) constraints.push(`  UNIQUE (${unique[1].split(',').map(part => q(part.trim())).join(', ')})`)
  }
  const checks = {
    employee_leave: ['"end_at" > "start_at"'],
    maintenance_task: ['"standard_duration_min" > 0'],
    task_team_requirement: ['"headcount" > 0','"work_duration_min" IS NULL OR "work_duration_min" > 0'],
    task_tool_requirement: ['"quantity" > 0'],
    task_part_requirement: ['"quantity" > 0'],
    task_material_requirement: ['"quantity" > 0'],
    task_equipment_requirement: ['"quantity" > 0','"use_duration_min" IS NULL OR "use_duration_min" > 0'],
    vehicle_repair: ['"planned_exit_at" IS NULL OR "planned_exit_at" > "planned_entry_at"'],
    vehicle_repair_schedule: ['"planned_end_at" >= "planned_start_at"','"delay_minutes" >= 0'],
    component_instance: ['"wastage_rate" >= 0 AND "wastage_rate" <= 100'],
    task_component_requirement: ['"quantity" > 0'],
    schedule_equipment_assignment: ['"end_at" > "start_at"'],
  }
  for (let i = 0; i < (checks[table.table] || []).length; i++) constraints.push(`  CHECK (${checks[table.table][i]})`)
  const definitionsForTable = fields.concat(constraints)
  sql.push(`CREATE TABLE IF NOT EXISTS __SCHEMA__.${q(table.table)} (\n${definitionsForTable.join(',\n')}\n);`)
}
for (const table of definitions) for (const column of table.columns) {
  const ref = String(column.reference || '').match(/^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/)
  if (!ref) continue
  const constraint = q(`fk_${table.table}_${column.name}`)
  sql.push(`DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname=${lit(`fk_${table.table}_${column.name}`)} AND n.nspname=__SCHEMA_LITERAL__) THEN ALTER TABLE __SCHEMA__.${q(table.table)} ADD CONSTRAINT ${constraint} FOREIGN KEY (${q(column.name)}) REFERENCES __SCHEMA__.${q(ref[1])} (${q(ref[2])}) DEFERRABLE INITIALLY DEFERRED; END IF; END; $migration$;`)
}
// The workbook marks non-unique indexes as future, workload-dependent guidance.
for (const table of definitions) for (let i = 0; i < table.indexes.length; i++) {
  const match = table.indexes[i].match(/^IDX\(([^)]+)\)$/)
  if (!match) continue
  const columns = match[1].split(',').map(value => value.trim())
  sql.push(`CREATE INDEX IF NOT EXISTS ${q(`idx_${table.table}_${i + 1}`)} ON __SCHEMA__.${q(table.table)} (${columns.map(q).join(', ')});`)
}
sql.push('CREATE TABLE IF NOT EXISTS __SCHEMA__.application_state (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), schema_version integer NOT NULL DEFAULT 2, payload jsonb NOT NULL DEFAULT \'{}\'::jsonb);')
sql.push("INSERT INTO __SCHEMA__.application_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;")
sql.push('CREATE OR REPLACE FUNCTION __SCHEMA__.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $trigger$ BEGIN NEW.updated_at=CURRENT_TIMESTAMP; RETURN NEW; END; $trigger$;')
for (const table of definitions.filter(item => item.columns.some(column => column.name === 'updated_at'))) {
  sql.push(`DROP TRIGGER IF EXISTS ${q(`trg_${table.table}_updated_at`)} ON __SCHEMA__.${q(table.table)}; CREATE TRIGGER ${q(`trg_${table.table}_updated_at`)} BEFORE UPDATE ON __SCHEMA__.${q(table.table)} FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.touch_updated_at();`)
}
await fs.writeFile(path.join(root, 'server/schema.sql'), `${sql.join('\n')}\n`, 'utf8')
console.log(`已生成30张业务表、${definitions.reduce((count, table) => count + table.columns.length, 0)}个字段，并添加应用版本表。`)
