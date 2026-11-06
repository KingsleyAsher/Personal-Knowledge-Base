import path from 'node:path'

export const CLASSIFICATION_VERSION=3
const roots={'00-画像':'个人与关系/个人资料','10-项目':'项目与开发','20-知识笔记':'知识笔记','30-人物关系':'个人与关系/人物与关系','40-素材资源':'资料与素材'}
const clean=s=>String(s??'').replaceAll('\\','/').split('/').map(p=>p.trim().replace(/^\d{2}[-_]/,'')).filter(Boolean)
const storage=s=>/^(?:原件归档|收件箱|归档|_archive|archive|排除索引分区|未分类|待分类|底稿)$|^20\d{2}[-_年]?\d{2}|^[a-f\d]{12,}$|^\d{6}(?:[-_][a-f\d]+)?$|^\d{8,}$/i.test(s)

export function filePresentationRole(f){
 const p=String(f.path??'').replaceAll('\\','/')
 if(/^50-底稿\//.test(p))return 'derived'
 if(/^(00-知识库请求通道|知识库地图)\//.test(p)||/^(AGENTS|INDEX|README|知识库清单)\.md$/i.test(p))return 'support'
 return 'original'
}

export function classifyFile(f){
 const role=filePresentationRole(f)
 if(f.manual)return {category:f.category,classificationSource:'manual',presentationRole:role}
 if(String(f.path??'').replaceAll('\\','/').startsWith('任务成品/'))return {category:path.posix.dirname(String(f.path).replaceAll('\\','/')),classificationSource:'deliverable-directory',presentationRole:'original'}
 if(role==='support')return {category:'知识库管理/请求与导航',classificationSource:'system',presentationRole:role}
 const signal=[path.posix.basename(f.path??''),f.title,...(f.tags??[]),...clean(path.posix.dirname(f.path??'')).filter(p=>!storage(p))].join(' ')
 const rules=[
  [/数学分析|微积分|柯西|函数极限/,'学习与课程/数学分析'],
  [/高等代数|线性代数/,'学习与课程/高等代数'],
  [/集合函数|实变函数|测度论/,'学习与课程/集合与实变函数'],
  [/英语|英文|英语阅读|English|IELTS|TOEFL/i,'学习与课程/英语'],
  [/培养方案|本科培养|课表|课程表|选课|学分|大学生手册|教务/,'学习与课程/课程与教务'],
  [/每日信息|信息报|新闻|资讯/,'资讯与阅读/每日资讯'],
  [/散文|小说|诗歌|诗集|书稿|人物设定|收信人/,'写作与创作/文学写作'],
  [/保险|保单|合同|友邦/,'生活与事务/保险与合同'],
  [/账单|流水|收支|预算|报销/,'生活与事务/账单与财务'],
  [/校园|学生事务|奖学金|助学金|宿舍|竞赛|创新创业大赛/,'学习与课程/校园事务'],
  [/DSH|DeepSeek|知识库|智能体|Agent|MCP|ComfyUI|Qwen|ASR|TTS|API|插件/i,'项目与开发/智能工具'],
 ]
 let category,source
 // An explicit category is user-authored evidence. A storage path is not.
 const explicit=clean(f.originalCategory),legacy=clean(f.category)
 if(explicit.length&&!explicit.some(storage)){category=explicit.join('/');source='metadata'}
 if(!category){const rule=rules.find(([test])=>test.test(signal));if(rule){category=rule[1];source='name-and-tags'}}
 if(!category){
  const originalRoot=String(f.category??'').split('/')[0],meaningful=legacy.filter(s=>!storage(s))
  const mapped=roots[originalRoot]
  if(mapped){const tail=meaningful.slice(1).filter(s=>!/^20\d{2}/.test(s));category=[mapped,...tail].join('/');source='existing-category'}
  else if(meaningful.length&&!/^(50-底稿|90-收件箱|排除索引分区)(\/|$)/.test(f.category??'')){category=meaningful.join('/');source='existing-category'}
 }
 if(!category){
  const ext=path.posix.extname(f.path??'').toLowerCase()
  if(/\.(png|jpe?g|webp|gif|svg|heic)$/.test(ext))category='资料与素材/图片'
  else if(/\.(mp3|m4a|wav|flac|ogg|mp4|mov|mkv|webm)$/.test(ext))category='资料与素材/音视频'
  else if(/\.(zip|7z|rar)$/.test(ext))category='资料与素材/压缩包'
  else if(['画像'].includes(f.kind))category='个人与关系/个人资料'
  else if(['人物','人物关系'].includes(f.kind))category='个人与关系/人物与关系'
  else if(f.kind==='知识')category='知识笔记/其他笔记'
  else if(f.kind==='项目')category='项目与开发/其他项目'
  else category='待分类'
  source=category==='待分类'?'unclassified':'file-type'
 }
 return {category:category.slice(0,200),classificationSource:source,presentationRole:role}
}

export function presentClassifiedFile(f){return {...f,...classifyFile(f),classificationVersion:CLASSIFICATION_VERSION}}
