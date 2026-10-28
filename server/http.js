import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectRoot } from './config.js'
import { createPlanningService } from './planning.js'

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请使用JSON请求'), { status: 415 })
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 12 * 1024 * 1024) throw Object.assign(new Error('请求超过12MB'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('请求JSON格式无效'), { status: 400 }) }
}

export function createHandler(database) {
  const planning = database ? createPlanningService(database) : null
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { storage: database ? 'postgresql' : 'local' })
        if (!database) return json(res, 503, { message: '当前为显式本地演示模式，未启用数据库' })
        if (url.pathname.startsWith('/api/planning/')) {
          if (['POST', 'DELETE'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message: '拒绝跨站写入' })
          const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('pc1_import_session='))
          let sessionId = cookie?.slice('pc1_import_session='.length)
          if (!sessionId || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
            sessionId = randomUUID()
            res.setHeader('Set-Cookie', `pc1_import_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${req.socket.encrypted ? '; Secure' : ''}`)
          }
          if (url.pathname === '/api/planning/lookups' && req.method === 'GET') return json(res, 200, await planning.lookups())
          if (url.pathname === '/api/planning/plans' && req.method === 'GET') {
            const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || ''
            if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json(res, 400, { message: '计划日期范围无效' })
            for (const key of ['modelId', 'programId']) if (url.searchParams.get(key) && !/^\d+$/.test(url.searchParams.get(key))) return json(res, 400, { message: '筛选条件无效' })
            const planSource = url.searchParams.get('planSource') || ''
            if (planSource && !['ANNUAL', 'MONTHLY'].includes(planSource)) return json(res, 400, { message: '计划来源筛选无效' })
            const result = await planning.plans({ from, to, modelId: url.searchParams.get('modelId'), programId: url.searchParams.get('programId'), locomotiveNo: (url.searchParams.get('locomotiveNo') || '').slice(0, 64), planSource })
            return json(res, 200, result)
          }
          if (url.pathname === '/api/planning/calendar' && req.method === 'GET') {
            const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || ''
            if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json(res, 400, { message: '日历日期范围无效' })
            for (const key of ['modelId', 'programId']) if (url.searchParams.get(key) && !/^\d+$/.test(url.searchParams.get(key))) return json(res, 400, { message: '筛选条件无效' })
            const result = await planning.calendar({ from, to, modelId: url.searchParams.get('modelId'), programId: url.searchParams.get('programId'), locomotiveNo: (url.searchParams.get('locomotiveNo') || '').slice(0, 64) })
            return json(res, 200, result)
          }
          const vehicle = url.pathname.match(/^\/api\/planning\/vehicles\/(\d+)$/)
          if (vehicle && req.method === 'GET') {
            const row = await planning.vehicle(vehicle[1])
            return row ? json(res, 200, row) : json(res, 404, { message: '未找到该检修记录' })
          }
          if (url.pathname === '/api/planning/import/template.xlsx' && req.method === 'GET') {
            const file = await planning.templateXlsx()
            res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('检修计划导入模板.xlsx')}`, 'Cache-Control': 'no-store' })
            return res.end(file)
          }
          if (url.pathname === '/api/planning/import/template.csv' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('检修计划导入模板.csv')}`, 'Cache-Control': 'no-store' })
            return res.end(planning.templateCsv())
          }
          if (url.pathname === '/api/planning/import/example.md' && req.method === 'GET') {
            const file = await fs.readFile(path.join(projectRoot, 'docs', '年度月度计划导入示例.md'))
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent('年度月度计划导入示例.md')}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
            return res.end(file)
          }
          if (url.pathname === '/api/planning/import/preview' && req.method === 'POST') {
            const input = await body(req)
            return json(res, 200, await planning.preview({ ...input, sessionId }))
          }
          const errors = url.pathname.match(/^\/api\/planning\/import\/([^/]+)\/errors\.csv$/)
          if (errors && req.method === 'GET') {
            const csv = planning.errorsCsv(decodeURIComponent(errors[1]), sessionId)
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('检修计划导入错误明细.csv')}`, 'Cache-Control': 'no-store' })
            return res.end(csv)
          }
          if (url.pathname === '/api/planning/import/confirm' && req.method === 'POST') {
            const input = await body(req)
            const result = await planning.confirm(sessionId, String(input.previewId || ''))
            return json(res, result.changed ? 409 : 200, result)
          }
          const preview = url.pathname.match(/^\/api\/planning\/import\/preview\/([^/]+)$/)
          if (preview && req.method === 'DELETE') return json(res, 200, await planning.cancel(sessionId, decodeURIComponent(preview[1])))
          return json(res, 404, { message: '计划管理接口不存在' })
        }
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, ...await database.health() })
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await database.read())
        if (url.pathname === '/api/state' && req.method === 'PUT') {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message: '拒绝跨站写入' })
          const value = await body(req)
          if (!value || typeof value !== 'object' || !value.snapshot) return json(res, 400, { message: '请求缺少排程数据' })
          return json(res, 200, await database.save(value.revision, value.snapshot))
        }
        return json(res, 404, { message: '接口不存在' })
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: '不支持该请求方式' })
      let decoded
      try { decoded = decodeURIComponent(req.url.split('?')[0]) } catch { return json(res, 400, { message: '地址编码无效' }) }
      // Only public browser assets are served; .env, server code and node_modules
      // never fall through to the old static server or SPA fallback.
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(x => x === '..' || x.startsWith('.'))) return json(res, 403, { message: '禁止访问' })
      const publicPath = decoded === '/' ? '/index.html' : decoded
      if (publicPath !== '/index.html' && !publicPath.startsWith('/src/') && !publicPath.startsWith('/vendor/')) return json(res, 404, { message: '文件不存在' })
      const file = path.join(projectRoot, publicPath)
      let content
      try { content = await fs.readFile(file) } catch { return json(res, 404, { message: '文件不存在' }) }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : content)
    } catch (error) {
      const status = error.status || (error.code?.startsWith('23') ? 400 : 503)
      const message = error.status ? error.message : status === 400 ? '数据库约束校验失败，原数据未改变' : 'PostgreSQL暂不可用，数据未保存；请重试或联系服务端'
      if (!error.status) console.error('请求失败:', error.code || error.name)
      if (!res.headersSent) json(res, status, { message })
      else res.end()
    }
  }
}
