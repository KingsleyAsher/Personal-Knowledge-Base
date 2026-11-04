import {flushSync} from 'react-dom';
import {useLayoutEffect,useRef} from 'react';import type {RefObject} from 'react';

// One motion vocabulary for the desktop shell. No animation loop updates React.
export const motion={out:'cubic-bezier(0.22, 0.68, 0.26, 1)',move:'cubic-bezier(0.65, 0, 0.35, 1)',drawer:'cubic-bezier(0.22, 0.68, 0.26, 1)',quick:220,tabExit:280,popover:300,panel:380,float:520,floatExit:220,layout:420,theme:520};
type Box={left:number;top:number;width:number;height:number};
type Transition={ready:Promise<void>;finished:Promise<void>;updateCallbackDone:Promise<void>;skipTransition:()=>void};
type Options={target?:string;kind?:'page'|'panel'|'theme'|'popover'|'layout';direction?:number;anchor?:Box;layout?:boolean;axis?:'x'};
let input:'pointer'|'keyboard'='keyboard',trigger:Box|undefined,current:Transition|undefined,sequence=0,installed=false,lastDrag=-1000;
let snapshotAnimations:Set<Animation>|undefined;
type DockScene={animations:Set<Animation>;ghosts:HTMLElement[];restore:(()=>void)[]};
let localDock:DockScene|undefined;
let localTabs:DockScene|undefined;
const pending:{update:()=>void;done:boolean}[]=[];
const entryDrifts=new Map<string,{x:number;y:number}>();
export const toolMotion=(kind:string)=>'kb-tool-'+kind;
export const paneMotion=(id:string)=>'kb-pane-'+id.replace(/[^a-zA-Z0-9_-]/g,'');
const labels:Record<string,string>={'关系图浮窗':'relation','关系资料预览浮窗':'relationPreview','收件箱浮窗':'inbox','回收站浮窗':'trash','备份与恢复浮窗':'backups','任务与记录浮窗':'tasks','全局搜索':'search','文件排序':'sort','排序方式':'sort','资料库':'library','资料库设置':'library','快捷设置':'settings','模型与推理强度':'model'};
export function surfaceName(label:string){return toolMotion(labels[label]??'surface-'+[...label].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7).toString(36));}
export const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export const pointerMotion=()=>input==='pointer'&&!reducedMotion();
function releaseSnapshots(owned:Set<Animation>|undefined){if(!owned)return;for(const animation of owned)animation.cancel();owned.clear();}
function releaseDock(scene:DockScene|undefined){if(!scene)return;releaseSnapshots(scene.animations);for(const ghost of scene.ghosts)ghost.remove();for(const restore of scene.restore)restore();}
export function stopMotion(preserveTabs=false){const transition=current,owned=snapshotAnimations,dock=localDock,tabs=preserveTabs?undefined:localTabs;current=undefined;snapshotAnimations=undefined;localDock=undefined;if(!preserveTabs)localTabs=undefined;transition?.skipTransition();releaseSnapshots(owned);releaseDock(dock);releaseDock(tabs);delete document.documentElement.dataset.motionDockLocal;delete document.documentElement.dataset.motionKind;delete document.documentElement.dataset.motionShared;delete document.documentElement.dataset.motionDocked;for(const task of pending)if(!task.done){task.done=true;flushSync(task.update);}}
export function installMotionInput(){
 if(installed)return;installed=true;document.documentElement.dataset.motionInput='keyboard';
 const tokens=getComputedStyle(document.documentElement);
 for(const [key,token]of [['out','--ease-out'],['move','--ease-in-out'],['drawer','--ease-drawer']] as const){const value=tokens.getPropertyValue(token).trim();if(value)motion[key]=value;}
 for(const [key,token]of [['quick','--motion-fast'],['popover','--motion-popover'],['panel','--motion-panel'],['float','--motion-float'],['floatExit','--motion-float-exit'],['layout','--motion-layout'],['theme','--motion-theme']] as const){
  // Production CSS minification may serialize 300ms as .3s. WAAPI always
  // expects milliseconds; parseFloat alone would turn that into a 0.3ms flash.
  const match=tokens.getPropertyValue(token).trim().match(/^([\d.]+)(ms|s)$/),value=match?Number(match[1])*(match[2]==='s'?1000:1):NaN;
  if(Number.isFinite(value)&&value>0)motion[key]=value;
 }
 let themePress:HTMLButtonElement|undefined;
 const inside=(node:Element,x:number,y:number)=>{const r=node.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
 document.addEventListener('pointerdown',e=>{
  input='pointer';document.documentElement.dataset.motionInput=input;themePress=undefined;
  let node=(e.target as Element).closest('button,[role="tab"],.tree-row');
  // Native root snapshots can retarget an input to HTML. Forward only a
  // left-click at the existing theme control; never dismiss its popover or
  // synthesize an unrelated workspace action from such a retargeted event.
  if(e.button===0&&document.documentElement.dataset.motionKind==='theme'&&(e.target===document.documentElement||e.target===document.body)){
   themePress=[...document.querySelectorAll<HTMLButtonElement>('.theme-icon,.palette-card')].find(b=>!b.disabled&&inside(b,e.clientX,e.clientY));
   if(themePress){node=themePress;e.stopImmediatePropagation();}
  }
  // Keep a moving tab under the pointer until click has resolved its target.
  // Canceling on pointerdown can move its close button before pointerup and
  // swallow the next close in a rapid sequence.
  if(!(document.documentElement.dataset.motionKind==='theme'&&node?.matches('.theme-icon,.palette-card')))stopMotion(true);
  const r=node?.getBoundingClientRect();trigger=r?{left:r.left,top:r.top,width:r.width,height:r.height}:{left:e.clientX,top:e.clientY,width:1,height:1};
 },true);
 document.addEventListener('click',e=>{if(localTabs)stopMotion();const button=themePress;themePress=undefined;if(button?.isConnected&&(e.target===document.documentElement||e.target===document.body)&&inside(button,e.clientX,e.clientY)){e.preventDefault();e.stopImmediatePropagation();button.click();}},true);
 document.addEventListener('pointercancel',()=>{themePress=undefined;},true);
 document.addEventListener('keydown',()=>{themePress=undefined;input='keyboard';document.documentElement.dataset.motionInput=input;stopMotion();},true);
 document.addEventListener('dragstart',()=>{lastDrag=performance.now();stopMotion();},true);document.addEventListener('dragend',()=>{lastDrag=performance.now();},true);
 document.addEventListener('wheel',()=>{if(current||localDock||localTabs)stopMotion();},{passive:true,capture:true});
 matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{stopMotion();for(const node of document.querySelectorAll('.motion-selection,.motion-reference-chip')){for(const animation of node.getAnimations())animation.cancel();if(node.classList.contains('motion-reference-chip'))node.remove();}});
}
const readBox=(name:string|undefined)=>name?document.querySelector<HTMLElement>('[data-motion-surface="'+name+'"]')?.getBoundingClientRect():undefined;
const rounded=(n:number)=>Math.round(n*1000)/1000;
// A quadratic spatial path, with timing supplied separately by the easing curve.
// Values are baked into transform strings once, not inherited animated variables.
export function pathFrames(dx:number,dy:number,sx=1,sy=1,enter=true,arc=true):Keyframe[]{
 const frames:Keyframe[]=[];
 for(let i=0;i<=8;i++){
  const t=i/8,p=enter?1-t:t,distance=Math.hypot(dx,dy),bend=arc&&distance>.5?Math.sin(Math.PI*t)*Math.min(44,distance*.14+8):0;
  frames.push({offset:t,transform:`translate3d(${rounded(dx*p)}px,${rounded(dy*p-bend)}px,0) scale(${rounded(1+(sx-1)*p)},${rounded(1+(sy-1)*p)})`});
 }
 return frames;
}

