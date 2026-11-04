export function assertLibraryScope(expected,actual){
 if(!expected||!actual||expected.kbId!==actual.kbId||expected.instanceId!==actual.instanceId)throw Object.assign(Error('知识库已切换，请重新打开当前库的关系图谱。'),{code:'BINDING_CHANGED'});
}
export async function withLibraryScope(manager,expected,operation){
 const original=manager.status().library;assertLibraryScope(expected??original,original);
 const result=await operation();assertLibraryScope(original,manager.status().library);return result;
}
