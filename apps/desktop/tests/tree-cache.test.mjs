import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeCache} from '../src/tree-cache.ts';
const turn=()=>new Promise(r=>setImmediate(r));

test('reopening a branch retains all pages without another read',async()=>{
 const cache=createTreeCache();let calls=0;
 const read=()=>{calls++;return Promise.resolve({items:['first'],nextOffset:1});};
 await cache.read('a',read);cache.set('a',{items:['first','second']});
 assert.deepEqual(await cache.read('a',read),{items:['first','second']});assert.equal(calls,1);
});
test('independent branches and overlapping reads merge without dropping another branch',async()=>{
 const cache=createTreeCache();let release,calls=0;
 const a=cache.read('a',async()=>{calls++;return new Promise(r=>release=r);});await turn();
 const duplicate=cache.read('a',async()=>{throw Error('duplicate');});
 assert.equal(await cache.read('b',async()=> 'B'),'B');release('A');
 assert.deepEqual(await Promise.all([a,duplicate]),['A','A']);assert.equal(cache.get('b'),'B');assert.equal(calls,1);
});
test('an event preserves visible rows, invalidates only its branch and reruns an in-flight read',async()=>{
 const cache=createTreeCache();cache.set('a','visible');cache.set('b','unchanged');
 cache.invalidate(k=>k==='a');assert.equal(cache.get('a'),'visible');assert.equal(cache.fresh('b'),true);
 let release,calls=0;const pending=cache.read('a',async()=>{calls++;return calls===1?new Promise(r=>release=r):'newest';});await turn();
 cache.invalidate(k=>k==='a');release('stale');assert.equal(await pending,'newest');assert.equal(calls,2);
});
test('clearing for a policy/library/sort change suppresses old responses and failures can retry',async()=>{
 const cache=createTreeCache();let release;const pending=cache.read('a',()=>new Promise(r=>release=r));await turn();
 cache.clear();cache.set('a','new-library');release('old-library');assert.equal(await pending,undefined);assert.equal(cache.get('a'),'new-library');
 await assert.rejects(cache.read('b',async()=>{throw Error('offline')}),/offline/);
 assert.equal(await cache.read('b',async()=> 'recovered'),'recovered');
});
