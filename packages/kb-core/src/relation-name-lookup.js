// Accelerates the existing substring suggestions. Every candidate is still
// checked with includes(); hitting the index budget scans the uncovered tail.
export function createNameLookup(names, maxIndexBytes=16*1024*1024) {
  const entries=[...names],postings=new Map(),memo=new Map()
  let covered=0,estimatedBytes=0
  for(const [id,[name]] of entries.entries()) {
    let complete=true
    for(let at=0;at+3<=name.length;at++) {
      const gram=name.slice(at,at+3),old=postings.get(gram)
      if(old?.at(-1)===id)continue
      const cost=(old?0:160)+16
      if(estimatedBytes+cost>maxIndexBytes){complete=false;break}
      if(!old)postings.set(gram,[])
      postings.get(gram).push(id);estimatedBytes+=cost
    }
    if(!complete)break
    covered=id+1
  }
  return {
    find(needle) {
      if(memo.has(needle))return [...memo.get(needle)]
      let ids=null
      if(needle.length>=3) {
        for(let at=0;at+3<=needle.length;at++) {
          const rows=postings.get(needle.slice(at,at+3))||[]
          if(!ids||rows.length<ids.length)ids=rows
          if(!ids.length)break
        }
      }
      const paths=[],seen=new Set()
      const add=id=>{
        const [name,values]=entries[id]
        if(!name.includes(needle))return
        for(const value of values)if(!seen.has(value)){seen.add(value);paths.push(value);if(paths.length===12)return}
      }
      if(ids)for(const id of ids){if(id<covered)add(id);if(paths.length===12)break}
      if(paths.length<12)for(let id=ids?covered:0;id<entries.length;id++){add(id);if(paths.length===12)break}
      if(needle.length<=2048){if(memo.size>=256)memo.delete(memo.keys().next().value);memo.set(needle,[...paths])}
      return paths
    },
    stats:()=>({names:entries.length,indexedNames:covered,estimatedBytes,maxIndexBytes}),
  }
}
