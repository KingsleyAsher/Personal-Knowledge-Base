import {RelationSurface} from './Management';import FloatingWindow from './FloatingWindow';import type {FloatingWindowProps} from './FloatingWindow';
export default function RelationWindow({center,onOpen,library,...props}:Omit<FloatingWindowProps,'label'|'title'|'fullLabel'|'children'>&{library?:{kbId:string;instanceId:string};center:string;onOpen:(path:string)=>void}){
 return <FloatingWindow {...props} label="关系图浮窗" title="关系网络" fullLabel="进入完整关系界面" initialLayout={props.initialLayout??{left:Math.max(48,(innerWidth-1100)/2),top:Math.max(44,(innerHeight-870)/2),width:1100,height:870}}><RelationSurface library={library} focus={center} onPreview={onOpen}/></FloatingWindow>;
}
