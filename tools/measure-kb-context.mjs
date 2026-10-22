import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source=await readFile(process.argv[2]||'src/host/index.js','utf8')
const sections=[['  const parseToolDefs = () => {','  const flowToolDefs = () => {'],['  const flowToolDefs = () => {','  function toolDefs() {'],['  function toolDefs() {','  async function install(tools) {']]
const code=sections.map(([a,z])=>source.slice(source.indexOf(a),source.indexOf(z,source.indexOf(a)))).join('\n')
const definitions=vm.runInNewContext(code+'\ntoolDefs().concat(flowToolDefs(),parseToolDefs())',{})
const tools=definitions.map(({name,description,parameters})=>({name,bytes:Buffer.byteLength(JSON.stringify({name,description,parameters})),descriptionChars:description.length}))
const hintStart=source.indexOf("name: 'kb:flows'"),hintText=source.indexOf('text: [',hintStart),hintEnd=source.indexOf("].join('\\n')",hintText)
const hint=hintStart>=0&&hintText>=0&&hintEnd>=0?vm.runInNewContext(source.slice(hintText+6,hintEnd+1),{}).join('\n'):''
console.log(JSON.stringify({residentHintBytes:Buffer.byteLength(hint),unit:'UTF-8 bytes, not tokens',tools,totalToolBytes:tools.reduce((n,t)=>n+t.bytes,0)},null,2))
