import http from 'node:http'
import { spawn } from 'node:child_process'
import { loadConfig } from './server/config.js'
import { createDatabase } from './server/database.js'
import { createHandler } from './server/http.js'

const config = loadConfig()
const portArg = process.argv.find((v) => v.startsWith('--port='))
const PORT = Number(portArg?.split('=')[1] || process.env.PORT || 5173)
const noOpen = process.argv.includes('--no-open') || process.env.NO_OPEN === '1'
const host = process.argv.find(v => v.startsWith('--host='))?.split('=')[1] || process.env.HOST || '127.0.0.1'
const localDemo = process.argv.includes('--local-demo')
const database = localDemo ? null : createDatabase(config)
if (database) {
  try { await database.init(); console.log(`PostgreSQL已连接，数据区：${config.schema}`) }
  catch (error) { console.error('PostgreSQL初始化失败：', error.code || error.name, '请检查.env配置与数据库服务。'); await database.close(); process.exit(1) }
}
const server = http.createServer(createHandler(database))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(async () => { await database?.close(); process.exit(0) }) })

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
    const configResponse = await fetch(`http://127.0.0.1:${port}/api/config`)
    const remote = await configResponse.json()
    return response.ok && html.includes('/src/main.js') && remote.storage === (database ? 'postgresql' : 'local')
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
      await database?.close()
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
  server.listen(port, host, () => onListening(port))
}

listen(PORT)