// A damped entrance spring is sampled once into compositor transforms.
export function jellyFrames(width:number,height:number,enter=true,dx=0,dy=0):Keyframe[]{
 const damping=6.2,frequency=8.5,spring=(t:number)=>1-Math.exp(-damping*t)*(Math.cos(frequency*t)+damping/frequency*Math.sin(frequency*t)),velocity=(t:number)=>(damping*damping+frequency*frequency)/frequency*Math.exp(-damping*t)*Math.sin(frequency*t),join=.72,start=spring(join),slope=velocity(join)*(1-join),frames:Keyframe[]=[];
 const fine=(n:number)=>Math.round(n*100000)/100000;
 for(let i=0;i<=64;i++){
  const t=i/64,u=(t-join)/(1-join),p=t<=join?spring(t):(2*u**3-3*u**2+1)*start+(u**3-2*u**2+u)*slope+(-2*u**3+3*u**2),sx=.86+.14*p,sy=.9+.1*p;
  frames.push({offset:t,opacity:Math.min(1,t/.2),transform:`translate3d(${fine(width*(1-sx)/2+dx*(1-p))}px,${fine(height*(1-sy)/2+dy*(1-p))}px,0) scale(${fine(sx)},${fine(sy)})`});
 }
 return enter?frames:frames.map((_,i)=>({...frames[64-i],offset:i/64}));
}
// Exit has no spring settling or anticipation at the start. A literal reversed
// entrance would spend its first frames almost stationary and feel delayed.
export function floatExitFrames(width:number,height:number,dx=0,dy=0):Keyframe[]{
 return [{opacity:1,transform:'translate3d(0px,0px,0) scale(1,1)'},{opacity:0,transform:`translate3d(${rounded(width*.03+dx)}px,${rounded(height*.03+dy)}px,0) scale(.94,.94)`}];
}
function dockChange(update:()=>void,target:string){
 const find=(name:string)=>document.querySelector<HTMLElement>('[data-motion-surface="'+name+'"]'),main=find('kb-workspace'),side=find(target),before=main?.getBoundingClientRect(),oldSide=side?.getBoundingClientRect();
 if(!main||!before||input==='keyboard'||reducedMotion()){flushSync(update);return Promise.resolve();}
 const scene:DockScene={animations:new Set(),ghosts:[],restore:[]};let ghost:HTMLElement|undefined,railGhost:HTMLElement|undefined;
 const railFor=(node:HTMLElement|undefined|null)=>{const prior=node?.previousElementSibling;return prior instanceof HTMLElement&&prior.matches('.resizer[aria-label="调整右侧栏宽度"]')?prior:undefined;},oldRail=target==='kb-inspector'?railFor(side):undefined,oldRailBox=oldRail?.getBoundingClientRect();
 if(oldRail&&oldRailBox){railGhost=oldRail.cloneNode(true) as HTMLElement;railGhost.inert=true;railGhost.setAttribute('aria-hidden','true');railGhost.dataset.motionDockGhost='divider';railGhost.dataset.motionDockDivider=target;Object.assign(railGhost.style,{position:'fixed',left:oldRailBox.left+'px',top:oldRailBox.top+'px',width:oldRailBox.width+'px',height:oldRailBox.height+'px',margin:'0',zIndex:'40',pointerEvents:'none'});document.body.append(railGhost);scene.ghosts.push(railGhost);}
 if(side&&oldSide){
  ghost=side.cloneNode(true) as HTMLElement;ghost.inert=true;ghost.setAttribute('aria-hidden','true');ghost.dataset.motionDockGhost=target;
  for(const n of [ghost,...ghost.querySelectorAll<HTMLElement>('[id],[data-motion-surface],[data-motion-layout]')]){n.removeAttribute('id');n.removeAttribute('data-motion-surface');n.removeAttribute('data-motion-layout');n.style.viewTransitionName='none';}
  const font=getComputedStyle(side);Object.assign(ghost.style,{position:'fixed',left:oldSide.left+'px',top:oldSide.top+'px',width:oldSide.width+'px',height:oldSide.height+'px',margin:'0',zIndex:'40',pointerEvents:'none',fontFamily:font.fontFamily,fontSize:font.fontSize,lineHeight:font.lineHeight,color:font.color});
  const sources=[...side.querySelectorAll<HTMLElement>('*')],copies=[...ghost.querySelectorAll<HTMLElement>('*')],scrolls=sources.map((n,i)=>({i,top:n.scrollTop,left:n.scrollLeft})).filter(p=>p.top||p.left);
  document.body.append(ghost);for(const p of scrolls){copies[p.i].scrollTop=p.top;copies[p.i].scrollLeft=p.left;}
  const controls=side.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea'),copyControls=ghost.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea');controls.forEach((n,i)=>{copyControls[i].value=n.value;if(n instanceof HTMLInputElement&&(copyControls[i] instanceof HTMLInputElement))copyControls[i].checked=n.checked;});
  const canvases=side.querySelectorAll('canvas'),copyCanvases=ghost.querySelectorAll('canvas');canvases.forEach((n,i)=>{if(n.width&&n.height)try{copyCanvases[i].getContext('2d')?.drawImage(n,0,0);}catch{ /* A still-loading canvas can remain blank in the inert exit copy. */ }});scene.ghosts.push(ghost);
 }
 flushSync(update);
 const nextMain=find('kb-workspace'),nextSide=find(target),after=nextMain?.getBoundingClientRect(),sideBox=nextSide?.getBoundingClientRect(),nextRail=target==='kb-inspector'?railFor(nextSide):undefined;
 if(!nextMain||!after){releaseDock(scene);return Promise.resolve();}
 localDock=scene;document.documentElement.dataset.motionDockLocal='true';
 const play=(node:HTMLElement,frames:Keyframe[])=>{const animation=node.animate(frames,{duration:motion.layout,easing:motion.move,fill:'both'});scene.animations.add(animation);animation.finished.catch(()=>{});};
 const origin=nextMain.style.transformOrigin;nextMain.style.transformOrigin='0 0';scene.restore.push(()=>{nextMain.style.transformOrigin=origin;});
 play(nextMain,[{transform:`translate3d(${before.left-after.left}px,0,0) scale(${before.width/Math.max(1,after.width)},1)`,opacity:1},{transform:'translate3d(0,0,0) scale(1,1)',opacity:1}]);
 const left=target==='kb-explorer',clip=(n:number)=>left?`inset(0px 0px 0px ${n}px)`:`inset(0px ${n}px 0px 0px)`;
 if(nextRail){railGhost?.remove();nextRail.dataset.motionDockDivider=target;scene.restore.push(()=>{delete nextRail.dataset.motionDockDivider;});const box=nextRail.getBoundingClientRect(),shift=oldRailBox?oldRailBox.left-box.left:before.right-after.right;play(nextRail,[{transform:`translate3d(${shift}px,0,0)`,opacity:1},{transform:'translate3d(0,0,0)',opacity:1}]);}
 else if(railGhost)play(railGhost,[{transform:'translate3d(0,0,0)',opacity:1},{transform:`translate3d(${after.right-before.right}px,0,0)`,opacity:1}]);
 if(nextSide&&sideBox){
  ghost?.remove();
  if(oldSide){const priorOrigin=nextSide.style.transformOrigin;nextSide.style.transformOrigin='0 0';scene.restore.push(()=>{nextSide.style.transformOrigin=priorOrigin;});play(nextSide,[{transform:`translate3d(${oldSide.left-sideBox.left}px,0,0) scale(${oldSide.width/Math.max(1,sideBox.width)},1)`,opacity:1},{transform:'translate3d(0,0,0) scale(1,1)',opacity:1}]);}
  else{const shift=left?before.left-after.left:before.right-after.right;play(nextSide,[{transform:`translate3d(${shift}px,0,0)`,clipPath:clip(sideBox.width),opacity:1},{transform:'translate3d(0,0,0)',clipPath:clip(0),opacity:1}]);}
 }else if(ghost&&oldSide){const shift=left?after.left-before.left:after.right-before.right;play(ghost,[{transform:'translate3d(0,0,0)',clipPath:clip(0),opacity:1},{transform:`translate3d(${shift}px,0,0)`,clipPath:clip(oldSide.width),opacity:1}]);}
 return Promise.all([...scene.animations].map(a=>a.finished.catch(()=>{}))).then(()=>{if(localDock===scene){localDock=undefined;releaseDock(scene);delete document.documentElement.dataset.motionDockLocal;}});
}
export function viewChange(update:()=>void,options:Options={}){
 // Local popovers own their mount animation. A menu toggle must not capture
 // the workspace. It may supersede an older capture, but never creates one.
 if(options.kind==='popover'){if(current)stopMotion();update();return Promise.resolve();}
 const id=++sequence;stopMotion();
 // Sidebar push/pull is a local FLIP. Never capture the root page or recreate
 // its snapshot tree for this operation: that caused whole-window flashes.
 if(options.kind==='layout'&&(options.target==='kb-explorer'||options.target==='kb-inspector'))return dockChange(update,options.target);
 const api=document as Document&{startViewTransition?:(update:()=>void)=>Transition};
 if(input==='keyboard'||!api.startViewTransition){update();return Promise.resolve();}
 const before=readBox(options.target),origin=options.anchor??trigger,root=document.documentElement;
 const horizontal=options.axis==='x'||!!options.layout||options.kind==='layout',linked=options.kind==='layout',captureLayout=!!options.layout||linked,docked=linked&&(options.target==='kb-explorer'||options.target==='kb-inspector');
 const layoutBoxes=()=>new Map([...document.querySelectorAll<HTMLElement>('[data-motion-layout],[data-motion-surface="kb-workspace"],[data-motion-surface="kb-explorer"],[data-motion-surface="kb-inspector"]')].filter(n=>!docked||!n.hasAttribute('data-motion-layout')).map(n=>[n.dataset.motionSurface!,n.getBoundingClientRect()]));
 const first=captureLayout?layoutBoxes():new Map<string,DOMRect>();let last=new Map<string,DOMRect>();
 root.dataset.motionKind=options.kind==='page'?'page':horizontal?'layout':options.kind??'panel';root.style.setProperty('--motion-direction',String(options.direction??1));if(docked)root.dataset.motionDocked='true';
 const owned=new Set<Animation>();
 const play=(pseudo:string,frames:Keyframe[],duration:number,easing:string)=>{const animation=root.animate(frames,{duration,easing,fill:'both',pseudoElement:pseudo});owned.add(animation);animation.finished.catch(()=>{});return animation;};
 let after:DOMRect|undefined,sizeSheet:HTMLStyleElement|undefined;const task={update,done:false};pending.push(task);
 const transition=api.startViewTransition(()=>{if(!task.done){task.done=true;flushSync(update);}after=readBox(options.target);if(captureLayout)last=layoutBoxes();const index=pending.indexOf(task);if(index>=0)pending.splice(index,1);});current=transition;snapshotAnimations=owned;
 transition.ready.then(()=>{
  if(id!==sequence||current!==transition)return;const reduce=reducedMotion();
  if(options.kind==='theme'){
   const x=Math.max(0,Math.min(innerWidth,origin?origin.left+origin.width/2:innerWidth/2)),y=Math.max(0,Math.min(innerHeight,origin?origin.top+origin.height/2:innerHeight/2)),radius=Math.ceil(Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y)));
   play('::view-transition-new(root)',reduce?[{opacity:0},{opacity:1}]:[{clipPath:`circle(0px at ${x}px ${y}px)`},{clipPath:`circle(${radius}px at ${x}px ${y}px)`}],reduce?80:motion.theme,motion.out);return;
  }
  const pairs=[...new Set([...first.keys(),...last.keys()])].map(target=>({target,before:first.get(target),after:last.get(target)})).filter(p=>!p.before||!p.after||['left','top','width','height'].some(k=>Math.abs(p.before![k as keyof Box]-p.after![k as keyof Box])>.5));
  if(options.target&&!pairs.some(p=>p.target===options.target))pairs.push({target:options.target,before,after});
  const sheet=(css:string)=>{if(!sizeSheet){sizeSheet=document.createElement('style');document.head.append(sizeSheet);}sizeSheet.textContent+=css;};
  for(const {target,before,after}of pairs){const jelly=target.startsWith('kb-tool-'),sameBox=before&&after&&['left','top','width','height'].every(k=>Math.abs(before[k as keyof Box]-after[k as keyof Box])<.5),duration=reduce?80:linked?motion.layout:jelly&&!after?motion.floatExit:jelly&&!before?motion.float:horizontal&&sameBox?motion.quick:before&&after||horizontal?motion.layout:motion.panel;
  if(before&&after){
   const dx=before.left-after.left,dy=before.top-after.top;
   // Discrete dimensions for the old bitmap. Only transform/opacity interpolate.
   sheet(`::view-transition-old(${target}){width:${before.width}px;height:${before.height}px}`);root.dataset.motionShared=target;
   if(docked&&target==='kb-workspace')sheet('::view-transition-group(kb-workspace),::view-transition-image-pair(kb-workspace){overflow:visible}');
   const contentSlide=horizontal&&sameBox&&!linked?16:dx,newFrames=reduce?[{opacity:0},{opacity:1}]:pathFrames(contentSlide,horizontal?0:dy,before.width/Math.max(1,after.width),horizontal?1:before.height/Math.max(1,after.height),true,!horizontal);
   if(!reduce)for(let i=0;i<newFrames.length;i++)newFrames[i].opacity=horizontal?1:Math.min(1,i/2);
   play(`::view-transition-new(${target})`,newFrames,duration,motion.move);
   const oldFrames=reduce?[{opacity:1},{opacity:0}]:pathFrames(horizontal&&sameBox&&!linked?-16:-dx,horizontal?0:-dy,after.width/Math.max(1,before.width),horizontal?1:after.height/Math.max(1,before.height),false,!horizontal).map((f,i)=>({...f,transform:`translate3d(${rounded(dx)}px,${horizontal?0:rounded(dy)}px,0) `+f.transform,opacity:docked&&target==='kb-workspace'?0:horizontal?1:Math.max(0,1-i/2)}));
   play(`::view-transition-old(${target})`,oldFrames,duration,motion.move);
  }else{
   const box=after??before;if(!box)continue;const entering=!!after;
   if(horizontal){
    const sidebar=target==='kb-explorer'||target==='kb-inspector',start=first.get('kb-workspace'),end=last.get('kb-workspace'),left=target==='kb-explorer';
    const edge=(r:DOMRect)=>left?r.left:r.right;
    const pane=target.startsWith('kb-pane-'),leftSurvivor=[...first].some(([name,r])=>name.startsWith('kb-pane-')&&last.has(name)&&r.left<box.left-.5);
    const displacement=sidebar&&start&&end?(entering?edge(start)-edge(end):edge(end)-edge(start)):pane?box.width*(entering||leftSurvivor?1:-1):24*(entering?1:-1);
    sheet(`::view-transition-group(${target}){overflow:clip}`);
    const frames=reduce?[{opacity:entering?0:1},{opacity:entering?1:0}]:pathFrames(displacement,0,1,1,entering,false).map(f=>({...f,opacity:1}));
    play(`::view-transition-${entering?'new':'old'}(${target})`,frames,duration,motion.move);
    // Collapsed restore rails retain 24/28px in the real grid. Match the main
    // boundary displacement, clipping the remainder so the whole drawer still
    // becomes invisible without fading or leaving a stale sliver behind.
    if(sidebar&&!reduce){const rest=Math.max(0,box.width-Math.abs(displacement)),inset=(n:number)=>left?`inset(0px 0px 0px ${rounded(n)}px)`:`inset(0px ${rounded(n)}px 0px 0px)`;play(`::view-transition-group(${target})`,[{clipPath:inset(entering?rest:0)},{clipPath:inset(entering?0:rest)}],duration,motion.move);}
    continue;
   }
   const vx=origin?origin.left+origin.width/2-(box.left+box.width/2):0,vy=origin?origin.top+origin.height/2-(box.top+box.height/2):16,length=Math.max(1,Math.hypot(vx,vy));
   const centered=target==='kb-modal',drawer=target==='kb-inspector',dx=centered?box.width*.03:drawer?48:vx/length*44,dy=centered?box.height*.03:drawer?0:vy/length*44;
   const scale=drawer?1:.94,drift=entering?{x:vx/length*14,y:vy/length*14}:entryDrifts.get(target)??{x:vx/length*14,y:vy/length*14};
   if(jelly){if(entering)entryDrifts.set(target,drift);else entryDrifts.delete(target);}
   const frames=reduce?[{opacity:entering?0:1},{opacity:entering?1:0}]:jelly?(entering?jellyFrames(box.width,box.height,true,drift.x,drift.y):floatExitFrames(box.width,box.height,drift.x,drift.y)):options.axis==='x'?pathFrames(-24,0,1,1,entering,false):pathFrames(dx,dy,scale,scale,entering,!centered&&!drawer);
   if(!jelly||reduce){frames[0].opacity=entering?0:1;if(entering&&!reduce)for(let i=1;i<frames.length;i++)frames[i].opacity=Math.min(1,i/2);else frames.at(-1)!.opacity=entering?1:0;}
   play(`::view-transition-${entering?'new':'old'}(${target})`,frames,duration,jelly&&entering?'linear':options.target==='kb-inspector'?motion.drawer:motion.out);
  }}
 }).catch(()=>{});
 // Superseded snapshots never restore old state or block a newer action.
 transition.updateCallbackDone.catch(()=>{});
 transition.finished.catch(()=>{}).finally(()=>{releaseSnapshots(owned);sizeSheet?.remove();if(current===transition){current=undefined;snapshotAnimations=undefined;delete root.dataset.motionKind;delete root.dataset.motionShared;delete root.dataset.motionDocked;}});
 return transition.finished.catch(()=>{});
}

