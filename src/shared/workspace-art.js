// Repo-native drawings share theme colors; all business labels remain HTML text.
import { icon } from './icons.js'

const scenes = {
  plan: '<rect class="art-panel" x="22" y="14" width="72" height="66" rx="7"/><path d="M22 33h72M40 8v13m36-13v13"/><path class="art-grid" d="M39 42h5m13 0h5m13 0h5M39 55h5m13 0h5m13 0h5M39 68h5m13 0h5"/><rect class="art-accent" x="70" y="49" width="15" height="13" rx="3"/><path class="art-faint" d="M105 29h19m-19 12h29m-29 12h14"/><circle class="art-panel" cx="121" cy="72" r="15"/><path class="art-highlight" d="m114 72 5 5 9-11"/>',
  schedule: '<path class="art-faint" d="M29 16v64M63 16v64M97 16v64M131 16v64M17 29h126m-126 22h126m-126 22h126"/><rect class="art-accent" x="29" y="22" width="49" height="13" rx="4"/><rect class="art-panel" x="65" y="44" width="58" height="13" rx="4"/><rect class="art-accent" x="97" y="66" width="38" height="13" rx="4"/><path d="m78 29 9 0 0 21h10"/>',
  vehicle: '<path class="art-faint" d="M10 79h140m-129 7h113"/><path class="art-panel" d="M23 62V29a7 7 0 0 1 7-7h85l18 18v22z"/><path d="M23 47h110M102 22v25M109 28h5l12 13h-17zM34 32h13v9H34zm24 0h13v9H58z"/><path class="art-highlight" d="M31 54h42m7 0h12"/><circle class="art-panel" cx="43" cy="66" r="10"/><circle class="art-panel" cx="111" cy="66" r="10"/><circle cx="43" cy="66" r="3"/><circle cx="111" cy="66" r="3"/>',
  workshop: '<path class="art-faint" d="M10 81h140"/><path class="art-panel" d="M20 78V39l27-16v16l28-16v16l28-16v16h30v39z"/><path d="M105 39V14h13v25M33 51h12v10H33zm26 0h12v10H59zm26 0h12v10H85z"/><path class="art-highlight" d="M109 78V56h13v22M20 70h78"/>',
  resource: '<path class="art-panel" d="m29 30 34-18 34 18v39L63 87 29 69z"/><path d="m29 30 34 18 34-18M63 48v39M46 21l34 18v15"/><circle class="art-panel" cx="119" cy="64" r="18"/><path class="art-highlight" d="m111 64 6 6 11-13"/>',
  quality: '<path class="art-panel" d="M43 17H28v68h74V17H87"/><rect class="art-panel" x="43" y="10" width="44" height="15" rx="4"/><path class="art-faint" d="M43 42h29M43 55h20m-20 13h17"/><circle class="art-panel" cx="105" cy="59" r="23"/><path class="art-highlight" d="m94 59 8 8 15-18"/>',
  people: '<circle class="art-panel" cx="79" cy="29" r="14"/><circle cx="39" cy="38" r="11"/><circle cx="121" cy="38" r="11"/><path class="art-accent" d="M54 81V68a25 25 0 0 1 50 0v13z"/><path d="M18 79V66a21 21 0 0 1 28-20m96 33V66a21 21 0 0 0-28-20"/><path class="art-highlight" d="M69 61h20M79 51v20"/>',
  tool: '<path class="art-panel" d="M107 16a26 26 0 0 0-35 34L32 72a10 10 0 0 0 13 15l39-28a26 26 0 0 0 33-33L98 43 83 28z"/><circle cx="39" cy="79" r="3"/><path class="art-faint" d="M25 22h27m-27 9h17m78 36h14m-14 10h22"/>',
  equipment: '<path class="art-faint" d="M13 84h137"/><path d="M25 82V17h110v65M34 27h92M76 27v17m0 12v9"/><path class="art-panel" d="M57 69h42v13H57z"/><path class="art-highlight" d="M76 44h9v8a9 9 0 0 1-18 0M35 42h13v14H35m-10 12h14m82-27v25"/><path d="M118 14h20M22 14h20"/>',
  monitor: '<rect class="art-panel" x="20" y="13" width="120" height="64" rx="6"/><path d="M65 77v11m30-11v11M54 88h52"/><path class="art-faint" d="M34 60h92M34 27v33"/><path class="art-highlight" d="m35 52 17-10 16 7 18-22 17 12 21-16"/><circle class="art-accent" cx="86" cy="27" r="4"/>',
  process: '<path class="art-faint" d="M41 28h36v39h38M41 67h36V28h38"/><rect class="art-panel" x="15" y="16" width="32" height="24" rx="5"/><rect class="art-accent" x="61" y="55" width="32" height="24" rx="5"/><rect class="art-panel" x="112" y="16" width="32" height="24" rx="5"/><path class="art-highlight" d="m119 28 5 5 11-11M25 28h11M71 67h12"/>',
  safety: '<path class="art-panel" d="m80 10 40 15v25c0 16-18 29-40 40-22-11-40-24-40-40V25z"/><path class="art-highlight" d="m61 49 13 13 28-30"/><path class="art-faint" d="M19 30h10m-14 15h14m102-15h10m-10 15h14"/>',
  service: '<path d="M39 52v-9a41 31 0 0 1 82 0v9"/><rect class="art-panel" x="29" y="43" width="21" height="29" rx="8"/><rect class="art-panel" x="110" y="43" width="21" height="29" rx="8"/><path class="art-highlight" d="M120 72a21 13 0 0 1-21 13H84"/><rect class="art-accent" x="70" y="80" width="18" height="10" rx="5"/><path class="art-faint" d="M62 39h36M62 51h25"/>',
  admin: '<rect class="art-panel" x="25" y="15" width="110" height="68" rx="7"/><circle cx="54" cy="36" r="9"/><path d="M39 64v-5a15 12 0 0 1 30 0v5M86 31h34M86 47h34M86 63h34"/><circle class="art-accent" cx="105" cy="31" r="5"/><circle class="art-accent" cx="95" cy="47" r="5"/><circle class="art-accent" cx="112" cy="63" r="5"/>',
  record: '<path class="art-faint" d="M43 18V9h71l18 18v52h-12"/><path class="art-panel" d="M26 21h72l16 16v50H26z"/><path d="M98 21v16h16"/><rect x="39" y="37" width="31" height="25" rx="3"/><circle class="art-highlight" cx="61" cy="44" r="3"/><path class="art-highlight" d="m39 57 10-9 10 8 6-4 5 5"/><path d="M80 49h18M80 60h18M39 73h59"/>',
}

