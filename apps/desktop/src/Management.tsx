import themeCss from '../../../src/client/knowledge-ui.css?raw';import * as React from 'react';import {createPortal} from 'react-dom';import {api} from './types';import {FlowsPanel,ParsingPanel} from './EnginesPanel';
// @ts-ignore Generated from the same audited factory as the existing plugin.
import {createWorkbenchUI} from './generated-management.js';
// @ts-ignore The operation registry is a runtime JS contract shared by both apps.
import {READ_OPERATIONS} from '../../../packages/kb-service/operations.js';
const e=React.createElement;
function makeUI(library?:{kbId:string;instanceId:string}){return createWorkbenchUI({react:React,e,themeCss,api:async(body:any)=>{
 const aliases:Record<string,string>={'import-run':'import.run','import-cancel':'import.cancel'};const op=aliases[body.op]??body.op;
 if(op==='index.policy.set')return api('policy',{paths:body.paths??[body.path],excluded:body.excluded,expectedRevision:body.expectedPolicyRevision});
 return api('knowledge',{expectedLibrary:library,operation:{...body,op},requestId:body.requestId,write:!READ_OPERATIONS.has(op)});
},ctx:()=>null,Overview:()=>null,Flows:FlowsPanel,Parsing:ParsingPanel,BuildBadge:()=>e('small',null,'交互联动候选 · 共库服务'),version:'0.5.0',projectRecordUrl:'',portal:createPortal,ReferenceChip:({label}:any)=>e('span',null,label),eventSubscribe:(listener:any)=>window.kbDesktop.onEvent(event=>{if(['snapshot.required','connection.changed'].includes(event.type))listener(event);}),organizeInbox:()=>api('organizeInbox')});}
export function RelationSurface({library,...props}:{library?:{kbId:string;instanceId:string};focus:string;onPreview:(path:string)=>void}){const scoped=React.useMemo(()=>makeUI(library),[library?.kbId,library?.instanceId]);return library?<div data-relation-library={library.instanceId}><scoped.RelationSurface {...props}/></div>:<p>正在连接当前知识库…</p>;}
export default function Management({library}:{library?:{kbId:string;instanceId:string}}){const scoped=React.useMemo(()=>makeUI(library),[library?.kbId,library?.instanceId]);return <scoped.Management key={library?.instanceId}/>;}
export function UpgradeSurface({library}:{library?:{kbId:string;instanceId:string}}){const scoped=React.useMemo(()=>makeUI(library),[library?.kbId,library?.instanceId]);return library?<scoped.UpgradeSettings key={library.instanceId}/>:<p>正在连接当前知识库…</p>;}
