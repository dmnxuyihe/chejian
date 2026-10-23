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

function openBrowser(url) {
  if (noOpen) return
  const p = process.platform
  const command = p === 'win32' ? 'cmd' : p === 'darwin' ? 'open' : 'xdg-open'
  const args = p === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function isCurrentAppRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal:AbortSignal.timeout(1200) })
    const html = await response.text()
    return response.ok && html.includes('高级修智能排程') && html.includes('/src/main.js')
  } catch {
    return false
  }
}

function listen(port, attemptsLeft=20) {
  const onError = async (error) => {
    server.off('error', onError)
    if (error.code !== 'EADDRINUSE') {
      console.error(`\n服务启动失败: ${error.message}\n`)
      process.exitCode = 1
      return
    }

    const url = `http://127.0.0.1:${port}`
    if (await isCurrentAppRunning(port)) {
      console.log(`\n高级修智能排程已在运行: ${url}`)
      console.log('无需重复启动，已使用现有服务。\n')
      openBrowser(url)
      return
    }

    if (portArg || attemptsLeft <= 0) {
      console.error(`\n端口 ${port} 已被其他程序占用。请使用 node start.js --port=其他端口 启动。\n`)
      process.exitCode = 1
      return
    }

    const nextPort = port + 1
    console.warn(`端口 ${port} 已被其他程序占用，正在尝试 ${nextPort}...`)
    listen(nextPort, attemptsLeft - 1)
  }

  const onListening = (activePort) => {
    server.off('error', onError)
    const url = `http://127.0.0.1:${activePort}`
    console.log(`\n高级修智能排程第一版已启动: ${url}`)
    console.log('按 Ctrl+C 可停止服务。\n')
    openBrowser(url)
  }

  server.once('error', onError)
  server.listen(port, '127.0.0.1', () => onListening(port))
}

listen(PORT)
