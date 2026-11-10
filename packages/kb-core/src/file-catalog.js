import path from 'node:path'
import {createReadStream,readFileSync,statSync} from 'node:fs'
import {readFile,lstat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {walkTree,privateRootOf} from './fsindex.js'
import {safePath,readJson,atomicJson,locked,digest,fail,relativePath} from './workbench-state.js'
import {CLASSIFICATION_VERSION,presentClassifiedFile} from './file-classification.js'

export const CATALOG_PATH='索引层/文件目录.json'
export const CATALOG_FORMAT='original-files-v1'
const TEXT=/\.(md|markdown|txt|text|csv|tsv|json|jsonl|log|ya?ml|html?|xml|[cm]?js|tsx?|jsx|py|css|sql)$/i
const categories={'00-画像':'画像','10-项目':'项目','20-知识笔记':'知识','30-人物关系':'人物','40-素材资源':'素材'}
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):fallback
const tagsOf=value=>Array.isArray(value)?[...new Set(value.filter(t=>typeof t==='string').map(t=>t.slice(0,100)))].slice(0,32):[]
const activeCache=new Map()
export function catalogActive(root){
  try{const file=path.join(root,CATALOG_PATH),meta=path.join(root,'.kbmeta/kb.json'),a=statSync(file,{bigint:true}),b=statSync(meta,{bigint:true}),key=[a.ino,a.size,a.mtimeNs,a.ctimeNs,b.ino,b.mtimeNs,b.ctimeNs].join(':');if(activeCache.get(root)===key)return true
    const c=JSON.parse(readFileSync(file,'utf8')),kb=JSON.parse(readFileSync(meta,'utf8'));if(c.format!==CATALOG_FORMAT||c.kbId!==kb.kbId||!Array.isArray(c.files)||!Array.isArray(c.references))throw Error('invalid catalog')
    if(activeCache.size>=16)activeCache.delete(activeCache.keys().next().value);activeCache.set(root,key);return true
  }catch(e){activeCache.delete(root);if(e.code==='ENOENT')return false;throw fail('STATE_CORRUPT','索引架构记录无法读取，未退回旧模式')}
}
export async function readCatalog(root,kbId){
  const c=await readJson(await safePath(root,CATALOG_PATH,{missing:true}),null)
  if(!c)return null
  if(c.format!==CATALOG_FORMAT||!Array.isArray(c.files)||!Array.isArray(c.references)||kbId&&c.kbId!==kbId||c.files.some(f=>!f||typeof f.path!=='string'||relativePath(f.path)!==f.path||f.path.startsWith('索引层/')))throw fail('STATE_CORRUPT','文件目录身份或格式不符，已保留现场')
  return c.classificationVersion===CLASSIFICATION_VERSION?c:{...c,files:c.files.map(presentClassifiedFile),classificationPending:true}
}
const identity=st=>String(st.dev)+':'+String(st.ino)
async function fileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
const system=file=>/(^|\/)(_模板|_手册)(\/|$)/.test(file)||/^(AGENTS|INDEX|README|知识库清单)\.md$/i.test(file)

