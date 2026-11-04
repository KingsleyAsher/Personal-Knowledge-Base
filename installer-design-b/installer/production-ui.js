let setupInfo,installPath,desktopShortcut=true,launchAfter=true,realBusy=false,lastError='';
function decorateStep(k){
 if(k==='settings'||k==='path-error'){
  const stage=view.querySelector('.feature-deck');
  stage.innerHTML=`<div class="real-settings"><aside><h2>熟悉的位置，<br>自己的节奏。</h2><p>应用与个人资料分开保存。</p></aside><section><h2>设置安装位置</h2><p>安装到当前用户，无需管理员权限。</p><label for="install-path">应用安装目录</label><div class="real-path"><input id="install-path" readonly><button data-action="pick">更改位置</button></div><p class="real-note">安装后可选择或创建知识库。</p><label class="check-label"><input type="checkbox" id="desktop-shortcut">创建桌面快捷方式</label><div class="real-error" role="alert"></div><div class="real-actions"><button data-action="welcome">上一步</button><button class="primary" data-action="install">开始安装</button></div></section></div>`;
  stage.querySelector('#install-path').value=installPath||'';stage.querySelector('#desktop-shortcut').checked=desktopShortcut;stage.querySelector('#desktop-shortcut').onchange=e=>desktopShortcut=e.target.checked;
  if(k==='path-error')stage.querySelector('.real-error').textContent=lastError;
 }
 if(k==='done'){
  const stage=view.querySelector('.feature-deck');
  stage.innerHTML=`<div class="real-complete"><span class="completion-icon">✓</span><h2>已准备好，开始积累吧。</h2><p>知识工作台已安装到这台电脑。</p><label class="check-label"><input type="checkbox" id="launch-after">立即启动知识工作台</label><button class="primary" data-action="launch">完成</button></div>`;
  stage.querySelector('#launch-after').checked=launchAfter;stage.querySelector('#launch-after').onchange=e=>launchAfter=e.target.checked;
 }
 if(k==='existing'){
  view.querySelectorAll('[data-action=settings]').forEach(n=>{n.dataset.action='close-existing';if(n.querySelector('text'))n.querySelector('text').textContent='关闭';});
  view.querySelectorAll('text').forEach(t=>{if(t.textContent==='可以直接打开，或重新安装应用文件。')t.textContent='可直接打开；重新安装前请先卸载。';});
 }
 if(k==='failure'){
  const texts=view.querySelectorAll('text');for(const t of texts){if(t.textContent==='部分应用文件未能写入。')t.textContent=lastError.slice(0,28);}
  if(setupInfo?.uninstall){view.querySelectorAll('[data-action=settings]').forEach(n=>n.dataset.action='uninstall');for(const t of texts){if(t.textContent==='安装未能完成')t.textContent='卸载未能完成';if(t.textContent==='重试安装')t.textContent='重试卸载';if(t.textContent==='更换位置')t.textContent='返回';if(t.textContent==='请检查安装目录权限，或更换安装位置。')t.textContent='关闭工作台后，可重新尝试卸载。';}}
 }
 if(k==='uninstall'){
  view.querySelectorAll('[data-action=existing]').forEach(n=>n.dataset.action='closed');
 }
 if(k==='install'&&setupInfo?.uninstall){view.querySelector('.brand-lockup strong').textContent='卸载知识工作台';view.querySelector('.cancel-button').style.visibility='hidden';}
}
window.setup.progress(({percent,label})=>{if(current==='install'){updateProgress(percent);const status=view.querySelector('.install-status-label');if(status)status.textContent=label;}});
window.setup.closeRequested(()=>{if(realBusy){if(!setupInfo.uninstall)show('exit');}else window.setup.close();});
document.addEventListener('click',async e=>{
 const dot=e.target.closest('[data-feature]');if(dot){clearInterval(featureTimer);selectFeature(Number(dot.dataset.feature));return;}
 const a=e.target.closest('[data-action]');if(!a)return;const k=a.dataset.action;
 try{
  if(k==='pick'){const p=await window.setup.pick();if(p){installPath=p;decorateStep('settings');}return;}
  if(k==='resume'){await show(previous==='exit'?'install':previous,{resume:true});return;}
  if(k==='install'&&!setupInfo?.uninstall){
   if(realBusy)return;lastError='';await show('install');realBusy=true;
   const result=await window.setup.install({target:installPath,desktop:desktopShortcut});realBusy=false;
   if(result.ok){updateProgress(100);await new Promise(r=>setTimeout(r,350));await show('done');}
   else{lastError=result.error;if(result.canceled){await window.setup.close();return;}await show(result.installedFiles?'failure':'path-error');}return;
  }
  if(k==='removed'||(k==='install'&&setupInfo?.uninstall)){
   if(realBusy)return;await show('install');realBusy=true;const r=await window.setup.uninstall();realBusy=false;if(r.ok)await show('removed');else{lastError=r.error;await show('failure');}return;
  }
  if(k==='launch'){if(launchAfter||current==='existing')await window.setup.launch();else await window.setup.close();return;}
  if(k==='closed'||k==='close-existing'){
   if(realBusy){const r=await window.setup.cancel();if(!r.accepted)await show('install',{resume:true});}else await window.setup.close();return;
  }
  if(k==='copy'){await navigator.clipboard.writeText(lastError);return;}
  if(k==='exit'){if(realBusy&&setupInfo.uninstall)return;if(['done','removed','existing'].includes(current)){await window.setup.close();return;}await show('exit');return;}
  await show(k);
 }catch(err){realBusy=false;lastError=err.message;await show('failure');}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-action]')&&e.target.tagName!=='BUTTON'){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('pagehide',stop);
window.setup.info().then(info=>{setupInfo=info;installPath=info.target;show(info.uninstall?'uninstall':info.existing?'existing':'welcome');});
