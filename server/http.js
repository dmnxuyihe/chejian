import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { toolAlerts } from '../src/core/tool-management.js'
import { projectRoot } from './config.js'
import { createPlanningService } from './planning.js'
import { createMonthlyPlanService } from './monthly-plans-v2.js'
import {createAuth} from './auth.js'
import { parseTemporaryRepairFile, temporaryRepairTemplateCsv, parseComponentTemporaryFile, componentTemporaryTemplateCsv, parseComponentMonthlyFile, componentMonthlyTemplateCsv } from './temporary-repair-import.js'

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
  const auth=database?createAuth(database):null
  const planning = database ? createPlanningService(database) : null
  const monthlyPlans = database ? createMonthlyPlanService(database) : null
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { storage: database ? 'postgresql' : 'local' })
        if (!database) return json(res, 503, { message: '当前为显式本地演示模式，未启用数据库' })
        if(url.pathname.startsWith('/api/auth/')){
          if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{message:'拒绝跨站写入'})
          if(url.pathname==='/api/auth/session'&&req.method==='GET')return json(res,200,await auth.status(req))
          if(url.pathname==='/api/auth/setup'&&req.method==='POST')return json(res,200,await auth.setup(req,res,await body(req)))
          if(url.pathname==='/api/auth/login'&&req.method==='POST')return json(res,200,await auth.login(req,res,await body(req)))
          if(url.pathname==='/api/auth/logout'&&req.method==='POST')return json(res,200,await auth.logout(req,res))
          return json(res,404,{message:'登录接口不存在'})
        }
        if(url.pathname==='/api/tools/commands'&&req.method==='POST'){
          if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{message:'拒绝跨站写入'})
          const user=await auth.requireUser(req),input=await body(req)
          return json(res,200,await database.toolCommand({...input,actor:user.name,actorUserId:user.id}))
        }
        if(url.pathname==='/api/tools/alerts'&&req.method==='GET'){
          const current=await database.read();return json(res,200,{alerts:toolAlerts(current.snapshot.data),revision:current.revision})
        }
        if(url.pathname==='/api/tools/device-events'&&req.method==='POST'){
          const token=process.env.TOOL_DEVICE_TOKEN,provided=req.headers['x-tool-device-token']
          if(!token||token.length<24)return json(res,503,{message:'设备网关尚未配置，真实设备接入未启用'})
          if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))return json(res,401,{message:'设备认证失败'})
          const event=await body(req)
          return json(res,200,await database.toolCommand({...event,type:'DEVICE_EVENT'},{hardware:true}))
        }
        if (url.pathname === '/api/pc1/records' && req.method === 'POST') {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message: '拒绝跨站写入' })
          return json(res, 200, await database.submitMaintenanceRecord(await body(req)))
        }
        if (url.pathname === '/api/temporary-repair/import/template.csv' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('整车临修计划导入模板.csv')}`, 'Cache-Control':'no-store' })
          return res.end(temporaryRepairTemplateCsv)
        }
        if (url.pathname === '/api/temporary-repair/import/preview' && req.method === 'POST') {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message:'拒绝跨站写入' })
          return json(res, 200, { rows:parseTemporaryRepairFile(await body(req)) })
        }
        if (url.pathname === '/api/component-temporary/import/template.csv' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('配件临修计划导入模板.csv')}`, 'Cache-Control':'no-store' });return res.end(componentTemporaryTemplateCsv)
        }
        if (url.pathname === '/api/component-temporary/import/preview' && req.method === 'POST') {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res,403,{message:'拒绝跨站写入'})
          return json(res,200,{rows:parseComponentTemporaryFile(await body(req))})
        }
        if(url.pathname==='/api/component-monthly/import/template.csv'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('配件月计划导入模板.csv')}`,'Cache-Control':'no-store'});return res.end(componentMonthlyTemplateCsv)}
        if(url.pathname==='/api/component-monthly/import/preview'&&req.method==='POST'){if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{message:'拒绝跨站写入'});return json(res,200,{rows:parseComponentMonthlyFile(await body(req))})}
        if (url.pathname === '/api/pc1/records' && req.method === 'GET') {
          const result = await database.read(), id = url.searchParams.get('vehicleRepairId')
          return json(res, 200, { records: result.snapshot.data.maintenanceRecords.filter(row => !id || row.vehicleRepairId === Number(id)), revision: result.revision })
        }
        if (url.pathname.startsWith('/api/monthly-plans/')) {
          if (['POST','PATCH','DELETE'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res,403,{message:'拒绝跨站写入'})
          const role = req.headers['x-pc1-simulated-role'] || 'PLANNER'
          const year = url.searchParams.get('year'), month = url.searchParams.get('month')
          if (url.pathname === '/api/monthly-plans/todos' && req.method === 'GET') return json(res,200,await monthlyPlans.todos({role}))
          if (url.pathname === '/api/monthly-plans/logs' && req.method === 'GET') return json(res,200,await monthlyPlans.logs({year,month,role,page:url.searchParams.get('page'),pageSize:url.searchParams.get('pageSize'),actionType:url.searchParams.get('actionType')}))
          const monthlyLog=url.pathname.match(/^\/api\/monthly-plans\/logs\/(\d+)$/)
          if(monthlyLog&&req.method==='GET')return json(res,200,await monthlyPlans.logs({year,month,role,logId:monthlyLog[1]}))
          if (url.pathname === '/api/monthly-plans/month' && req.method === 'GET') return json(res,200,await monthlyPlans.read({year,month,role}))
          if (url.pathname === '/api/monthly-plans/title' && req.method === 'PATCH') return json(res,200,await monthlyPlans.setTitle({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/submit' && req.method === 'POST') return json(res,200,await monthlyPlans.submit({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/items' && req.method === 'POST') return json(res,200,await monthlyPlans.createDraftItem({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/request-publish' && req.method === 'POST') return json(res,200,await monthlyPlans.requestPublish({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/direct-publish' && req.method === 'POST') return json(res,200,await monthlyPlans.directPublish({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/withdraw' && req.method === 'POST') return json(res,200,await monthlyPlans.withdraw({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/takeover' && req.method === 'POST') return json(res,200,await monthlyPlans.takeover({...await body(req),role}))
          if (url.pathname === '/api/monthly-plans/decision' && req.method === 'POST') return json(res,200,await monthlyPlans.decide({...await body(req),role}))
          const monthlyDeletion=url.pathname.match(/^\/api\/monthly-plans\/deletions\/(\d+)$/)
          if(monthlyDeletion&&req.method==='PATCH')return json(res,200,await monthlyPlans.updateDeletion({...await body(req),deletionId:monthlyDeletion[1],role}))
          const monthlyItem=url.pathname.match(/^\/api\/monthly-plans\/items\/(\d+)$/)
          if(monthlyItem&&req.method==='PATCH')return json(res,200,await monthlyPlans.updateItem({...await body(req),vehicleRepairId:monthlyItem[1],role}))
          if(monthlyItem&&req.method==='DELETE')return json(res,200,await monthlyPlans.deleteItem({...await body(req),vehicleRepairId:monthlyItem[1],role}))
          return json(res,404,{message:'月度计划接口不存在'})
        }
        const media = url.pathname.match(/^\/api\/pc1\/attachments\/([a-f0-9-]{36})$/)
        if (media && ['GET','HEAD'].includes(req.method)) {
          const file = await database.readMaintenanceMedia(media[1])
          if (!file) return json(res, 404, { message: '附件不存在，可能尚未在当前数据库导入' })
          const length = file.content.length, headers = { 'Content-Type': file.mime_type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}` }
          let start = 0, end = length - 1, status = 200
          if (req.headers.range) {
            const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
            if (!range || (!range[1] && !range[2])) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${length}` }); return res.end() }
            if (!range[1]) start = Math.max(0, length - Number(range[2]))
            else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])) }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${length}` }); return res.end() }
            status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${length}`
          }
          res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 })
          return res.end(req.method === 'HEAD' ? undefined : file.content.subarray(start, end + 1))
        }
        if (url.pathname.startsWith('/api/planning/')) {
          if (['POST', 'DELETE'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message: '拒绝跨站写入' })
          const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('pc1_import_session='))
          let sessionId = cookie?.slice('pc1_import_session='.length)
          if (!sessionId || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
            sessionId = randomUUID()
            res.setHeader('Set-Cookie', `pc1_import_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${req.socket.encrypted ? '; Secure' : ''}`)
          }
          if (url.pathname === '/api/planning/lookups' && req.method === 'GET') return json(res, 200, await planning.lookups())
          if (url.pathname === '/api/planning/annual' && req.method === 'GET') {
            const year = Number(url.searchParams.get('year'))
            if (!Number.isInteger(year) || year < 1900 || year > 2199) return json(res, 400, { message: '请选择有效年度' })
            for (const key of ['modelId', 'programId']) if (url.searchParams.get(key) && !/^\d+$/.test(url.searchParams.get(key))) return json(res, 400, { message: '筛选条件无效' })
            const depot = (url.searchParams.get('depot') || '').slice(0, 64)
            return json(res, 200, await planning.annual({ year, depot, modelId: url.searchParams.get('modelId'), programId: url.searchParams.get('programId') }))
          }
          if (url.pathname === '/api/planning/plans' && req.method === 'GET') {
            const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || ''
            if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return json(res, 400, { message: '计划日期范围无效' })
            for (const key of ['modelId', 'programId', 'repairSequence']) if (url.searchParams.get(key) && !/^\d+$/.test(url.searchParams.get(key))) return json(res, 400, { message: '筛选条件无效' })
            const planSource = url.searchParams.get('planSource') || ''
            if (planSource && !['ANNUAL', 'MONTHLY', 'NON_ANNUAL'].includes(planSource)) return json(res, 400, { message: '计划来源筛选无效' })
            const status=url.searchParams.get('status')||'',approvalStatus=url.searchParams.get('approvalStatus')||''
            if(status&&!['UNSCHEDULED','SCHEDULED','IN_PROGRESS','COMPLETED'].includes(status))return json(res,400,{message:'排程状态筛选无效'})
            if(approvalStatus&&!['DRAFT','SUBMITTED','REVIEWED','PENDING_PUBLISH','PUBLISHED','REJECTED','REVISING'].includes(approvalStatus))return json(res,400,{message:'审批状态筛选无效'})
            const result = await planning.plans({ from, to, modelId: url.searchParams.get('modelId'), programId: url.searchParams.get('programId'), locomotiveNo: (url.searchParams.get('locomotiveNo') || '').slice(0, 64), ownerDepot:(url.searchParams.get('ownerDepot')||'').slice(0,64), repairSequence:url.searchParams.get('repairSequence'), status, approvalStatus, planSource })
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
            return json(res, 200, await planning.preview({ ...input, sessionId, role:req.headers['x-pc1-simulated-role'] || 'PLANNER' }))
          }
          const errors = url.pathname.match(/^\/api\/planning\/import\/([^/]+)\/errors\.csv$/)
          if (errors && req.method === 'GET') {
            const csv = planning.errorsCsv(decodeURIComponent(errors[1]), sessionId)
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('检修计划导入错误明细.csv')}`, 'Cache-Control': 'no-store' })
            return res.end(csv)
          }
          if (url.pathname === '/api/planning/import/confirm' && req.method === 'POST') {
            const input = await body(req)
            const result = await planning.confirm(sessionId, String(input.previewId || ''), input)
            return json(res, result.changed ? 409 : 200, result)
          }
          const previewAppend = url.pathname.match(/^\/api\/planning\/import\/preview\/([^/]+)\/rows$/)
          if (previewAppend && req.method === 'POST') {
            const input = await body(req)
            return json(res, 200, await planning.appendPreviewRows(sessionId, decodeURIComponent(previewAppend[1]), input))
          }
          const previewRow = url.pathname.match(/^\/api\/planning\/import\/preview\/([^/]+)\/rows\/(\d+)$/)
          if (previewRow && req.method === 'PATCH') {
            const input=await body(req)
            return json(res,200,await planning.updatePreviewRow(sessionId,decodeURIComponent(previewRow[1]),Number(previewRow[2]),input.values))
          }
          if (previewRow && req.method === 'DELETE') return json(res,200,await planning.deletePreviewRow(sessionId,decodeURIComponent(previewRow[1]),Number(previewRow[2])))
          const preview = url.pathname.match(/^\/api\/planning\/import\/preview\/([^/]+)$/)
          if (preview && req.method === 'DELETE') return json(res, 200, await planning.cancel(sessionId, decodeURIComponent(preview[1])))
          return json(res, 404, { message: '计划管理接口不存在' })
        }
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, ...await database.health() })
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await database.read())
        if (url.pathname === '/api/state' && req.method === 'PUT') {
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { message: '拒绝跨站写入' })
          await auth.requireUser(req)
          const value = await body(req)
          if (!value || typeof value !== 'object' || !value.snapshot) return json(res, 400, { message: '请求缺少排程数据' })
          return json(res, 200, await database.save(value.revision, value.snapshot,{protectTools:true}))
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
      if (!['/index.html','/demo.html'].includes(publicPath) && !publicPath.startsWith('/src/') && !publicPath.startsWith('/vendor/')) return json(res, 404, { message: '文件不存在' })
      const file = path.join(projectRoot, publicPath)
      let content
      try { content = await fs.readFile(file) } catch { return json(res, 404, { message: '文件不存在' }) }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : content)
    } catch (error) {
      const isConstraintError = !error.status && /^23/.test(String(error.code || ''))
const status = error.status || (isConstraintError ? 400 : 503)
      const message = error.status ? error.message : isConstraintError ? '保存失败：原有正式数据未改变。若您正在修改已发布车辆，请检查修改后的必填信息、是否与本月其他车辆重复，或该车辆是否已有待审核变更。' : 'PostgreSQL暂不可用，数据未保存；请重试或联系服务端'
      if (!error.status) console.error('请求失败:', error.code || error.name)
      if (!res.headersSent) json(res, status, { message, ...(error.toolTargetChanged?{toolTargetChanged:true,invalidToolObjects:error.invalidToolObjects}:{}), ...(Number.isSafeInteger(error.toolAssetId)&&Number.isSafeInteger(error.availableQuantity)?{toolAssetId:error.toolAssetId,availableQuantity:error.availableQuantity}:{}) })
      else res.end()
    }
  }
}