// No body is stored here. Every catalog record addresses an ordinary original.
export async function inspectOriginals(b,{previous=null,paths=[]}={}){
  const walk=await walkTree(b.root,b.root,{maxFiles:Number.MAX_SAFE_INTEGER,maxDepth:128,followLinks:false})
  if(walk.truncated||walk.errors.some(e=>!String(e.reason??e.code??'').includes('link')&&!String(e.reason??e.code??'').includes('LINK')))throw fail('SCAN_INCOMPLETE','文件枚举不完整，未发布迁移；请检查不可访问目录或链接')
  const old=new Map((previous?.files??[]).map(f=>[f.path,f])),byIdentity=new Map()
  for(const f of old.values()){const list=byIdentity.get(f.identity)??[];list.push(f);byIdentity.set(f.identity,list)}
  const candidates=[],refs=new Map(),known=new Set()
  const requests=await readJson(await safePath(b.root,'.kbmeta/requests.json',{missing:true}),{})
  for(const [id,r]of Object.entries(requests.items??{}))if(id.startsWith('capture-')&&r.op==='create'&&r.path)known.add(r.path)
  const imports=await readJson(await safePath(b.root,'.kbmeta/import-sources.json',{missing:true}),{})
  for(const r of Object.values(imports.entries??{}))if((!r.kbId||r.kbId===b.st.kbId)&&r.entryPath&&r.originalPath&&r.entryPath!==r.originalPath)known.add(r.entryPath)
  const livePaths=new Set(walk.files.map(f=>f.path))
  for(const f of walk.files){
    if(system(f.path))continue
    const absolute=await safePath(b.root,f.path),before=await lstat(absolute)
    const cached=old.get(f.path)
    if(cached?.status==='available'&&!cached.referencePaths?.length&&cached.identity===identity(before)&&cached.size===before.size&&cached.mtimeMs===before.mtimeMs&&cached.ctimeMs===before.ctimeMs&&!paths.some(p=>f.path===p||f.path.startsWith(p+'/'))){candidates.push({...cached,private:cached.private===true||privateRootOf(f.path,b.privateDirs)!==null});continue}
    let fm={},text=''
    if(TEXT.test(f.path)&&before.size<=8*1024*1024){text=await readFile(absolute,'utf8');fm=b.core._internal.parseFrontmatter(text).data}
    const source=typeof fm.source==='string'?fm.source:null
    if(source&&(known.has(f.path)||text.includes('<!-- kb:source-reference -->'))){
      let rel;try{rel=relativePath(source)}catch{throw fail('SOURCE_INVALID','旧索引的原件指向无效：'+f.path)}
      const priorReference=previous?.references?.find(r=>r.path===f.path);if(!livePaths.has(rel)&&priorReference&&old.has(priorReference.source))rel=priorReference.source;
      if(rel===f.path||!livePaths.has(rel)&&!old.has(rel))throw fail('SOURCE_MISSING','旧索引的原件缺失，未把旧正文当作原件：'+f.path)
      if(livePaths.has(rel))await safePath(b.root,rel);refs.set(f.path,{source:rel,fm});continue
    }
    const hash=await fileHash(absolute),after=await lstat(absolute)
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||identity(before)!==identity(after))throw fail('FILE_CHANGED','扫描期间文件已改变，请重新预览')
    const moved=byIdentity.get(identity(after)),prior=old.get(f.path)??(moved?.length===1&&moved[0].sha256===hash?moved[0]:null)
    const folder=path.posix.dirname(f.path),kind=label(fm.type,categories[f.path.split('/')[0]]||'素材')
    candidates.push({id:prior?.id??'file-'+digest(b.st.kbId+'\0'+identity(after)+'\0'+f.path).slice(0,24),path:f.path,identity:identity(after),sha256:hash,size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs,
      title:typeof fm.title==='string'?fm.title.slice(0,512):path.posix.basename(f.path,path.posix.extname(f.path)),originalType:label(fm.type,null),originalCategory:label(fm.category,null),kind:prior?.manual?prior.kind:kind,
      category:prior?.manual?prior.category:label(fm.category,folder==='.'?'未分类':folder),tags:prior?.manual?prior.tags:tagsOf(fm.tags),manual:prior?.manual===true,
      private:prior?.private===true||kind==='画像'||kind==='人物'||privateRootOf(f.path,b.privateDirs)!==null,status:'available',...(prior&&prior.path!==f.path?{previousPath:prior.path}:{})})
  }
  const files=new Map(candidates.map(f=>[f.path,f]))
  for(const [alias,{source,fm}]of [...refs].sort(([a],[b])=>a.localeCompare(b))){const f=files.get(source)??candidates.find(row=>row.previousPath===source);if(!f&&old.has(source))continue;if(!f)throw fail('SOURCE_INVALID','原件指向另一个索引条目，未迁移：'+alias)
    if(f.path!==source)refs.set(alias,{source:f.path,fm});
    if(!f.manual&&!f.originalCategory&&!f.referencePaths?.length){
      // Old classified references contain the user's classification. The date
      // archive containing the original is a storage location, not that category.
      f.category=label(fm.category,path.posix.dirname(alias)==='.'?'未分类':path.posix.dirname(alias))
    }
    f.referencePaths=[...(f.referencePaths??[]),alias];if(!f.manual){if(!f.originalType)f.kind=label(fm.type,f.kind);f.tags=tagsOf([...f.tags,...tagsOf(fm.tags)])}
    f.private ||=f.kind==='画像'||f.kind==='人物'||privateRootOf(alias,b.privateDirs)!==null
  }
  const ids=new Set(candidates.map(f=>f.id))
  for(const f of old.values())if(!ids.has(f.id))candidates.push({...f,status:'missing'})
  return {classificationVersion:CLASSIFICATION_VERSION,files:candidates.map(presentClassifiedFile).sort((a,b)=>a.path.localeCompare(b.path)),references:[...refs].map(([path,r])=>({path,source:r.source})),coverage:{files:walk.files.length,originals:candidates.filter(f=>f.status==='available').length,references:refs.size,errors:walk.errors}}
}

