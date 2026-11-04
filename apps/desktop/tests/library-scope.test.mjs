import {test} from 'node:test';import assert from 'node:assert/strict';import {assertLibraryScope,withLibraryScope} from '../main/library-scope.js';import {COLOR_THEMES} from '../main/theme-palettes.js';
test('relation scope rejects other libraries including copied kbId with different instance',async()=>{
 const a={kbId:'a',instanceId:'1'},b={kbId:'b',instanceId:'2'};let current=a,calls=0;const manager={status:()=>({library:current})};
 assert.throws(()=>assertLibraryScope(a,{...a,instanceId:'clone'}),{code:'BINDING_CHANGED'});
 await assert.rejects(withLibraryScope(manager,b,async()=>{calls++}),{code:'BINDING_CHANGED'});assert.equal(calls,0);
 await assert.rejects(withLibraryScope(manager,a,async()=>{current=b;return {nodes:['A-only']}}),{code:'BINDING_CHANGED'});
 assert.deepEqual(await withLibraryScope(manager,b,async()=>({nodes:['B-only']})),{nodes:['B-only']});
});
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
test('independently authored light and dark palettes retain readable text',()=>{
 for(const t of COLOR_THEMES)for(const mode of ['light','dark']){const c=t[mode];for(const foreground of ['text','muted']){const v=[luminance(c[foreground]),luminance(c.surface)].sort((a,b)=>a-b);assert.ok((v[1]+.05)/(v[0]+.05)>=4.5,t.id+' '+mode+' '+foreground);}}
});
