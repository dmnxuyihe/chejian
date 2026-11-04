import { escapeHtml as esc, openModal, toast } from '../core/ui.js'
import { fmtFullDateTime, taskStatusLabel } from '../core/derived.js'


const rowsFor = (state, vehicleId) => {
  const vehicle = state.vehicleRepairs.find(row => row.id === Number(vehicleId))
  return state.schedules.filter(row => row.vehicleRepairId === vehicle?.id && row.versionId === vehicle.currentVersionId && row.status !== 'CANCELLED')
    .sort((a,b) => new Date(a.plannedStartAt) - new Date(b.plannedStartAt) || a.id - b.id)
}

export function renderMaintenanceRecords(state, vehicleId, { presentation=false } = {}) {
  const rows = rowsFor(state, vehicleId), records = state.maintenanceRecords || []
  if(presentation) {
    return `<section class="card pc1-records demo-task-panel" data-pc1-records>
      <div class="demo-task-count">已完成 ${rows.filter(row=>row.status==='COMPLETED').length} / ${rows.length} 项</div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="检修任务明细，可横向滚动"><table class="demo-task-table"><thead><tr><th>检修工序</th><th>作业工位</th><th>状态</th><th>计划时间</th><th>实际时间</th><th>检修记录</th></tr></thead><tbody>${rows.map(row=>{
        const task=state.tasks.find(task=>task.id===row.taskId),station=state.workstations.find(station=>station.id===row.workstationId)
        const status=row.status==='COMPLETED'?'done':row.status==='IN_PROGRESS'?'running':'pending'
        const range=(start,end)=>start?`<span class="demo-time-range"><span>${fmtFullDateTime(start)}</span><span>${fmtFullDateTime(end)}</span></span>`:'—'
        return `<tr data-demo-record-row><td><strong>${esc(task?.name||'检修工序')}</strong></td><td><span class="demo-station-name">${esc(station?.name||'未分配')}</span></td><td><span class="demo-state demo-state-${status}">${esc(taskStatusLabel(row.status))}</span></td><td>${range(row.plannedStartAt,row.plannedEndAt)}</td><td>${range(row.actualStartAt,row.actualEndAt)}</td><td>${row.status==='COMPLETED'?`<button type="button" class="btn btn-sm" data-pc1-record-task="${row.id}">查看记录</button>`:'—'}</td></tr>`
      }).join('')||'<tr><td colspan="6" class="empty">本车尚无正式检修任务，请先确认排程。</td></tr>'}</tbody></table></div>
    </section>`
  }
  return `<section class="card pc1-records" data-pc1-records><div class="card-title-row"><div><h2>整车检修管控</h2><p class="pc-help">查看各任务执行状态；已完成任务可查看提交的数据、图片和视频。</p></div><span>${rows.filter(row => row.status === 'COMPLETED').length} / ${rows.length} 项已完成</span></div><div class="table-wrap"><table><thead><tr><th>工序</th><th>工位</th><th>状态</th><th>计划时间</th><th>实际时间</th><th>提交记录</th></tr></thead><tbody>${rows.map(row => {
    const task = state.tasks.find(task => task.id === row.taskId), submitted = records.filter(record => record.scheduleTaskId === row.id)
    return `<tr><td>${esc(task?.name || '检修工序')}</td><td>${esc(state.workstations.find(station => station.id === row.workstationId)?.name || '未分配')}</td><td><span class="badge ${row.status === 'COMPLETED' ? 'badge-green' : row.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-slate'}">${esc(taskStatusLabel(row.status))}</span></td><td>${fmtFullDateTime(row.plannedStartAt)}<br>${fmtFullDateTime(row.plannedEndAt)}</td><td>${fmtFullDateTime(row.actualStartAt)}<br>${fmtFullDateTime(row.actualEndAt)}</td><td>${row.status === 'COMPLETED' ? `<button type="button" class="btn btn-sm" data-pc1-record-task="${row.id}">查看记录 · ${submitted.length}</button>` : '完成后可查看提交记录'}</td></tr>`
  }).join('') || '<tr><td colspan="6" class="empty">本车尚无正式检修任务，请先确认排程。</td></tr>'}</tbody></table></div></section>`
}