export async function refreshCatalog(b,options={}){
  if(!catalogActive(b.root))return null
  const file=await safePath(b.root,CATALOG_PATH)
  return locked(file,async()=>{const old=await readCatalog(b.root,b.st.kbId),scan=await inspectOriginals(b,{previous:old,...options})
    const privatePaths=files=>files.filter(f=>f.private&&f.status==='available').map(f=>f.path).sort();
    const privacyChanged=JSON.stringify(privatePaths(old.files))!==JSON.stringify(privatePaths(scan.files));
    const next={...old,...scan,classificationPending:false};if(old.classificationPending||digest(JSON.stringify(scan.files))!==digest(JSON.stringify(old.files))||digest(JSON.stringify(scan.references))!==digest(JSON.stringify(old.references))){
      if(old.classificationPending){const raw=await readJson(file,null);await atomicJson(await safePath(b.root,'索引层/分类历史/'+Date.now()+'-'+old.revision+'.json',{missing:true}),raw);}
      if(old.classificationPending||privacyChanged)next.policyRevision=(old.policyRevision??0)+1
      next.revision++;next.updatedAt=Date.now();await atomicJson(file,next)
    }return next})
}

export async function repairClassifications(b){
 const file=await safePath(b.root,CATALOG_PATH)
 return b.core._internal.withMutationLock(b.root,()=>locked(file,async()=>{
  const old=await readJson(file,null);if(!old||old.kbId!==b.st.kbId)throw fail('BINDING_CHANGED','当前库文件目录身份不符')
  const files=old.files.map(presentClassifiedFile),changed=files.filter((f,i)=>f.category!==old.files[i].category||f.presentationRole!==old.files[i].presentationRole).length
  if(!changed&&old.classificationVersion===CLASSIFICATION_VERSION)return {changed:0,revision:old.revision}
  const backup='索引层/分类历史/'+Date.now()+'-'+old.revision+'.json';await atomicJson(await safePath(b.root,backup,{missing:true}),old)
  const next={...old,files,classificationVersion:CLASSIFICATION_VERSION,classificationPending:false,revision:old.revision+1,policyRevision:(old.policyRevision??0)+1,updatedAt:Date.now()};await atomicJson(file,next)
  return {changed,revision:next.revision,backup,manualPreserved:files.filter(f=>f.manual).length}
 }))
}

export async function classifyOriginal(b,args){
  const file=await safePath(b.root,CATALOG_PATH)
  return locked(file,async()=>{const c=await readCatalog(b.root,b.st.kbId);if(!c)throw fail('ARCHITECTURE_REQUIRED','请先迁移到索引架构');if(args.revision!==undefined&&args.revision!==c.revision)throw fail('CONFLICT','分类已改变，请刷新')
    const rel=relativePath(args.path),f=c.files.find(f=>f.path===rel&&f.status==='available');if(!f)throw fail('NOT_FOUND','没有可分类的真实文件')
    await safePath(b.root,rel)
    for(const key of ['kind','category'])if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>200))throw fail('BAD_SETTINGS','分类名称无效')
    if(args.tags!==undefined&&(!Array.isArray(args.tags)||args.tags.length>32||args.tags.some(t=>typeof t!=='string'||t.length>100)))throw fail('BAD_SETTINGS','标签无效')
    if(args.kind!==undefined)f.kind=args.kind;if(args.category!==undefined)f.category=args.category;if(args.tags!==undefined)f.tags=args.tags
    f.private ||=args.kind==='画像'||args.kind==='人物';f.manual=true;c.revision++;c.policyRevision=(c.policyRevision??0)+1;c.updatedAt=Date.now();await atomicJson(file,c)
    return {ok:true,entryId:f.id,path:f.path,revision:f.sha256.slice(0,12),catalogRevision:c.revision,indexSynced:true,original:true}
  })
}