export function workspaceArt(kind='vehicle', className='') {
  return `<svg class="workspace-art ${className}" data-art-kind="${scenes[kind] ? kind : 'vehicle'}" width="160" height="96" viewBox="0 0 160 96" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${scenes[kind] || scenes.vehicle}</svg>`
}

export function artKind(title) {
  return /权限|账号|认证|用户/.test(title) ? 'admin' : /售后|回访|质保|服务/.test(title) ? 'service' : /安全|危险|禁烟|登高|动火|安全帽/.test(title) ? 'safety' : /监控|驾驶|统计|成本|停时|预警|画像/.test(title) ? 'monitor' : /图片|视频|记录|履历|数据回填|上传/.test(title) ? 'record' : /工具|工量具/.test(title) ? 'tool' : /物料|库存|仓库|库房|仓储|领料|供商|货位|物资/.test(title) ? 'resource' : /人员|班组|组织|员工/.test(title) ? 'people' : /设备|天车/.test(title) ? 'equipment' : /工艺|工序|网络图|技术|修程配置/.test(title) ? 'process' : /质量|专检|验收|审批|审核|合格证/.test(title) ? 'quality' : /排程|编排|下发|派工|调度/.test(title) ? 'schedule' : /计划|日历/.test(title) ? 'plan' : /配件|零部件|备件|资源/.test(title) ? 'resource' : /车间|产线|工位/.test(title) ? 'workshop' : 'vehicle'
}

export function headerArt(title) { return `<span class="page-art-mark">${workspaceArt(artKind(title))}</span>` }
const artIcons = {plan:'calendar',schedule:'schedule',vehicle:'train',workshop:'warehouse',resource:'package',quality:'inspection',people:'team',tool:'wrench',equipment:'equipment',monitor:'chart',process:'settings',safety:'shield',service:'support',admin:'settings',record:'file'}
export const contextIcon = (title,size=18) => {
  const glyph = /不通过|待检|失败/.test(title) ? 'inspection' : /已完成|通过|合格/.test(title) ? 'check' : /任务|FS关系|滞后/.test(title) ? 'schedule' : /修程/.test(title) && !/计划|查询/.test(title) ? 'settings' : artIcons[artKind(title)]
  return icon(glyph,size)
}

export function completionRing(completed,total) {
  const percent = total > 0 ? Math.min(100,Math.max(0,Math.round(completed/total*100))) : 0
  return `<svg class="completion-ring" width="66" height="66" viewBox="0 0 66 66" aria-hidden="true" focusable="false"><circle class="completion-ring-track" cx="33" cy="33" r="26"/><circle class="completion-ring-value" cx="33" cy="33" r="26" pathLength="100" stroke-dasharray="${percent} 100" opacity="${percent ? 1 : 0}" transform="rotate(-90 33 33)"/><text x="33" y="37" text-anchor="middle">${percent}%</text></svg>`
}

export function workshopOverview() {
  return `<div class="entry-overview" aria-hidden="true"><svg class="entry-workshop-art" width="400" height="170" viewBox="0 0 400 170" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">
    <path class="art-faint" d="M24 138h352M42 148h316M57 25v105m287-105v105M57 29h287M69 39h263M146 29v31m108-31v31"/>
    <path class="art-panel" d="M85 109V75a8 8 0 0 1 8-8h195l27 28v14z"/><path d="M85 94h230M265 67v27M273 75h12l17 16h-30zM99 76h19v11H99zm31 0h19v11h-19zm31 0h19v11h-19zm31 0h19v11h-19z"/>
    <path class="art-highlight" d="M96 101h104m13 0h34"/><path class="art-panel" d="M104 109h57v14h-57zm134 0h57v14h-57z"/>
    <g class="art-highlight"><circle cx="116" cy="124" r="9"/><circle cx="148" cy="124" r="9"/><circle cx="250" cy="124" r="9"/><circle cx="282" cy="124" r="9"/></g>
    <path class="art-faint" d="M40 157h33m14 0h33m14 0h33m14 0h33m14 0h33m14 0h33m14 0h33"/>
    <path d="M146 60v-9h22m86 9v-9h-22"/><circle class="art-accent" cx="206" cy="29" r="5"/>
  </svg><div class="entry-art-caption"><span>计划</span><i></i><span>调度</span><i></i><span>检修</span><i></i><span>追溯</span></div></div>`
}

const roleIcons = {planning:'calendar',scheduling:'schedule',foreman:'team',worker:'worker',approval:'file',inspector:'inspection',acceptance:'shield','delivery-foreman':'train','quality-management':'shield',technical:'wrench','component-management':'package','material-warehouse':'warehouse','tool-management':'wrench','equipment-management':'equipment','safety-management':'shield','after-sales':'support','workshop-management':'chart','system-admin':'settings'}
export const roleIcon = id => icon(roleIcons[id] || 'file',25)
