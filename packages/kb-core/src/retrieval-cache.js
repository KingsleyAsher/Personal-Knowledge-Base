// Retained-cache accounting, not a process RSS cap. Oversized values still
// participate in the current operation; eviction never changes search scope.
export function createByteCache({ maxBytes, maxEntries = 32768, sizeOf }) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxEntries)||maxEntries<1||typeof sizeOf!=='function')throw new TypeError('Invalid cache budget')
  const items=new Map()
  let used=0,evictions=0,bypasses=0
  const remove=key=>{const old=items.get(key);if(!old)return false;used-=old.cost;return items.delete(key)}
  return {
    get size(){return items.size},
    get(key){const entry=items.get(key);if(!entry)return undefined;items.delete(key);items.set(key,entry);return entry.value},
    cost:key=>items.get(key)?.cost,
    set(key,value,cost=sizeOf(value)+String(key).length*2+128){
      remove(key)
      if(!Number.isFinite(cost)||cost<0||cost>maxBytes){bypasses++;return}
      while(used+cost>maxBytes||items.size>=maxEntries){remove(items.keys().next().value);evictions++}
      items.set(key,{value,cost});used+=cost
    },
    delete:remove,keys:()=>items.keys(),
    clear(){items.clear();used=0},
    stats:()=>({entries:items.size,estimatedBytes:used,maxBytes,evictions,bypasses}),
  }
}
