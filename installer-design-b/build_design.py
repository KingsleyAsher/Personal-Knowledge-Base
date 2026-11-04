from pathlib import Path
import html,json,base64

OUT=Path(__file__).parent
BG='#faf8f2'; INK='#26392f'; MUTED='#747e73'; GREEN='#416451'; SOFT='#e9eee4'
def text(x,y,s,size=14,color=INK,weight=400):
    return f'<text x="{x}" y="{y}" font-family="Noto Sans SC,Microsoft YaHei,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(s)}</text>'
def rect(x,y,w,h,c,r=8):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}"/>'
def button(x,y,label,action,w=170,primary=True):
    return f'<g data-action="{action}" role="button" tabindex="0" aria-label="{label}" style="cursor:pointer">'+rect(x,y,w,44,GREEN if primary else SOFT)+text(x+20,y+28,label,14,'#fff' if primary else GREEN,500)+'</g>'
def lines(x,y,ss,size=14,color=MUTED,gap=26):return ''.join(text(x,y+i*gap,s,size,color) for i,s in enumerate(ss))
screens=[
 ('welcome','01 · 欢迎安装','从一页笔记，','开始有序积累。'),
 ('settings','02 · 安装设置','熟悉的位置，','自己的节奏。'),
 ('install','03 · 正在安装','为每一次灵感，','留一个位置。'),
 ('done','04 · 安装完成','工作台已就绪，','让积累开始。'),
 ('path-error','05 · 路径校验','一个合适的位置，','让安装更顺利。'),
 ('failure','06 · 安装失败','稍作调整，','再继续。'),
 ('exit','07 · 退出确认','知识的旅程，','随时可以开始。'),
 ('existing','08 · 已安装提示','熟悉的工作台，','继续陪伴你。'),
 ('uninstall','09 · 卸载确认','暂时告别，','保留你的积累。'),
 ('removed','10 · 卸载完成','留好每一页，','下次再相见。')]
