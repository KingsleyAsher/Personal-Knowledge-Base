import path from 'node:path'
import os from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {readdir,readFile,mkdir,rename,copyFile,stat} from 'node:fs/promises'

// Windows locks loaded executables/DLLs. Run helpers outside the replaceable bundle.
export async function resolveHostPython(packageRoot,{home=path.join(os.homedir(),'.dsh','runtime','knowledge-python')}={}) {
  const source=path.join(packageRoot,'runtime','python'),files=[]
  async function walk(dir,prefix='') {
    for(const row of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(row.isSymbolicLink())throw Error('Python runtime must not contain links')
      const rel=path.join(prefix,row.name)
      if(row.isDirectory())await walk(path.join(dir,row.name),rel)
      else if(row.isFile())files.push({rel,digest:createHash('sha256').update(await readFile(path.join(source,rel))).digest('hex')})
    }
  }
  try{await stat(path.join(source,'python.exe'))}catch(e){if(e.code==='ENOENT')return 'python';throw e}
  await walk(source)
  const key=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,24),target=path.join(home,key)
  async function verified() {
    try {for(const f of files)if(createHash('sha256').update(await readFile(path.join(target,f.rel))).digest('hex')!==f.digest)return false;return true}
    catch(e){if(e.code==='ENOENT')return false;throw e}
  }
  if(await verified())return path.join(target,'python.exe')
  const temp=path.join(home,key+'.tmp-'+randomUUID());await mkdir(temp,{recursive:true})
  for(const f of files){const dest=path.join(temp,f.rel);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.join(source,f.rel),dest)}
  try{await rename(temp,target)}catch(e){if(!await verified())throw e}
  if(!await verified())throw Error('Copied Python runtime failed verification')
  return path.join(target,'python.exe')
}
