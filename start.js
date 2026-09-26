import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const portArg = process.argv.find((v) => v.startsWith('--port='))
const PORT = Number(portArg?.split('=')[1] || process.env.PORT || 5173)
const noOpen = process.argv.includes('--no-open') || process.env.NO_OPEN === '1'
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

function safePath(urlPath) {
  const raw = decodeURIComponent((urlPath || '/').split('?')[0])
  const normalized = path.normalize(raw).replace(/^([.][.][/\\])+/, '')
  const rel = normalized === '/' ? 'index.html' : normalized.replace(/^[/\\]/, '')
  return path.join(__dirname, rel)
}

const server = http.createServer((req, res) => {
  let file = safePath(req.url)
  if (!file.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) file = path.join(file, 'index.html')
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        // hash router normally never reaches here, but keep SPA fallback for direct URLs.
        fs.readFile(path.join(__dirname, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) { res.writeHead(404); res.end('Not Found'); return }
          res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' })
          res.end(fallback)
        })
        return
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      })
      res.end(data)
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`
  console.log(`\n高级修智能排程第一版已启动: ${url}`)
  console.log('按 Ctrl+C 可停止服务。\n')
  if (!noOpen) {
    const p = process.platform
    const command = p === 'win32' ? 'cmd' : p === 'darwin' ? 'open' : 'xdg-open'
    const args = p === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  }
})
