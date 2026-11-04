const str=(max=4096)=>({type:'string',min:1,max});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
const integer=(max)=>({type:'integer',min:0,max});
const optional=(properties)=>obj(properties,[]);
export const DESKTOP_METHODS=Object.freeze({
 'desktop.list':{access:'read',args:optional({parent:{type:'string',max:4096},offset:integer(10000),limit:{type:'integer',min:1,max:500}})},
 'desktop.listSorted':{access:'read',args:optional({parent:{type:'string',max:4096},offset:integer(10000),limit:{type:'integer',min:1,max:500},sort:{type:'string',enum:['name-asc','name-desc','modified-desc','modified-asc']}})},
 'desktop.stat':{access:'read',args:obj({path:str()})},
 'desktop.preview':{access:'read',args:obj({path:str()})},
 'desktop.trashPreview':{access:'read',args:obj({id:str(128),path:{type:'string',max:4096}},['id'])},
 'desktop.editOriginal':{access:'read',args:obj({path:str(),originalKey:str(128)})},
 'desktop.fileReplace':{access:'edit',idempotent:true,args:obj({path:str(),expectedRevision:str(128),stageId:str(128)})},
 'desktop.editStage':{access:'edit',args:obj({name:str(255),data:{type:'string',max:360000},stageId:{type:'string',max:128},final:{type:'boolean'}},['name','data','final'])},
 'desktop.media':{access:'read',args:obj({handle:str(128),offset:integer(1073741824),length:{type:'integer',min:1,max:262144}})},
 'desktop.search':{access:'read',args:obj({query:str(4096),mode:{type:'string',enum:['name','fulltext']}})},
 'desktop.plan':{access:'write',args:obj({operation:{type:'string',enum:['create','mkdir','move','trash','restore','purge','import']},path:{type:'string',max:4096},destination:{type:'string',max:4096},revision:{type:'string',max:128}},['operation'])},
 'desktop.commit':{access:'write',idempotent:true,args:obj({planId:str(128),text:{type:'string',max:524288}},['planId'])},
 'desktop.trash':{access:'read',args:obj({})},
 'desktop.backups':{access:'read',args:obj({})},
 'desktop.backupCreate':{access:'admin',idempotent:true,args:obj({})},
 'desktop.backupDelete':{access:'admin',idempotent:true,args:obj({backupId:str(128),expectedDigest:str(64)})},
 'desktop.restorePreview':{access:'admin',args:obj({backupId:str(128)})},
 'desktop.restoreCommit':{access:'admin',idempotent:true,args:obj({planId:str(128)})},
 'desktop.restoreState':{access:'admin',idempotent:true,args:obj({})},
 'desktop.tasks':{access:'read',args:obj({})},
 'desktop.importStage':{access:'write',args:obj({name:str(255),data:{type:'string',max:360000},stageId:{type:'string',max:128},final:{type:'boolean'}},['name','data','final'])},
 'desktop.importPlan':{access:'write',args:obj({stageId:str(128),destination:str()})},
});

