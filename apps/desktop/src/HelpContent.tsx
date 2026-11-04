import Feedback from './Feedback';import {useEffect,useState} from 'react';import {api} from './types';
export type HelpTopic='about'|'updates'|'feedback'|'status'|'changelog';
export const helpTitles:Record<HelpTopic,string>={about:'关于个人知识库',updates:'检查更新',feedback:'反馈',status:'系统状态',changelog:'更新内容'};
export default function HelpContent({topic}:{topic:HelpTopic}){
 const [info,setInfo]=useState<any>(null),[status,setStatus]=useState<any>(null),[error,setError]=useState(''),[text,setText]=useState(''),[copied,setCopied]=useState(false),[loading,setLoading]=useState(false);
 async function refresh(){setLoading(true);setError('');try{const [i,s]=await Promise.all([api('appInfo'),topic==='status'?api('diagnostics'):Promise.resolve(null)]);setInfo(i);setStatus(s);}catch(e:any){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{if(topic!=='feedback')void refresh();},[topic]);
 if(topic==='feedback')return <Feedback/>;
 if(error)return <p role="alert">{error}</p>;
 if(!info)return <p>正在读取版本信息…</p>;
 const version=<p className="help-version">v{info.version} · 构建 {info.buildId}</p>;
 if(topic==='about')return <><p>个人知识库 · 知识工作台</p><p>在本地浏览、整理与编辑文件，使用最多四栏工作区对照资料。</p>{version}<p>Windows 桌面客户端 · 运行环境随包提供。</p><p className="muted">支持独立使用与授权共库；DSH 对话需要宿主在线。</p></>;
 if(topic==='updates')return <>{version}<p role="status">{info.updates.message}</p><p>更新源：Gitee · GitCode · GitHub</p>{info.updates.sourceStatus?.map((s:any)=><p key={s.id}>{s.name}：{s.ok?'清单可用':s.message}</p>)}{info.updates.source&&<p>版本信息来源：{info.updates.source}</p>}<p className="muted">自动下载会验证文件大小与 SHA-256。当前安装器尚不支持自动覆盖安装。</p><button disabled={loading} onClick={()=>{setLoading(true);void api('clientUpdates',{action:'check'}).then(updates=>setInfo({...info,updates})).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}>{loading?'正在检查…':'重新检查'}</button></>;
 if(topic==='status')return <>{version}<dl className="help-status"><dt>本地知识库服务</dt><dd>{status?.service.state==='ready'?'已连接':status?.service.state??'未知'}</dd><dt>DSH 会话</dt><dd>{status?.dshConnected?'已连接':'未连接'}</dd><dt>界面隔离</dt><dd>{status?.contextIsolation&&status?.sandbox?'已启用':'未启用'}</dd><dt>桌面运行环境</dt><dd>Electron {info.electron}</dd></dl><button disabled={loading} onClick={()=>void refresh()}>刷新系统状态</button></>;
 return <><p>本次更新</p><ul><li>最多四栏并排预览，支持自动开栏、标签拖放和独立调整宽度。</li><li>关系图共用插件组件，支持连线选择、下一层连接、旁侧预览和手动关联。</li><li>备份与恢复、任务与记录使用可移动浮窗，并可切换全屏。</li><li>DSH 新增模型、思考强度、插件预设、技能、附件及操作确认。</li><li>文件、选中文字和批注卡片可右键加入对话。</li></ul><p>此前更新</p><ul><li>滑动开关控制编辑，收件箱与插件联动，单文件或批量管理索引。</li><li>Alt+F 可移动搜索，搜索/文件树拖放及回收站浮窗。</li><li>单个浅色/深色主题按钮和未保存关闭确认。</li><li>自定义快捷键、面板分隔线与动态宽度边界。</li><li>PDF 缩放及常用文档、表格和代码编辑。</li></ul>{version}</>;
}
