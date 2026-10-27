import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function loadConfig() {
  const file = path.join(projectRoot, '.env')
  if (fs.existsSync(file)) process.loadEnvFile(file)
  const schema = process.env.PC1_DB_SCHEMA || 'pc1'
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('PC1_DB_SCHEMA格式不正确')
  return { connectionString: process.env.DATABASE_URL, schema }
}
