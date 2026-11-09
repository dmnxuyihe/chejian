import { escapeHtml as esc } from '../core/ui.js'
import { icon } from '../shared/icons.js'
import { functionLinks, functionPath, presentationViews } from './catalog.js'
import { navigationGroups, navigationGroup, navigationId, navigationLabel, navigationEntries, navigationSearchText } from './navigation.js'
import { defaultFunctionEntry } from './routes.js'

const shellView={collapsed:false,entry:null,expandedGroup:null,scrollTop:0}
let releaseShell=()=>{}
const startPath=`#/${functionPath(defaultFunctionEntry)}`
const link=(entry,active=false,prefix='')=>`<a href="#/${functionPath(entry)}" class="function-item ${active?'active':''}" ${active?'aria-current="page"':''}>${prefix}${esc(navigationLabel(entry))}</a>`
const directGroup=group=>{const entries=navigationEntries(group);return entries.length===1&&navigationLabel(entries[0])===group.label}
function navigationMarkup(group,entry){
  const entries=navigationEntries(group)
  if(directGroup(group))return `<div class="function-nav-group function-nav-direct" data-nav-group="${group.id}">${link(entries[0],navigationId(entry)===entries[0].id,icon(group.icon,17))}</div>`
  return `<details class="function-nav-group" data-nav-group="${group.id}" ${shellView.expandedGroup===group.id?'open':''}><summary>${icon(group.icon,17)}<span>${group.label}</span>${icon('chevronRight',13)}</summary><div>${entries.map(item=>link(item,navigationId(entry)===item.id)).join('')}</div></details>`
}

export function renderFunctionShell({entry=null,pageHtml,catalog=false}){
  const activeGroup=navigationGroup(entry),key=entry?.id || 'catalog'
  if(shellView.entry!==key){shellView.entry=key;shellView.expandedGroup=activeGroup?.id || null;shellView.scrollTop=0}
  const collapsed=shellView.collapsed
  return `<div class="app-shell workspace-shell function-shell ${collapsed?'nav-collapsed':''} ${presentationViews[entry?.id]?'demo-shell demo-page-'+presentationViews[entry.id]:''}" data-function-shell data-function-entry="${esc(key)}">
    <a class="skip-content" href="#main-content" data-skip-content>跳到功能内容</a><button class="nav-scrim" data-nav-close aria-label="收起功能导航" tabindex="-1"></button>
    <aside class="sidebar" id="app-navigation" aria-label="功能导航"><a class="function-brand" href="${startPath}">${icon('train',25)}<strong>智能检修</strong></a><button class="btn btn-sm function-mobile-close" data-function-drawer-close aria-label="收起功能导航">${icon('close',16)}关闭导航</button>
      <nav class="nav" aria-label="业务功能">${navigationGroups.map(group=>navigationMarkup(group,entry)).join('')}</nav>
      <div class="function-sidebar-footer"><a href="#/functions/catalog" class="function-item ${catalog?'active':''}" ${catalog?'aria-current="page"':''}>${icon('menu',16)}全部功能</a></div>
    </aside>
    <div class="main-column"><header class="topbar"><button class="btn btn-sm function-nav-toggle" data-function-nav-toggle aria-controls="app-navigation" aria-expanded="${!collapsed}" aria-label="${collapsed?'展开功能导航':'收起功能导航'}">${icon('menu',17)}<span>导航</span></button><a class="function-compact-brand" href="${startPath}">智能检修</a><div class="topbar-actions"><button class="btn btn-icon btn-sm" data-theme-toggle title="切换明暗主题" aria-label="切换明暗主题">${icon('theme',17)}</button></div></header><main class="content" id="main-content" tabindex="-1" data-test="page-content">${functionLinks(pageHtml)}</main></div></div>`
}

