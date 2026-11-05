import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { functionEntries, functionPath } from '../src/functions/catalog.js'
import { navigationGroups, navigationEntries, navigationGroup, navigationId, navigationSearchText } from '../src/functions/navigation.js'
import { resolveFunctionRoute, defaultFunctionEntry } from '../src/functions/routes.js'
import { renderFunctionShell, functionHomePage, mountFunctionShell } from '../src/functions/index.js'

for(const hash of ['', '#/', '#/select', '#/functions', '#/functions/', '#/unknown'])assert.equal(resolveFunctionRoute(hash).entry,defaultFunctionEntry)
assert.equal(resolveFunctionRoute('#/functions/catalog').type,'catalog')
assert.equal(resolveFunctionRoute('#/demo/calendar').type,'demo')
for(const entry of functionEntries){
  assert.equal(resolveFunctionRoute('#/'+functionPath(entry)).entry,entry)
  assert.equal(resolveFunctionRoute('#/'+entry.source).entry,entry)
}
assert.equal(resolveFunctionRoute('#/planning/calendar').entry,defaultFunctionEntry)
const ready=functionEntries.filter(entry=>entry.status==='implemented')
const canonical=navigationGroups.flatMap(navigationEntries)
assert.equal(navigationGroups.length,5)
assert.equal(canonical.length,19)
assert.equal(new Set(canonical.map(entry=>entry.id)).size,canonical.length)
for(const entry of ready)assert.ok(canonical.some(item=>item.id===navigationId(entry)),entry.id)
assert.match(navigationSearchText(canonical.find(entry=>entry.id==='tool-register')),/工具/)