// A tab is removed from workspace state immediately. Its inert visual copy
// retracts through a fixed local clip while surviving tabs FLIP into the gap.
// Only transforms interpolate; neither the pane nor the page is snapshotted.
export function closeTabMotion(update:()=>void,pane:string,path:string){
 stopMotion();
 const section=document.querySelector<HTMLElement>('[data-motion-surface="'+pane+'"]'),list=section?.querySelector<HTMLElement>('.tab-list'),tab=list?.querySelector<HTMLElement>('[data-tab-path="'+CSS.escape(path)+'"]');
 if(!list||!tab||!pointerMotion()){flushSync(update);return Promise.resolve();}
 const before=new Map([...list.querySelectorAll<HTMLElement>(':scope > .document-tab')].map(node=>[node.dataset.tabPath!,{node,box:node.getBoundingClientRect()}])),box=tab.getBoundingClientRect(),copy=tab.cloneNode(true) as HTMLElement,active=tab.classList.contains('active');
 copy.removeAttribute('data-tab-path');copy.removeAttribute('draggable');copy.dataset.motionTabGhost='true';
 for(const node of [copy,...copy.querySelectorAll<HTMLElement>('[id],[role],[aria-selected]')]){node.removeAttribute('id');node.removeAttribute('role');node.removeAttribute('aria-selected');}
 Object.assign(copy.style,{width:box.width+'px',minWidth:box.width+'px',maxWidth:box.width+'px',height:box.height+'px',margin:'0',background:active?'var(--surface)':'var(--chrome)',borderTopColor:active?'var(--accent)':'transparent'});
 const scene:DockScene={animations:new Set(),ghosts:[],restore:[]};localTabs=scene;list.dataset.motionTabClose='true';
 scene.restore.push(()=>{delete list.dataset.motionTabClose;window.dispatchEvent(new CustomEvent('kb-tab-layout',{detail:list}));});
 flushSync(update);
 if(!list.isConnected){localTabs=undefined;releaseDock(scene);return Promise.resolve();}
 const next=[...list.querySelectorAll<HTMLElement>(':scope > .document-tab')].map(node=>({node,before:before.get(node.dataset.tabPath!)?.box,after:node.getBoundingClientRect()})),parent=list.getBoundingClientRect();
 // Synchronize the shared selection before applying transforms. The observer
 // skips this list until the scene ends, so it never measures moving tab boxes.
 window.dispatchEvent(new CustomEvent('kb-tab-layout',{detail:list}));
 for(const animation of list.querySelector<HTMLElement>(':scope > .motion-selection')?.getAnimations()??[])scene.animations.add(animation);
 const play=(node:HTMLElement,frames:Keyframe[])=>{const animation=node.animate(frames,{duration:motion.tabExit,easing:motion.out,fill:'both'});scene.animations.add(animation);animation.finished.catch(()=>{});};
 for(const item of next)if(item.before&&Math.abs(item.before.left-item.after.left)>.25)play(item.node,[{transform:`translate3d(${item.before.left-item.after.left}px,0px,0)`},{transform:'translate3d(0px,0px,0)'}]);
 const clip=document.createElement('div');clip.className='motion-tab-exit';clip.inert=true;clip.setAttribute('aria-hidden','true');
 Object.assign(clip.style,{left:box.left-parent.left+list.scrollLeft+'px',top:box.top-parent.top+list.scrollTop+'px',width:box.width+'px',height:box.height+'px'});clip.append(copy);list.append(clip);scene.ghosts.push(clip);
 play(copy,[{transform:'translate3d(0px,0px,0)'},{transform:`translate3d(${-box.width}px,0px,0)`}]);
 return Promise.all([...scene.animations].map(a=>a.finished.catch(()=>{}))).then(()=>{if(localTabs===scene){localTabs=undefined;releaseDock(scene);}});
}