def render(key,label,h1,h2):
    s='<svg xmlns="http://www.w3.org/2000/svg" width="880" height="600" viewBox="0 0 880 600">'
    close_action='closed' if key in ['done','removed','existing'] else 'exit'
    s+=rect(0,0,880,600,BG,16)+text(28,33,'知识工作台 · 安装程序',13,MUTED)
    s+=f'<g class="window-close" data-action="{close_action}" role="button" tabindex="0" aria-label="关闭窗口"><rect x="824" y="8" width="40" height="40" rx="8" fill="{BG}"/><path d="M839 23l10 10m0-10-10 10" stroke="{MUTED}" stroke-width="1.6" stroke-linecap="round"/></g>'
    s+=rect(28,64,302,452,SOFT,12)
    s+='<g transform="translate(56 94)"><rect width="64" height="64" rx="19" fill="#416451"/><g stroke="#faf8f2" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M32 23c-5-4-12-5-19-3v26c7-2 14-1 19 3 5-4 12-5 19-3V20c-7-2-14-1-19 3v26"/><path d="M19 27c3 0 5 1 7 2m-7 5c3 0 5 1 7 2" opacity=".55"/><path class="turning-page" d="M32 23c5-4 12-5 19-3v26c-7-2-14-1-19 3" fill="#faf8f2" fill-opacity=".12"/></g><g class="success-mark" opacity="0"><circle cx="53" cy="53" r="13" fill="#faf8f2"/><path d="m47 53 4 4 8-9" fill="none" stroke="#416451" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></g>'
    s+=text(56,209,h1,27,INK,600)+text(56,253,h2,27,INK,600)
    s+=text(56,308,'阅读 · 整理 · 连接',14,GREEN)+lines(56,452,['你的文件，','你的工作空间。'],13,MUTED,23)
    s+='<g class="installer-page-content">'
    x=366
    if key=='welcome':
        s+=text(x,112,'欢迎使用知识工作台',26,INK,600)+lines(x,154,['把资料、笔记与思考，安放在同一处。','几步设置，即可开始。'])
        for y,n,desc in [(244,'01  阅读与对照','在同一个工作区查看笔记和参考资料。'),(318,'02  整理与积累','沿用熟悉的目录，让文件各得其所。'),(392,'03  从本地开始','安装完成后，选择或创建你的知识库。')]:s+=text(x,y,n,16,GREEN,500)+text(x,y+27,desc,13,MUTED)
        s+=button(x,466,'开始设置','settings',454)
    elif key in ['settings','path-error']:
        s+=text(x,112,'设置安装位置',26,INK,600)+text(x,150,'安装到当前用户，无需为其他用户配置。',13,MUTED)
        s+=text(x,202,'应用安装目录',13,GREEN,500)+rect(x,218,454,48,'#ffffff')+text(x+14,248,'… / Programs / KnowledgeWorkbench',13)
        s+=button(x,280,'更改位置','pick',136,False)
        s+=text(x,354,'☑  创建桌面快捷方式',14)+text(x,389,'知识库目录将在首次启动时单独选择。',13,MUTED)
        if key=='path-error':s+=text(x,430,'此位置不可写，请选择其他文件夹。',13,'#a44e3b')
        else:s+=text(x,430,'应用与个人资料分开保存。',13,MUTED)
        s+=button(x,466,'上一步','welcome',130,False)+button(x+146,466,'开始安装','install',308)
    elif key=='install':
        s+=text(x,112,'正在安装知识工作台',25,INK,600)+lines(x,153,['正在安装应用文件，请稍候。','完成前请保持安装程序开启。'])
        s+=text(x,266,'62%',42,GREEN,500).replace('<text ','<text class="progress-number" ')+rect(x,290,454,8,'#dfe5d9',4)+'<g transform="translate(366 290)"><rect class="progress-fill" width="454" height="8" rx="4" fill="#416451" style="transform:scaleX(.62)"/></g>'
        s+='<g class="install-steps">'+lines(x,338,['✓  准备安装','●  安装应用文件','○  创建快捷方式'],14,MUTED,35)+'</g>'+button(x,466,'取消安装','exit',150,False)
    elif key=='done':
        s+=text(x,118,'安装完成',29,INK,600)+lines(x,164,['知识工作台已安装到这台电脑。','现在可以打开它，开始整理第一份资料。'])
        s+=rect(x,236,454,124,SOFT)+text(x+20,270,'下一步',14,GREEN,500)+lines(x+20,302,['选择或创建知识库，','然后打开一份笔记或参考文件。'],14)
        s+=text(x,417,'☑  立即启动知识工作台',14)+button(x,466,'完成并打开','launch',454)
    elif key=='failure':
        s+=text(x,112,'安装未能完成',27,INK,600)+lines(x,155,['部分应用文件未能写入。','请检查安装目录权限，或更换安装位置。'])
        s+=rect(x,234,454,112,'#f2e9df')+text(x+18,266,'文件写入失败',15,'#965340',500)+lines(x+18,297,['已有个人资料不受本次安装影响。','错误详情可复制后用于排查。'],13)
        s+=button(x,372,'复制错误详情','copy',180,False)+button(x,466,'更换位置','settings',190,False)+button(x+206,466,'重试安装','install',248)
    elif key=='exit':
        s+=text(x,116,'要退出安装吗？',27,INK,600)+lines(x,163,['安装尚未完成。','退出后，可重新运行安装程序继续安装。'])
        s+=rect(x,252,454,98,SOFT)+lines(x+20,286,['如已开始安装，将先清理本次临时文件。','不会删除你的知识库文件。'],13)
        s+=button(x,466,'退出安装','closed',190,False)+button(x+206,466,'继续安装','resume',248)
    elif key=='existing':
        s+=text(x,112,'已检测到知识工作台',26,INK,600)+lines(x,157,['这台电脑上已有相同版本。','可以直接打开，或重新安装应用文件。'])
        s+=rect(x,240,454,106,SOFT)+text(x+20,276,'当前版本  0.1.0-rc1',15,GREEN,500)+text(x+20,312,'重新安装保留个人资料与应用设置。',13,MUTED)
        s+=button(x,466,'重新安装','settings',190,False)+button(x+206,466,'打开工作台','launch',248)
    elif key=='uninstall':
        s+=text(x,112,'卸载知识工作台？',27,INK,600)+lines(x,157,['将移除应用程序和快捷方式。','请先保存工作并关闭知识工作台。'])
        s+=rect(x,242,454,108,SOFT)+text(x+20,278,'保留你的资料',16,GREEN,500)+lines(x+20,310,['知识库文件与个人设置会保留。'],13)
        s+=button(x,466,'返回','existing',190,False)+button(x+206,466,'确认卸载','removed',248)
    elif key=='removed':
        s+=text(x,112,'已完成卸载',28,INK,600)+lines(x,158,['知识工作台已从这台电脑移除。','你的知识库文件与个人设置已保留。'])
        s+=text(x,288,'下次安装后，可以再次打开原有知识库。',14,MUTED)+button(x,466,'关闭','closed',454)
    s+='</g>'
    s+=text(28,563,'知识工作台  /  0.1.0-rc1',11,MUTED)+text(624,563,'WINDOWS x64  ·  纸页绿',11,MUTED)
    defs='<defs><linearGradient id="icon-depth" x2=".7" y2="1"><stop stop-color="#78947f"/><stop offset="1" stop-color="#355440"/></linearGradient><filter id="icon-lift" x="-35%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#2b452f" flood-opacity=".23"/></filter></defs>'
    s=s.replace('<rect width="64" height="64" rx="19" fill="#416451"/>','<rect width="64" height="64" rx="19" fill="url(#icon-depth)" stroke="#8fa68c" filter="url(#icon-lift)"/>')
    return s+defs+'</svg>'