// Explicit discovery page; the default route opens monthly planning instead.
export const functionHomePage={
  render(){
    const content=`<div class="function-directory" data-function-directory><header class="function-directory-head"><h1>全部功能</h1><label class="function-search">${icon('search',17)}<input type="search" class="input" placeholder="查找功能" aria-label="查找功能" data-function-search></label></header><div class="function-directory-groups">${navigationGroups.map(group=>{const entries=navigationEntries(group);return `<section class="function-group" data-group="${group.id}">${directGroup(group)?`<div data-function-label="${esc(navigationSearchText(entries[0]))}"><h2>${link(entries[0])}</h2></div>`:`<h2>${group.label}</h2><div class="function-link-grid">${entries.map(entry=>`<div data-function-label="${esc(navigationSearchText(entry))}">${link(entry)}</div>`).join('')}</div>`}</section>`}).join('')}</div><p class="empty" role="status" data-function-empty hidden>没有匹配的功能</p></div>`
    return renderFunctionShell({pageHtml:content,catalog:true})
  },
  mount(){
    const input=document.querySelector('[data-function-search]')
    input?.addEventListener('input',()=>{
      const term=input.value.trim().toLocaleLowerCase();let total=0
      document.querySelectorAll('.function-directory .function-group').forEach(group=>{
        let count=0
        group.querySelectorAll('[data-function-label]').forEach(item=>{
          item.hidden=!item.dataset.functionLabel.toLocaleLowerCase().includes(term)
          if(!item.hidden)count++
        })
        group.hidden=!count;total+=count
      })
      document.querySelector('[data-function-empty]').hidden=Boolean(total)
    })
  },
}

export function mountFunctionShell(){
  releaseShell()
  const shell=document.querySelector('[data-function-shell]')
  if(!shell){releaseShell=()=>{};return}
  const sidebar=shell.querySelector('.sidebar'),main=shell.querySelector('.main-column'),trigger=shell.querySelector('[data-function-nav-toggle]'),scrim=shell.querySelector('[data-nav-close]'),nav=shell.querySelector('.nav')
  const mobile=window.matchMedia('(max-width: 1000px)')
  const update=()=>{
    const expanded=mobile.matches?shell.classList.contains('nav-open'):!shellView.collapsed
    trigger.setAttribute('aria-expanded',String(expanded))
    trigger.setAttribute('aria-label',expanded?'收起功能导航':'展开功能导航')
    sidebar.inert=!expanded;sidebar.setAttribute('aria-hidden',String(!expanded))
    const modal=mobile.matches&&expanded
    main.inert=modal
    if(modal){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true')}
    else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal')}
  }
  const close=()=>{
    if(mobile.matches)shell.classList.remove('nav-open')
    else{shellView.collapsed=true;shell.classList.add('nav-collapsed')}
    update();trigger.focus({preventScroll:true})
  }
  trigger.addEventListener('click',()=>{
    if(mobile.matches)shell.classList.toggle('nav-open')
    else{shellView.collapsed=!shellView.collapsed;shell.classList.toggle('nav-collapsed',shellView.collapsed)}
    update()
    if(mobile.matches&&shell.classList.contains('nav-open')){
      const current=sidebar.querySelector('[aria-current="page"]')
      const target=current?.getClientRects().length?current:sidebar.querySelector('summary')
      target?.focus({preventScroll:true})
    }
  })
  scrim.addEventListener('click',close)
  shell.querySelector('[data-function-drawer-close]').addEventListener('click',close)
  sidebar.addEventListener('click',event=>{if(mobile.matches&&event.target.closest('a'))close()})
  nav.scrollTop=shellView.scrollTop
  nav.addEventListener('scroll',()=>{if(shell.isConnected)shellView.scrollTop=nav.scrollTop},{passive:true})
  const groups=[...shell.querySelectorAll('[data-nav-group]')].filter(group=>group.tagName!=='DIV')
  groups.forEach(group=>group.addEventListener('toggle',()=>{
    if(!shell.isConnected)return
    if(group.open){shellView.expandedGroup=group.dataset.navGroup;groups.forEach(other=>{if(other!==group)other.open=false})}
    else if(shellView.expandedGroup===group.dataset.navGroup)shellView.expandedGroup=null
  }))
  const resize=()=>{shell.classList.remove('nav-open');update();if(sidebar.contains(document.activeElement)&&sidebar.inert)trigger.focus({preventScroll:true})}
  const keyboard=event=>{
    if(event.key==='Escape'&&shell.classList.contains('nav-open')){event.preventDefault();close();return}
    if(event.key!=='Tab'||!mobile.matches||!shell.classList.contains('nav-open'))return
    const items=[...sidebar.querySelectorAll('a,button,summary')].filter(el=>el.getClientRects().length)
    const first=items[0],last=items.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
  mobile.addEventListener('change',resize)
  document.addEventListener('keydown',keyboard)
  releaseShell=()=>{mobile.removeEventListener('change',resize);document.removeEventListener('keydown',keyboard)}
  update()
}
