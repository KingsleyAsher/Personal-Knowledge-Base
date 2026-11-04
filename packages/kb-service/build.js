import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { hash } from './io.js'
export async function readCandidateBuild(root) {
  const text=await readFile(path.join(root,'src/host/index.js'),'utf8'),literal=text.match(/const list = (\[.*?\])/)?.[1]
  if(!literal)throw Error('Build inventory missing')
  const files=[...literal.matchAll(/'([^']+)'/g)].map(x=>x[1]),rows=[]
  for(const file of files)rows.push({path:file,sha256:hash(await readFile(path.join(root,file)))})
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
  return {version:pkg.version,buildId:hash(rows.map(x=>x.path+'\0'+x.sha256+'\n').join('')).slice(0,16),channel:'desktop-parity-candidate',files:rows}
}

export async function runtimeBuild() {
  const rows=[]
  const walk=async (folder,prefix)=>{for(const row of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(row.name==='__pycache__')continue;const name=prefix+'/'+row.name;if(row.isDirectory())await walk(path.join(folder,row.name),name);else if(row.isFile())rows.push(name+'\0'+hash(await readFile(path.join(folder,row.name)))+'\n')}}
  for(const name of ['kb-core','kb-contracts','kb-service'])await walk(path.resolve(import.meta.dirname,'..',name),name)
  return hash(rows.join('')).slice(0,16)
}
