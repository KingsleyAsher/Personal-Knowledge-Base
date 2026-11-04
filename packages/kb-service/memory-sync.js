/** Memory-only protocol. Never turn an arbitrary knowledge document into memory. */
const marks=new Set(['记忆','长期记忆','memory','memories']);
export function isMemoryRecord(file){
  if(['withdrawn','retracted','deleted','pending','撤回','已撤回','已替代','历史','待确认'].includes(file.status))return false;
  const marker=v=>marks.has(String(v??'').trim().toLowerCase());
  return marker(file.kind)||marker(file.type)||(file.tags??[]).some(marker)||String(file.path??'').split('/').slice(0,-1).some(marker);
}
export function createKnowledgeMemoryProvider(dispatch,subscribe){
  return {protocol:'dsh-memory/v1',subscribe,async snapshot(context={}){
    const read=operation=>dispatch(operation,context);
    const selected=[];let offset=0,libraryId=null,policy=null;
    for(;;){
      const page=await read({op:'atlas.list',offset,limit:500});
      if(page.ok===false||page.truncated)throw Error('knowledge_memory_snapshot_incomplete');
      libraryId??=page.kbId;policy??=page.policyVersion;
      if(page.kbId!==libraryId||JSON.stringify(page.policyVersion)!==JSON.stringify(policy))throw Error('knowledge_memory_binding_changed');
      selected.push(...page.items.filter(isMemoryRecord));offset+=page.items.length;
      if(offset>=page.total)break;if(!page.items.length)throw Error('knowledge_memory_pagination_stalled');
    }
    const ids=new Map(selected.map(f=>[f.path,'kb:'+libraryId+':'+(f.entryId||f.path)]));
    const entries=[];const edges=[];const seen=new Set;
    for(const file of selected){
      const detail=await read({op:'atlas.detail',path:file.path});
      if(detail.ok===false||detail.content?.truncated||JSON.stringify(detail.policyVersion)!==JSON.stringify(policy))throw Error('knowledge_memory_source_unavailable');
      if(!isMemoryRecord(detail.file??file))continue;
      if(!detail.content?.text)continue;
      // This protocol publishes knowledge memories as read-only global records;
      // explicit project memory requires a project identity and is not promoted.
      if((file.tags??[]).some(t=>['项目记忆','project-memory'].includes(t)))continue;
      entries.push({id:ids.get(file.path),scope:'global',project:null,title:file.title||file.path,text:detail.content.text,quote:detail.content.text,origin:'knowledge',created:0,
        proofs:[{source_id:'kb:'+libraryId+':'+file.path,quote:detail.content.text}],metadata:{kind:'知识库记忆',provider:'knowledge',readOnly:true,revision:detail.content.revision,path:file.path,relations:[]}});
      const graph=await read({op:'atlas.relations',path:file.path,limit:500});
      if(graph.ok===false)throw Error('knowledge_memory_relations_unavailable');
      for(const edge of graph.edges??[]){if(!ids.has(edge.from)||!ids.has(edge.to))continue;const key=JSON.stringify([edge.from,edge.to,edge.type]);if(seen.has(key))continue;seen.add(key);edges.push({from:ids.get(edge.from),to:ids.get(edge.to),type:edge.type||'reference',reason:edge.context||edge.reason||'知识库中已记录的记忆关联'});}
    }
    const valid=new Set(entries.map(e=>e.id));for(const edge of edges)if(valid.has(edge.from)&&valid.has(edge.to))entries.find(e=>e.id===edge.from).metadata.relations.push(edge);
    return {protocol:'dsh-memory/v1',libraryId,complete:true,entries};
  }};
}
export function publishKnowledgeMemory(ctx,dispatch,subscribe){
  ctx.provide('knowledgeMemory',createKnowledgeMemoryProvider(dispatch,subscribe));
}