for(const entry of functionEntries){
  const html=renderFunctionShell({entry,pageHtml:'<h1>业务内容</h1>'})
  assert.ok(html.includes(`data-function-entry="${entry.id}"`))
  assert.equal((html.match(/data-nav-group=/g)||[]).length,5)
  assert.equal((html.match(/class="function-item /g)||[]).length,canonical.length+1)
  assert.equal((html.match(/data-nav-group="[^"]+" open/g)||[]).length,navigationGroup(entry)?1:0)
  assert.doesNotMatch(html,/workspace-nav|workspace-location|function-primary-card|data-role-card|data-switch-role/)
  if(navigationGroup(entry))assert.ok(html.includes(`href="#/${functionPath(canonical.find(item=>item.id===navigationId(entry)))}" class="function-item active"`))
  for(const planned of functionEntries.filter(item=>item.status!=='implemented'))assert.ok(!html.includes(`href="#/${functionPath(planned)}"`))
}
const catalog=functionHomePage.render()
assert.equal((catalog.match(/data-function-label=/g)||[]).length,canonical.length)
assert.doesNotMatch(catalog,/function-pending|function-primary-card|data-function-group=/)

// Minimal control harness tests handlers/state, not browser layout or real DOM behavior.
class Control{
  constructor(dataset={}){this.dataset=dataset;this.listeners=new Map();this.attrs={};this.hidden=false;this.open=false;this.inert=false;this.scrollTop=0;this.value='';this.isConnected=true;this.classes=new Set();this.classList={contains:k=>this.classes.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,force)=>{const yes=force??!this.classes.has(k);if(yes)this.classes.add(k);else this.classes.delete(k);return yes}}}
  addEventListener(name,fn){const all=this.listeners.get(name)||[];all.push(fn);this.listeners.set(name,all)}
  removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==fn))}
  fire(name,extra={}){const event={target:this,key:'',preventDefault(){this.prevented=true},...extra};for(const fn of this.listeners.get(name)||[])fn(event);return event}
  setAttribute(k,v){this.attrs[k]=v}
  removeAttribute(k){delete this.attrs[k]}
  focus(){if(!this.hidden)document.activeElement=this}
  getClientRects(){return this.hidden?[]:[1]}
}
const shell=new Control(),sidebar=new Control(),main=new Control(),trigger=new Control(),scrim=new Control(),nav=new Control(),close=new Control(),active=new Control(),summary=new Control(),last=new Control()
const groups=navigationGroups.map(group=>new Control({navGroup:group.id}))
const media=new Control();media.matches=false
const controls=new Map([['.sidebar',sidebar],['.main-column',main],['[data-function-nav-toggle]',trigger],['[data-nav-close]',scrim],['.nav',nav],['[data-function-drawer-close]',close]])
shell.querySelector=selector=>controls.get(selector)
shell.querySelectorAll=selector=>selector==='[data-nav-group]'?groups:[]
sidebar.querySelector=selector=>selector==='[aria-current="page"]'?active:summary
sidebar.querySelectorAll=()=>[summary,active,last]
sidebar.contains=el=>[summary,active,last].includes(el)
const doc=new Control()
globalThis.document=doc
globalThis.window={matchMedia:()=>media}
doc.querySelector=selector=>selector==='[data-function-shell]'?shell:null
mountFunctionShell()
assert.equal(sidebar.inert,false)
trigger.fire('click');assert.equal(sidebar.inert,true);assert.equal(main.inert,false)
assert.equal(trigger.attrs['aria-expanded'],'false')
assert.ok(renderFunctionShell({entry:defaultFunctionEntry,pageHtml:''}).includes('nav-collapsed'))
trigger.fire('click');assert.equal(sidebar.inert,false)
groups[1].open=true;groups[1].fire('toggle');groups[0].open=true;groups[0].fire('toggle');assert.equal(groups[1].open,false)
media.matches=true;media.fire('change');assert.equal(sidebar.inert,true)
trigger.fire('click');assert.equal(main.inert,true);assert.equal(sidebar.attrs['aria-modal'],'true');assert.equal(doc.activeElement,active)
last.focus();assert.equal(doc.fire('keydown',{key:'Tab'}).prevented,true);assert.equal(doc.activeElement,summary)
summary.focus();doc.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(doc.activeElement,last)
doc.fire('keydown',{key:'Escape'});assert.equal(main.inert,false);assert.equal(sidebar.inert,true);assert.equal(doc.activeElement,trigger)
active.hidden=true
trigger.fire('click');assert.equal(doc.activeElement,summary,'reopened drawer focuses a visible summary if the current link belongs to a closed group')
scrim.fire('click');active.hidden=false
trigger.fire('click');scrim.fire('click');assert.equal(sidebar.inert,true)
trigger.fire('click');sidebar.fire('click',{target:{closest:()=>active}});assert.equal(sidebar.inert,true)
trigger.fire('click');media.matches=false;media.fire('change');assert.equal(main.inert,false);assert.equal(sidebar.inert,false);assert.equal(sidebar.attrs['aria-modal'],undefined)
assert.equal(doc.listeners.get('keydown').length,1)
mountFunctionShell();assert.equal(doc.listeners.get('keydown').length,1,'rerender releases old global handlers')
assert.equal(media.listeners.get('change').length,1)
doc.querySelector=()=>null;mountFunctionShell();assert.equal(doc.listeners.get('keydown').length,0,'standalone demo releases function navigator')

const search=new Control(),empty=new Control()
const directoryGroups=navigationGroups.map(group=>{
  const el=new Control();el.items=navigationEntries(group).map(entry=>new Control({functionLabel:navigationSearchText(entry)}));el.querySelectorAll=()=>el.items;return el
})
doc.querySelector=selector=>selector==='[data-function-search]'?search:empty
doc.querySelectorAll=()=>directoryGroups
functionHomePage.mount()
search.value='工具';search.fire('input')
assert.equal(directoryGroups.filter(group=>!group.hidden).length,1)
assert.equal(directoryGroups.flatMap(group=>group.items).filter(item=>!item.hidden).length,1)
assert.equal(empty.hidden,true)
search.value='不存在XYZ';search.fire('input');assert.equal(empty.hidden,false)
search.value='';search.fire('input');assert.equal(directoryGroups.flatMap(group=>group.items).filter(item=>!item.hidden).length,canonical.length)
const report={passed:true,kind:'route, rendered markup and event-handler unit checks',directRoutes:functionEntries.length,legacyRoutes:functionEntries.length,implementedRoutes:ready.length,navigationEntries:canonical.length,groups:navigationGroups.length,checks:['default monthly calendar','explicit catalog','all old and current deep links','no planned navigation','resource aliases','active group','desktop collapse state','mobile inert, focus selection, tab loop, Escape, scrim and link close in control harness','listener cleanup','directory alias search and empty state'],limitations:['Browser layout, CSS rendering, native focus/inert and real pointer behavior are not verified; local browser control is disabled.']}
const out='test-artifacts/function-navigation-unit'
await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await writeFile(`${out}/catalog.html`,catalog)
console.log(JSON.stringify(report,null,2))
