import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { initialRetrievalConfig } from '../src/host/retrieval-api.js'

test('global knowledge settings mounts shared retrieval form and uses decimal human-readable sizes',async()=>{
  const source=await readFile(new URL('../src/client/workbench-ui.js',import.meta.url),'utf8')
  const element=(type,props,...children)=>({type,props:props||{},children:children.flat()})
  let slots=[],index=0,effects=[]
  const react={Fragment:'fragment',useState(initial){const at=index++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return [slots[at],v=>{slots[at]=typeof v==='function'?v(slots[at]):v}]},useRef(initial){const [value]=this.useState({current:initial});return value},useEffect(callback){effects.push(callback)}}
  const requests=[],config={revision:0,...initialRetrievalConfig(),enabled:true}
  const factory=vm.runInNewContext(source+'\ncreateWorkbenchUI',{
    document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},
    window:{},setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,console,
  })
  const ui=factory({react,e:element,api:async body=>{requests.push(body);return body.op==='preferences.get'?{ok:true,kbId:'current-library',version:'policy'}:{ok:true,config,progress:{state:requests.some(r=>r.op==='retrieval.pause')?'paused':'building'}}}})
  const render=(component,props)=>{index=0;return component(props)}
  render(ui.RetrievalSettings)
  for(const effect of effects.splice(0))effect()
  await new Promise(resolve=>setImmediate(resolve))
  const root=render(ui.RetrievalSettings)
  const form=root.children.find(n=>typeof n?.type==='function')
  assert(form);assert.equal(form.props.snapshot.kbId,'current-library')
  slots=[];effects=[];render(form.type,form.props)
  for(const effect of effects.splice(0))effect()
  await new Promise(resolve=>setImmediate(resolve))
  const rendered=render(form.type,form.props)
  const flatten=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(flatten)]:[node]
  const text=flatten(rendered).filter(n=>typeof n==='string').join(' ')
  assert(text.includes('完整 Embedding 接口地址'));assert(text.includes('通用重排序 API'));assert(text.includes('保存并启用自动建库'))
  assert(requests.some(r=>r.op==='retrieval.get'&&r.expectedKbId==='current-library'))
  const row=flatten(rendered).find(n=>n?.props?.['aria-label']==='检索配置与索引操作')
  assert(row)
  assert(flatten(row).includes('暂停'));assert(flatten(row).includes('保存并启用自动建库'))
  const pause=flatten(row).find(n=>n?.type==='button'&&n.children.includes('暂停'))
  await pause.props.onClick()
  assert(requests.some(r=>r.op==='retrieval.pause'))
  const paused=flatten(render(form.type,form.props));assert(paused.includes('索引构建已暂停'));assert(paused.includes('继续'));assert(!paused.includes('暂停'))
  assert(source.includes("'relations-progress', 'retrieval'"))

  assert.equal(ui.formatSize(1000),'1 KB');assert.equal(ui.formatSize(40960000),'40.96 MB');assert.equal(ui.formatSize(4096000000),'4.1 GB');assert.equal(ui.formatSize(0),'0 B')
  const client=(await readFile(new URL('../src/client/index.js',import.meta.url),'utf8')).replaceAll('\r\n','\n')
  const start=client.indexOf('function WorkbenchSettings()'),end=client.indexOf('function ReleaseNotice()',start)
  const hostSettings=vm.runInNewContext('('+client.slice(start,end).trim()+')',{react,e:element,workbenchUI:ui,UpdatePrompt:()=>{},Section:()=>{},PROJECT_RECORD_URL:''})
  assert(!flatten(hostSettings()).some(n=>n?.type===ui.RetrievalSettings))
  const section=client.slice(client.indexOf('function Section()'),client.indexOf('// ── 顶栏页签'))
  assert(section.includes('e(workbenchUI.RetrievalSettings),\n        e(ParseSection'))
  assert(source.includes('.kbw-global-settings>.kbw-panel{border:0'))
})