// A single highlight sprite moves between selected rows, without copying text.
// Geometry is read only when selection/layout changes; the compositor does the rest.
export function installSelectionMotion(root:HTMLElement){
 const surfaces=new Map<HTMLElement,{sprite:HTMLElement;box?:Box;animation?:Animation;selected?:Element}>(),readers=new Map<HTMLElement,{path:string;animation?:Animation}>();let frame=0;
 const update=(tabGroup?:HTMLElement)=>{
  frame=0;
  const groups=root.querySelectorAll<HTMLElement>('.file-tree,.tab-list,.inspector-tabs');
  for(const group of groups){
   if(group.dataset.motionTabClose&&group!==tabGroup)continue;
   const selected=group.querySelector<HTMLElement>(group.classList.contains('file-tree')?'.tree-row.selected':group.classList.contains('tab-list')?'.document-tab.active':'button[role=tab][aria-selected=true]');
   if(!selected){const state=surfaces.get(group);if(state){state.animation?.cancel();state.sprite.hidden=true;state.box=undefined;state.selected=undefined;}continue;}
   let state=surfaces.get(group);if(!state){const sprite=document.createElement('span');sprite.className='motion-selection';sprite.setAttribute('aria-hidden','true');group.prepend(sprite);state={sprite};surfaces.set(group,state);resize.observe(group);}
   const r=selected.getBoundingClientRect(),g=group.getBoundingClientRect(),box={left:r.left-g.left+group.scrollLeft,top:r.top-g.top+group.scrollTop,width:r.width,height:r.height};
   if(state.box&&Object.keys(box).every(k=>Math.abs(box[k as keyof Box]-state!.box![k as keyof Box])<.5))continue;
   const sprite=state.sprite,prior=state.animation?.playState==='running'?sprite.getBoundingClientRect():null,old=prior?{left:prior.left-g.left+group.scrollLeft,top:prior.top-g.top+group.scrollTop,width:prior.width,height:prior.height}:state.box;
   state.animation?.cancel();sprite.hidden=false;Object.assign(sprite.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
   if(old&&pointerMotion()&&(state.selected!==selected||group.dataset.motionTabClose))state.animation=sprite.animate([{transform:`translate3d(${old.left-box.left}px,${old.top-box.top}px,0) scale(${old.width/box.width},${old.height/box.height})`},{transform:'translate3d(0,0,0) scale(1,1)'}],{duration:group.dataset.motionTabClose?motion.tabExit:motion.quick,easing:motion.out});
   if(!old&&pointerMotion())state.animation=sprite.animate(jellyFrames(box.width,box.height),{duration:motion.popover,easing:'linear'});
   state.box=box;state.selected=selected;if(!group.classList.contains('has-motion-selection'))group.classList.add('has-motion-selection');
  }
  for(const [group,state]of surfaces)if(!group.isConnected){state.animation?.cancel();resize.unobserve(group);surfaces.delete(group);}
  for(const pane of root.querySelectorAll<HTMLElement>('.document-pane[data-document-path]')){const path=pane.dataset.documentPath??'',previous=readers.get(pane);if(previous?.path===path)continue;previous?.animation?.cancel();const content=pane.querySelector<HTMLElement>('.document-scroll,.source-editor,.pdf-viewer,.image-preview,.office-editor,.media-preview');let animation:Animation|undefined;if(content&&pointerMotion()&&!current)animation=content.animate([{opacity:previous?.path?.length ? .45 : 0,transform:'translate3d(12px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:motion.quick,easing:motion.out});readers.set(pane,{path,animation});}
  for(const [pane,state]of readers)if(!pane.isConnected){state.animation?.cancel();readers.delete(pane);}
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>update());};
 const syncTabs=(event:Event)=>{if(frame)cancelAnimationFrame(frame);update((event as CustomEvent<HTMLElement>).detail);};
 const observer=new MutationObserver(records=>{if(records.some(r=>{const node=r.target as HTMLElement;if(node.classList?.contains('motion-selection'))return false;if(r.type==='attributes')return r.attributeName==='data-document-path'||!!node.closest?.('.file-tree,.tab-list,.inspector-tabs');return !!node.closest?.('.file-tree,.tab-list,.inspector-tabs')||node.matches?.('.preview-columns,.pane-slot,.workspace-shell,.workspace-center,.app');}))schedule();});
 observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','data-document-path']});
 const resize=new ResizeObserver(schedule);resize.observe(root);window.addEventListener('resize',schedule);root.addEventListener('scroll',schedule,true);window.addEventListener('kb-tree-layout',schedule);window.addEventListener('kb-tab-layout',syncTabs);schedule();
 return()=>{observer.disconnect();resize.disconnect();window.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);window.removeEventListener('kb-tree-layout',schedule);window.removeEventListener('kb-tab-layout',syncTabs);cancelAnimationFrame(frame);for(const {sprite,animation}of surfaces.values()){animation?.cancel();sprite.remove();}for(const {animation}of readers.values())animation?.cancel();surfaces.clear();readers.clear();};
}

export function flyReference(path:string,label:string){
 if(!pointerMotion()||performance.now()-lastDrag<500)return;
 const start=document.querySelector<HTMLElement>('.document-tab[data-tab-path="'+CSS.escape(path)+'"]')?.getBoundingClientRect()??trigger;if(!start)return;
 const move=()=>{if(!pointerMotion())return;const target=document.querySelector<HTMLElement>('.dsh-context-card[data-context-path="'+CSS.escape(path)+'"]')?.getBoundingClientRect();if(!target)return;const chip=document.createElement('span');chip.className='motion-reference-chip';chip.setAttribute('aria-hidden','true');chip.textContent='↗  '+label;Object.assign(chip.style,{left:start.left+'px',top:start.top+'px'});document.body.append(chip);const width=chip.getBoundingClientRect().width,dx=target.left+Math.min(target.width-width,20)-start.left,dy=target.top-start.top;const frames=pathFrames(-dx,-dy,1,1,true).map((f,i)=>({...f,transform:`translate3d(${dx}px,${dy}px,0) `+f.transform,opacity:i===0?0:i===8?0:1}));const animation=chip.animate(frames,{duration:motion.layout,easing:motion.move});animation.finished.catch(()=>{}).finally(()=>chip.remove());};
 if(current)current.finished.then(move).catch(()=>{});else requestAnimationFrame(move);
}

// An entrance belongs to one mount. Changing the global transition/input state
// must never re-enable a CSS animation and make an already-open surface enter again.
export function useSurfaceMotion(ref:RefObject<HTMLElement|null>,{instant=false,centered=false,backdrop=false}:{instant?:boolean;centered?:boolean;backdrop?:boolean}={}){
 useLayoutEffect(()=>{
  const node=ref.current;if(!node||instant||input==='keyboard'||document.documentElement.dataset.motionKind)return;
  const reduce=reducedMotion(),duration=reduce?80:backdrop||centered?motion.panel:motion.popover;
  const frames:Keyframe[]=reduce||backdrop?[{opacity:0},{opacity:1}]:centered?[{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}]:jellyFrames(0,0);
  const animation=node.animate(frames,{duration,easing:centered||backdrop?motion.out:'linear'});animation.finished.catch(()=>{});return()=>animation.cancel();
 },[ref,instant,centered,backdrop]);
}

export function useContentMotion(ref:RefObject<HTMLElement|null>,key:string){
 const previous=useRef(key),active=useRef<Animation|undefined>(undefined);
 useLayoutEffect(()=>{const changed=previous.current!==key;const old=previous.current;previous.current=key;const node=ref.current;if(!changed||!node||current)return;
  const interrupted=active.current?.playState==='running',style=interrupted?getComputedStyle(node):null,opacity=style?.opacity??'.5',transform=style?.transform??`translate3d(${['file','outline','dsh'].indexOf(key)>['file','outline','dsh'].indexOf(old)?8:-8}px,0,0)`;active.current?.cancel();
  if(input==='keyboard')return;active.current=node.animate(reducedMotion()?[{opacity},{opacity:1}]:[{opacity,transform},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:reducedMotion()?80:motion.quick,easing:motion.out});
 },[key,ref]);
 useLayoutEffect(()=>()=>active.current?.cancel(),[]);
}
