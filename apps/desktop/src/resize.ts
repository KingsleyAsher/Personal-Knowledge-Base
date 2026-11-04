// Expensive document renderers keep their current image while a splitter moves.
// Native window resizing is settled too, so PDF canvases are not restarted for
// every intermediate pixel. The first observation is delivered immediately.
export function observeSettledSize(element:Element,change:(size:{width:number;height:number})=>void){
 let latest={width:0,height:0},first=true,timer:ReturnType<typeof setTimeout>|undefined;
 const flush=()=>{clearTimeout(timer);if(document.documentElement.dataset.resizing)return;change(latest);};
 const observer=new ResizeObserver(([entry])=>{
  latest={width:Math.floor(entry.contentRect.width),height:Math.floor(entry.contentRect.height)};
  clearTimeout(timer);if(first){first=false;flush();}else if(!document.documentElement.dataset.resizing)timer=setTimeout(flush,100);
 });
 observer.observe(element);window.addEventListener('kb-resize-end',flush);
 return()=>{observer.disconnect();clearTimeout(timer);window.removeEventListener('kb-resize-end',flush);};
}
