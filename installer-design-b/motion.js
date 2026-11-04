let current='welcome',previous='welcome',progress=0,timer=null,featureTimer=null,featureIndex=0;
const view=document.querySelector('#view'),toast=document.querySelector('#toast');
function stop(){clearInterval(timer);clearInterval(featureTimer);timer=null;featureTimer=null;}
const features=sceneFeatures;
function selectFeature(index){
  featureIndex=index;
  view.querySelector('.feature-track').style.transform=`translateX(-${index*100}%)`;
  view.querySelectorAll('[data-feature]').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-pressed',String(i===index));});
  view.querySelectorAll('.feature-slide').forEach((s,i)=>s.setAttribute('aria-hidden',String(i!==index)));
}
function depthIcon(kind,small=false){
  const paths={reading:'M4 5h6l2 2 2-2h6v14h-6l-2 2-2-2H4z M12 7v14',folders:'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',pdf:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h4',tabs:'M3 5h18v15H3z M3 9h18 M10 9v11',relations:'M6 6h4v4H6z M15 14h4v4h-4z M8 10v6h7',dark:'M18 16A8 8 0 0 1 8 4a8 8 0 1 0 10 12',close:'M7 7l10 10 M17 7 7 17',cancel:'M8 7v10 M16 7v10'};
  return `<span class="depth-icon ${small?'small':''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[kind]||paths.reading}"/></svg></span>`;
}
function installFeatures(){
  view.innerHTML=`<div class="install-window"><header class="install-header"><div class="brand-lockup"><div class="icon-book" aria-hidden="true"><div class="book-scene"><div class="book"><div class="book-paper left-paper"></div><div class="book-paper right-paper"></div><div class="book-spine"></div><div class="book-leaf leaf-one"><span></span></div><div class="book-leaf leaf-two"><span></span></div><div class="book-leaf leaf-three"><span></span></div></div></div></div><div><strong>知识工作台</strong><span>正在为你准备工作空间</span></div></div><button class="install-close" data-action="exit" aria-label="关闭安装程序">${depthIcon('close',true)}</button></header><section class="feature-deck" aria-label="功能介绍"><div class="feature-viewport"><div class="feature-track">${features.map((f,i)=>`<article class="feature-slide"><div class="feature-heading">${depthIcon(f[3])}<div><span class="feature-kicker">0${i+1} / ${f[0]}</span><h2>${f[1]}</h2></div></div><div class="screenshot-mask"></div><p>${f[2]}</p></article>`).join('')}</div></div><div class="feature-dots">${features.map((f,i)=>`<button data-feature="${i}" aria-label="查看${f[0]}"></button>`).join('')}</div></section><footer class="installation-footer"><div class="installation-status"><span class="install-status-label">准备安装</span><span class="progress-number">0%</span></div><div class="rounded-progress" aria-hidden="true"><div class="progress-fill"></div></div><div class="installation-bottom"><span>0.1.0-rc1 · Windows x64</span><button class="cancel-button" data-action="exit">${depthIcon('cancel',true)}取消安装</button></div></footer></div>`;
  selectFeature(0);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)featureTimer=setInterval(()=>selectFeature((featureIndex+1)%features.length),3800);
}
function updateProgress(value){
  progress=Math.max(0,Math.min(100,value));
  const n=view.querySelector('.progress-number'),fill=view.querySelector('.progress-fill');
  if(!n||!fill)return;
  n.textContent=Math.floor(progress)+'%';fill.style.transform=`translateX(${progress-100}%)`;
  const steps=view.querySelectorAll('.install-steps text');
  const status=view.querySelector('.install-status-label');
  if(status)status.textContent=progress<16?'正在准备安装':progress<86?'正在安装应用文件':progress<100?'正在创建快捷方式':'安装完成';
  if(!steps.length)return;
  steps[0].textContent=progress<16?'●  准备安装':'✓  准备安装';
  steps[1].textContent=progress<16?'○  安装应用文件':progress<86?'●  安装应用文件':'✓  安装应用文件';
  steps[2].textContent=progress<86?'○  创建快捷方式':progress<100?'●  创建快捷方式':'✓  创建快捷方式';
}
let pageTransition=null,pageTransitionId=0;
async function show(k,options={}){
  if(!screens[k])return;
  const id=++pageTransitionId;
  stop();
  if(pageTransition){pageTransition.cancel();pageTransition=null;}
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const order=['welcome','settings','install','done'];
  const direction=order.indexOf(k)<order.indexOf(current)?-1:1;
  const outgoing=view.querySelector('.feature-deck');
  if(outgoing){
    pageTransition=outgoing.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:reduce?'translateX(0)':`translateX(${-direction*8}px)`}],{duration:reduce?80:120,easing:'cubic-bezier(.23,1,.32,1)',fill:'forwards'});
    try{await pageTransition.finished;}catch{return;}
    if(id!==pageTransitionId)return;
  }
  renderPage(k,options);
  if(pageTransition)pageTransition.cancel();
  const incoming=view.querySelector('.feature-deck');
  if(!incoming){pageTransition=null;return;}
  pageTransition=incoming.animate([{opacity:0,transform:reduce?'translateX(0)':`translateX(${direction*12}px)`},{opacity:1,transform:'translateX(0)'}],{duration:reduce?100:200,easing:'cubic-bezier(.23,1,.32,1)',fill:'forwards'});
  try{await pageTransition.finished;}catch{return;}
  if(id===pageTransitionId){pageTransition.cancel();pageTransition=null;}
}
function renderPage(k,{resume=false}={}){
  if(!screens[k])return;
  stop();if(k==='exit'&&current!=='exit')previous=current;
  current=k;view.dataset.state=k;
  // All wizard steps share the same chrome, stage geometry and footer.
  // Only stage contents change; SVG steps no longer replace the whole window.
  const existing=view.querySelector('.install-window');
  if(!existing)installFeatures();
  const shell=view.querySelector('.install-window');
  if(k==='install'){
    if(existing){
      const staging=document.createElement('div');
      const oldNodes=[...view.childNodes];
      oldNodes.forEach(n=>staging.appendChild(n));
      installFeatures();
      const fresh=view.querySelector('.feature-deck');
      const original=staging.querySelector('.feature-deck');
      original.replaceWith(fresh);
      view.replaceChildren(...staging.childNodes);
    }
    mountVectorScenes();
  }else{
    stop();
    const doc=new DOMParser().parseFromString(screens[k],'image/svg+xml');
    const svg=doc.documentElement;
    svg.setAttribute('viewBox','28 64 824 452');
    svg.setAttribute('width','100%');svg.setAttribute('height','100%');
    svg.setAttribute('class','wizard-step-scene');
    view.querySelector('.feature-deck').replaceChildren(document.importNode(svg,true));
  }
  view.querySelector('.install-window').dataset.step=k;
  view.querySelector('.brand-lockup>div:last-child>span').textContent=k==='install'?'正在为你准备工作空间':k==='done'?'工作台已准备就绪':'安装知识工作台';
  document.querySelectorAll('[data-screen]').forEach(b=>b.classList.toggle('active',b.dataset.screen===k));
  toast.textContent=k==='install'?'正在播放安装演示（约 25 秒），共 5 组矢量功能演示。点击此处提前完成；Shift + 点击模拟失败。':'';
  if(k==='install'){
    updateProgress(resume?progress:0);
    let completeAt=0;
    timer=setInterval(()=>{
      if(progress<100)updateProgress(progress+1);
      else if(!completeAt)completeAt=Date.now();
      else if(Date.now()-completeAt>=500)show('done');
    },240);
  }
}
document.addEventListener('click',e=>{
  const dot=e.target.closest('[data-feature]');if(dot){clearInterval(featureTimer);selectFeature(Number(dot.dataset.feature));return;}
  const nav=e.target.closest('[data-screen]');if(nav)return show(nav.dataset.screen);
  const action=e.target.closest('[data-action]');if(!action)return;
  const k=action.dataset.action;
  if(k==='resume')return show(previous,{resume:true});
  if(k==='pick'){toast.textContent='正式安装器将在此打开系统文件夹选择器。';return;}
  if(k==='copy'){navigator.clipboard?.writeText('演示错误：INSTALL_WRITE_FAILED').catch(()=>{});toast.textContent='演示错误详情：INSTALL_WRITE_FAILED';return;}
  if(k==='launch'||k==='closed'){stop();toast.textContent=k==='launch'?'预览结束：正式安装器将在此启动知识工作台。':'预览结束：正式安装器将在此关闭窗口。';return;}
  show(k);
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-action]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
toast.onclick=e=>{if(current==='install')show(e.shiftKey?'failure':'done');};
window.addEventListener('pagehide',stop);
show(location.hash.slice(1)||'welcome');
