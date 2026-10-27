import fs from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './config.js'

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
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { storage: database ? 'postgresql' : 'local' })
        if (!database) return json(res, 503, { message: '当前为显式本地演示模式，未启用数据库' })
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