svgs={k:render(k,*v) for k,*v in screens}
for k,s in svgs.items():(OUT/(k+'.svg')).write_text(s,encoding='utf-8')
data=json.dumps(svgs,ensure_ascii=False)
nav=''.join(f'<button data-screen="{k}">{label}</button>' for k,label,*_ in screens)
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>知识工作台 · 纸页绿安装全流程</title><style>*{box-sizing:border-box}body{margin:0;background:#e6e9e1;color:#26392f;font-family:"Microsoft YaHei",sans-serif}header{max-width:1192px;margin:36px auto 24px}h1{font-size:26px;margin:0 0 10px}p{color:#747e73;font-size:13px;line-height:1.8}main{display:flex;gap:24px;max-width:1192px;margin:auto}nav{width:264px;flex-shrink:0}button{font:inherit;cursor:pointer}nav button{display:block;border:0;background:none;width:100%;text-align:left;padding:15px 18px;border-radius:8px;color:#596653;margin-bottom:4px}nav button.active{background:#416451;color:white}#view{width:880px;box-shadow:0 16px 70px #26392f18;border-radius:16px;overflow:hidden}svg{display:block;max-width:100%;height:auto}footer{max-width:1192px;margin:24px auto;font-size:12px;color:#747e73}#toast{min-height:30px;color:#416451}a{color:#416451}@media(max-width:1100px){main{display:block;padding:16px}header,footer{padding:16px}nav{width:100%;display:flex;flex-wrap:wrap}nav button{width:auto}#view{max-width:100%}}</style><header><h1>纸页绿 · 安装体验</h1><p>完整流程预览 / 点击界面按钮体验，或从左侧切换状态。所有操作仅为演示，不会安装或删除文件。</p></header><main><nav>'''+nav+'''</nav><section><div id="view"></div><p id="toast" aria-live="polite"></p></section></main><footer>暖白 #FAF8F2 · 森绿 #416451 · Noto Sans SC / 微软雅黑　｜　880 × 600　｜　<a href="overview.html">查看全套设计总览</a><br>进度、错误和版本为设计示例；安装器实现时须绑定真实状态。退出清理、升级与卸载保留策略须由安装逻辑兑现。</footer><script>const screens='''+data+''';let current='welcome',previous='welcome';const view=document.querySelector('#view'),toast=document.querySelector('#toast');function show(k){if(!screens[k])return;if(k==='exit')previous=current;current=k;view.innerHTML=screens[k];document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===k));toast.textContent=k==='install'?'演示控制：点击此处模拟安装完成；按住 Shift 点击模拟失败。':'';}document.addEventListener('click',e=>{const nav=e.target.closest('[data-screen]');if(nav)return show(nav.dataset.screen);const a=e.target.closest('[data-action]');if(!a)return;const k=a.dataset.action;if(k==='resume')return show(previous==='exit'?'install':previous);if(k==='pick'){toast.textContent='演示：真实安装器将在此打开系统文件夹选择器。';return;}if(k==='copy'){navigator.clipboard?.writeText('演示错误：INSTALL_WRITE_FAILED');toast.textContent='演示错误详情：INSTALL_WRITE_FAILED';return;}if(k==='launch'||k==='closed'){toast.textContent=k==='launch'?'预览结束：正式安装器将在此启动知识工作台。':'预览结束：正式安装器将在此关闭窗口。';return;}show(k);});document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-action]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});toast.onclick=e=>{if(current==='install')show(e.shiftKey?'failure':'done');};show(location.hash.slice(1)||'welcome');</script></html>'''
assets={p.stem:'data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode('ascii') for p in (OUT/'assets').glob('*.png')}
runtime=(OUT/'motion.js').read_text(encoding='utf-8').replace('src="assets/${f[3]}.png"','src="${screenshotAssets[f[3]]}"').replace('src="assets/${asset}.png"','src="${screenshotAssets[asset]}"').replace('src="assets/${f.asset}.png"','src="${screenshotAssets[f.asset]}"')
page=page[:page.index('<script>')]+ '<script>const screens='+data+';</script><script>'+(OUT/'vector-scenes.js').read_text(encoding='utf-8')+'\n'+runtime+'</script></html>'
page=page.replace('</style>',(OUT/'motion.css').read_text(encoding='utf-8')+(OUT/'large-preview.css').read_text(encoding='utf-8')+(OUT/'vector-scenes.css').read_text(encoding='utf-8')+'</style>')
page=page.replace('880 × 600','安装展示页 1040 × 780').replace('或从左侧切换状态','或从上方切换状态')
(OUT/'index.html').write_text(page,encoding='utf-8')
(OUT/'screenshot-demo.html').write_text(page.replace("show(location.hash.slice(1)||'welcome');","show(location.hash.slice(1)||'install');"),encoding='utf-8')
(OUT/'vector-demo.html').write_text(page.replace("show(location.hash.slice(1)||'welcome');","show(location.hash.slice(1)||'install');"),encoding='utf-8')
overview='<html lang="zh-CN"><meta charset="utf-8"><title>B 全套设计稿</title><style>body{background:#e6e9e1;font-family:Microsoft YaHei;padding:32px;color:#26392f}main{display:grid;grid-template-columns:repeat(2,880px);gap:40px}h2{font-size:18px}svg{box-shadow:0 6px 26px #26392f18;border-radius:16px}</style><h1>知识工作台 · 纸页绿 / 完整安装流程</h1><p>设计稿 · 演示状态 · 2026.11.04</p><main>'
overview+=''.join('<section><h2>'+label+'</h2>'+svgs[k]+'</section>' for k,label,*_ in screens)+'</main></html>'
(OUT/'overview.html').write_text(overview,encoding='utf-8')
(OUT/'README.md').write_text('''# 知识工作台 · B 纸页绿

index.html 为可点击预览；overview.html 为十个状态总览。十份 SVG 可分别导入 Figma，保留矢量与文字（字体取决于导入环境）。当前 Figma 文件尚未同步，因 Starter MCP 调用额度耗尽。

尺寸 880×600；底色 #FAF8F2，主文字 #26392F，绿色 #416451，浅绿 #E9EEE4。沿用 Noto Sans SC 字体，缺失时回退微软雅黑。欢迎→安装设置→安装中→完成；另有路径错误、安装失败、退出确认、已安装提示、卸载确认与卸载完成。

实现要求：真实校验目录可写性与所需空间；进度绑定安装事件；复制错误时清除敏感路径；安装过程中退出必须等待安全取消与临时文件清理；升级/重装不得清除个人资料；卸载只移除应用及其快捷方式，保留知识库和设置。当前预览不执行这些系统操作，也不是安装 EXE。
''',encoding='utf-8')
print('Generated 10 SVG screens, interactive preview and overview:',OUT)