function recordBody(record) {
  const attachments = record.attachments.filter(file => /^\/api\/pc1\/attachments\/[a-f0-9-]{36}$/.test(file.url))
  return `<article class="pc1-submitted-record"><div class="card-title-row"><strong>${esc(record.submittedBy)}</strong><span>${fmtFullDateTime(record.submittedAt)}</span></div><p class="pc1-record-notes">${esc(record.notes || '未填写作业说明')}</p>${record.measurements.length ? `<div class="table-wrap"><table><thead><tr><th>检测项目</th><th>提交数值</th><th>单位</th></tr></thead><tbody>${record.measurements.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.value)}</td><td>${esc(item.unit || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}<div class="pc1-attachments">${attachments.map(file => `<figure>${file.mimeType.startsWith('image/') ? `<a href="${esc(file.url)}" target="_blank" rel="noreferrer"><img src="${esc(file.url)}" alt="${esc(file.name)}" loading="lazy"></a>` : `<video controls preload="metadata" src="${esc(file.url)}" aria-label="${esc(file.name)}">当前浏览器无法播放此视频，请下载查看。</video>`}<figcaption><a href="${esc(file.url)}" target="_blank" rel="noreferrer">${esc(file.name)}</a> · ${(file.bytes / 1024).toFixed(1)} KB</figcaption></figure>`).join('')}</div></article>`
}

const fileData = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve({ name: file.name, mimeType: file.type, contentBase64: String(reader.result).split(',')[1] })
  reader.onerror = () => reject(new Error(`无法读取${file.name}`))
  reader.readAsDataURL(file)
})

function submitRecord(ctx, task) {
  const measurementRow = () => '<tr><td><input class="input" data-measure-name maxlength="120" placeholder="例如：检测温度"></td><td><input class="input" data-measure-value maxlength="250" placeholder="提交值"></td><td><input class="input" data-measure-unit maxlength="30" placeholder="单位"></td></tr>'
  const modal = openModal({ title: '补充已完成任务的检修记录', wide: true, confirmText: '提交记录', body: `<p>${esc(ctx.state.tasks.find(row => row.id === task.taskId)?.name)}</p><div class="field"><label for="pc1-record-person">提交人</label><input id="pc1-record-person" class="input" maxlength="80" value="${esc(ctx.state.employees.find(row => row.id === ctx.state.selectedWorkerId)?.name || '')}"></div><div class="field"><label for="pc1-record-notes">作业说明</label><textarea id="pc1-record-notes" class="input" maxlength="5000" rows="3"></textarea></div><div class="table-wrap"><table><thead><tr><th>检测项目</th><th>数值</th><th>单位</th></tr></thead><tbody data-measure-rows>${measurementRow()}</tbody></table></div><button type="button" class="btn btn-sm" data-add-measure>添加检测项目</button><div class="field"><label for="pc1-record-files">图片、视频（最多12个，总计8MB）</label><input id="pc1-record-files" type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"></div><p class="pc-error-text" role="alert" data-record-error></p>`, async onConfirm(wrap) {
    const fail = message => { wrap.querySelector('[data-record-error]').textContent = message; return false }
    const files = [...wrap.querySelector('#pc1-record-files').files]
    if (files.length > 12 || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) return fail('最多12个附件，总大小不超过8MB')
    const measurements = [...wrap.querySelectorAll('[data-measure-rows] tr')].map(row => ({ name: row.querySelector('[data-measure-name]').value.trim(), value: row.querySelector('[data-measure-value]').value.trim(), unit: row.querySelector('[data-measure-unit]').value.trim() })).filter(row => row.name || row.value || row.unit)
    const submittedBy = wrap.querySelector('#pc1-record-person').value.trim(), notes = wrap.querySelector('#pc1-record-notes').value.trim()
    if (!submittedBy) return fail('请填写提交人')
    if (measurements.some(row => !row.name || row.value === '')) return fail('检测项目和数值必须同时填写')
    if (!notes && !measurements.length && !files.length) return fail('请至少填写作业说明、检测数据或选择附件')
    try {
      const saved = await ctx.demoPersistence.save()
      if (!saved.ok) return fail(saved.message)
      const response = await fetch('/api/pc1/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), scheduleTaskId: task.id, submittedBy, notes, measurements, attachments: await Promise.all(files.map(fileData)) }) })
      const result = await response.json()
      if (!response.ok) return fail(result.message)
      const loaded = await ctx.demoPersistence.load()
      if (!loaded.ok) return fail(loaded.message)
      ctx.rerender(false); toast('记录已提交', '检测数据和附件已保存在PostgreSQL中')
    } catch (error) { return fail(error.message) }
  } })
  modal.querySelector('[data-add-measure]').addEventListener('click', () => {
    if (modal.querySelectorAll('[data-measure-rows] tr').length < 100) modal.querySelector('[data-measure-rows]').insertAdjacentHTML('beforeend', measurementRow())
  })
}

export function mountMaintenanceRecords(ctx) {
  document.querySelectorAll('[data-pc1-record-task]').forEach(button => button.addEventListener('click', () => {
    const row = ctx.state.schedules.find(row => row.id === Number(button.dataset.pc1RecordTask))
    if (!row || row.status !== 'COMPLETED') return
    const records = (ctx.state.maintenanceRecords || []).filter(record => record.scheduleTaskId === row.id).sort((a,b) => b.id - a.id)
    const quality = ctx.state.qualityRecords.find(record => record.scheduleTaskId === row.id)
    const modal = openModal({ title: `${ctx.state.tasks.find(task => task.id === row.taskId)?.name || '任务'} · 检修记录`, wide: true, confirmText: '关闭', body: `<p>作业完成：${fmtFullDateTime(row.actualEndAt)} · 质检：${esc(({ PENDING: '待检', PASS: '通过', FAILED: '未通过' })[quality?.status] || '暂无')}</p>${records.map(recordBody).join('') || '<div class="empty"><strong>任务已完成，尚未提交检测数据或附件</strong><span>工位提交后可在这里查看。</span></div>'}${ctx.demo?'':'<button type="button" class="btn" data-add-record>补充检修记录</button>'}` })
    modal.querySelector('[data-add-record]')?.addEventListener('click', () => { modal.remove(); submitRecord(ctx, row) })
  }))
}
