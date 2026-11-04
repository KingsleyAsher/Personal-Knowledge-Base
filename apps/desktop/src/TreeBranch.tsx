import type {ReactNode,TransitionEvent} from 'react';
export default function TreeBranch({open,loaded,children}:{open:boolean;loaded:boolean;children:ReactNode}){
 const finish=(e:TransitionEvent<HTMLDivElement>)=>{if(e.target!==e.currentTarget)return;delete e.currentTarget.dataset.animating;window.dispatchEvent(new Event('kb-tree-layout'));};
 return <div className={'tree-branch'+(open&&loaded?' is-open':'')} role="group" aria-hidden={!open} inert={!open} onTransitionRun={e=>{if(e.target===e.currentTarget)e.currentTarget.dataset.animating='true';}} onTransitionEnd={finish} onTransitionCancel={finish}><div className="tree-branch-content">{children}</div></div>;
}
