import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeWorkspace,restoreWorkspace,WORKSPACE_LAYOUT_VERSION,openTab,addPane,closeWorkspaceTab,closeEmptyPane,dropTab,placeFile,setPaneCount,resizePair} from '../src/workspace-state.ts';import {createdFileName} from '../src/file-names.ts';
import {panelLayout,columnWidths} from '../src/panel-layout.ts';import {DEFAULT_SHORTCUTS,normalizeShortcut,shortcutIssues,validateShortcuts,shortcutFromEvent} from '../main/shortcuts.js';
import {raiseToolWindow,toolWindowZ} from '../src/tool-windows.ts';
import {columnEditing,markdownView,setColumnEditing,setMarkdownView} from '../src/editor-mode.ts';
const pane=(id,paths,weight=1)=>({id,active:paths[0]??'',tabs:paths.map(path=>({path,pinned:true})),weight});
const paths=s=>s.panes.flatMap(p=>p.tabs.map(t=>t.path)).sort();
test('four files open in separate columns; the fifth becomes a tab and existing files focus',()=>{
 let s=normalizeWorkspace([pane('main',['a'])]);for(const p of ['b','c','d'])s=openTab(s,p);assert.equal(s.panes.length,4);const fourth=s.activePane;s=openTab(s,'e');assert.equal(s.panes.length,4);assert.equal(s.activePane,fourth);assert.deepEqual(paths(s),['a','b','c','d','e']);s=openTab(s,'a');assert.equal(s.activePane,'main');
 s=setPaneCount(s,1);s=setPaneCount(s,4);const empty=s.panes[1].id;s=openTab(s,'f');assert.equal(s.activePane,empty);assert.equal(s.panes.length,4);
});
test('dragging between columns conserves tabs and collapses only the emptied source',()=>{
 const before=normalizeWorkspace([pane('a',['one','two']),pane('b',['three']),pane('c',['four'])],'a');const snapshot=JSON.stringify(before);
 let s=dropTab(before,{paneId:'a',path:'two'},{kind:'merge',paneId:'b',index:0});assert.deepEqual(paths(s),paths(before));assert.deepEqual(s.panes[1].tabs.map(t=>t.path),['two','three']);assert.equal(JSON.stringify(before),snapshot);
 s=dropTab(s,{paneId:'c',path:'four'},{kind:'merge',paneId:'b'});assert.equal(s.panes.length,2);assert.equal(s.activePane,'b');assert.deepEqual(paths(s),paths(before));
});
test('dragging creates the fourth column, never a fifth, and merging preserves every tab',()=>{
 let s=normalizeWorkspace([pane('a',['one','two']),pane('b',['three']),pane('c',['four'])]);s=dropTab(s,{paneId:'a',path:'two'},{kind:'split',index:3});assert.equal(s.panes.length,4);assert.deepEqual(paths(s),['four','one','three','two']);
 const noRoom=normalizeWorkspace([pane('a',['one','two']),pane('b',['three']),pane('c',['four']),pane('d',['five'])]);assert.deepEqual(dropTab(noRoom,{paneId:'a',path:'one'},{kind:'split',index:4}),noRoom);
 s=dropTab(noRoom,{paneId:'b',path:'three'},{kind:'split',index:4});assert.equal(s.panes.length,4);assert.equal(s.panes[3].active,'three');assert.deepEqual(paths(s),paths(noRoom));
 s=dropTab(s,{paneId:s.panes[3].id,path:'three'},{kind:'merge',paneId:'a'});assert.equal(s.panes.length,3);assert.deepEqual(paths(s),paths(noRoom));
});
test('existing three-column saved layouts remain intact and four-column layouts restore',()=>{
 const old=[pane('a',['one']),pane('b',['two']),pane('c',['three'])],s=restoreWorkspace(old,'b',WORKSPACE_LAYOUT_VERSION);assert.equal(s.panes.length,3);assert.equal(s.activePane,'b');
 const four=restoreWorkspace([...old,pane('d',['four'])],'d',WORKSPACE_LAYOUT_VERSION);assert.equal(four.panes.length,4);assert.equal(four.activePane,'d');
 assert.equal(restoreWorkspace(old,'a').panes.length,3);
});
test('creation retains the chosen format, adds missing extensions and rejects path input',()=>{
 assert.equal(createdFileName('1111','csv'),'1111.csv');assert.equal(createdFileName('报告.txt','docx'),'报告.docx');assert.equal(createdFileName('版本.v2','md'),'版本.v2.md');assert.equal(createdFileName('数据.XLSX','xlsx'),'数据.XLSX');assert.throws(()=>createdFileName('../outside','md'));assert.throws(()=>createdFileName('  ','md'));
});
test('reorder and merge duplicate views preserve one target tab; closing last tab leaves a usable workspace',()=>{
 let s=normalizeWorkspace([pane('a',['one','two','three']),pane('b',['one'])]);s=dropTab(s,{paneId:'a',path:'three'},{kind:'merge',paneId:'a',index:0});assert.deepEqual(s.panes[0].tabs.map(t=>t.path),['three','one','two']);
 s=dropTab(s,{paneId:'b',path:'one'},{kind:'merge',paneId:'a'});assert.equal(s.panes.length,1);assert.equal(s.panes[0].tabs.filter(t=>t.path==='one').length,1);
 for(const p of [...s.panes[0].tabs])s=closeWorkspaceTab(s,s.panes[0].id,p.path);assert.equal(s.panes.length,0);assert.equal(s.activePane,'');s=openTab(s,'new');assert.equal(s.panes.length,1);
});
test('width changes affect adjacent columns only; reducing column count keeps every file and active view',()=>{
 let s=normalizeWorkspace([pane('a',['one']),pane('b',['two']),pane('c',['three','four'])],'c');const third=s.panes[2].weight;s=resizePair(s,0,25);assert.equal(s.panes[2].weight,third);assert(Math.abs(s.panes.reduce((n,p)=>n+p.weight,0)-100)<1e-8);
 s=setPaneCount(s,1);assert.deepEqual(paths(s),['four','one','three','two']);assert.equal(s.panes[0].active,'three');assert.equal(s.panes[0].weight,100);
});
test('closing the last tab removes only its column, chooses a surviving focus and leaves a usable final workspace',()=>{
 let s=normalizeWorkspace([pane('a',['one']),pane('b',['two']),pane('c',['three'])],'b');s=closeWorkspaceTab(s,'b','two');assert.deepEqual(s.panes.map(p=>p.id),['a','c']);assert.equal(s.activePane,'c');s=closeWorkspaceTab(s,'c','three');s=closeWorkspaceTab(s,'a','one');assert.equal(s.panes.length,0);assert.equal(s.activePane,'');
});
test('closing a middle column transfers its width to the left neighbor without changing other weights or prior state',()=>{
 const before=normalizeWorkspace([pane('a',['one','extra'],20),{...pane('b',['two'],25),editing:false},pane('c',['three'],30),pane('d',['four'],25)],'b'),snapshot=JSON.stringify(before);
 const s=closeWorkspaceTab(before,'b','two');assert.deepEqual(s.panes.map(p=>[p.id,p.weight]),[['a',45],['c',30],['d',25]]);assert.equal(s.activePane,'c');assert.deepEqual(paths(s),['extra','four','one','three']);assert.equal(JSON.stringify(before),snapshot);
 const tabOnly=closeWorkspaceTab(before,'a','extra');assert.deepEqual(tabOnly.panes.map(p=>p.weight),before.panes.map(p=>p.weight));assert.equal(tabOnly.panes[1].editing,false);
 const first=closeWorkspaceTab(before,'a','one');const removedFirst=closeWorkspaceTab(first,'a','extra');assert.deepEqual(removedFirst.panes.map(p=>[p.id,p.weight]),[['b',45],['c',30],['d',25]]);
});
test('explicit empty-column close uses the same neighboring-width rule and cannot close a populated column',()=>{
 const before=normalizeWorkspace([pane('a',['one'],35),{...pane('empty',[],25),manualEmpty:true},pane('c',['three'],40)],'empty');
 const s=closeEmptyPane(before,'empty');assert.deepEqual(s.panes.map(p=>[p.id,p.weight]),[['a',60],['c',40]]);assert.equal(s.activePane,'c');assert.equal(closeEmptyPane(before,'a'),before);assert.equal(closeEmptyPane(before,'missing'),before);
 assert.deepEqual(closeEmptyPane(normalizeWorkspace([{...pane('only',[]),manualEmpty:true}]),'only'),{panes:[],activePane:''});
});
test('panel limits protect adjacent surfaces on window resize and columns cannot swallow their neighbors',()=>{
 for(const width of [1000,1280,1664,2048])for(const side of ['left','right']){const p=panelLayout(width,side==='left'?100000:272,side==='right'?100000:316,true,true,3);assert(p.left>=220&&p.right>=260);assert(width-48-6-p.left-p.right>=p.centerMin-.01);assert(p.left<=width*.6&&p.right<=width*.6);}
 const p=panelLayout(1664,272,316,true,true,3);assert(p.leftMax>420&&p.rightMax>440);
 const sizes=columnWidths([99,.5,.5],1000);assert(sizes.every(n=>n>=200));assert(Math.abs(sizes.reduce((a,b)=>a+b,0)-1000)<.001);assert.equal(Math.max(...sizes),600);
});
test('shortcut validation identifies duplicate action names and reserved-key sources without persisting conflicts',()=>{
 assert.deepEqual(validateShortcuts({}),DEFAULT_SHORTCUTS);assert.equal(normalizeShortcut('shift+control+o'),'Ctrl+Shift+O');assert.equal(shortcutFromEvent({key:'O',ctrlKey:true,shiftKey:true}),'Ctrl+Shift+O');
 const issues=shortcutIssues({...DEFAULT_SHORTCUTS,quickOpen:'Ctrl+S'});assert(issues.quickOpen.some(s=>s.includes('保存当前文档')));assert(issues.save.some(s=>s.includes('快速打开文件')));assert.throws(()=>validateShortcuts({...DEFAULT_SHORTCUTS,quickOpen:'Ctrl+S'}));
 assert(shortcutIssues({...DEFAULT_SHORTCUTS,quickOpen:'Ctrl+C'}).quickOpen[0].includes('复制'));assert.equal(validateShortcuts({...DEFAULT_SHORTCUTS,quickOpen:'Ctrl+Alt+O'}).quickOpen,'Ctrl+Alt+O');
});
test('most recently opened or activated tool is topmost without duplicate windows or crossing modal layers',()=>{
 let order=raiseToolWindow([],'relation');order=raiseToolWindow(order,'inbox');assert(toolWindowZ(order,'inbox')>toolWindowZ(order,'relation'));order=raiseToolWindow(order,'relation');assert(toolWindowZ(order,'relation')>toolWindowZ(order,'inbox'));assert.deepEqual(order,['inbox','relation']);
 order=raiseToolWindow(order,'search');assert(toolWindowZ(order,'search')>toolWindowZ(order,'relation'));for(const kind of ['settings','sort','library'])order=raiseToolWindow(order,kind);assert(toolWindowZ(order,'library')<240);
});
test('column editing locks survive normalization and layout changes',()=>{
 let s=normalizeWorkspace([{...pane('a',['one']),editing:false},{...pane('b',['two']),editing:true}]);s=setPaneCount(s,3);assert.equal(s.panes.find(p=>p.id==='a').editing,false);s=resizePair(s,0,25);assert.equal(s.panes.find(p=>p.id==='a').editing,false);assert.equal(s.panes.find(p=>p.id==='b').editing,true);
});
test('search/tree drops create a fourth column, merge as tabs, and respect the limit',()=>{
 let s=normalizeWorkspace([pane('a',['one']),pane('b',['two']),pane('c',['three'])]);s=placeFile(s,'four',{kind:'split',index:3});assert.equal(s.panes.length,4);assert.equal(s.panes[3].active,'four');const full=s;s=placeFile(s,'five',{kind:'split',index:4});assert.deepEqual(s,full);
 s=placeFile(s,'one',{kind:'merge',paneId:'b'});assert.equal(s.panes.find(p=>p.id==='b').tabs.filter(t=>t.path==='one').length,1);assert.equal(DEFAULT_SHORTCUTS.quickSearch,'Alt+F');
 for(const width of [1000,1280,1664,2048]){const p=panelLayout(width,100000,100000,true,true,4);assert(p.left>=220&&p.right>=260);assert(width-54-p.left-p.right>=p.centerMin-.01);}assert(columnWidths([99,.1,.1,.1],1000).every(w=>w>=200));
});
test('Markdown edit action recovers a locked column and the switch enters the matching view without bypassing permissions',()=>{
 let p={...pane('a',['交互记录.md']),editing:false};assert.equal(columnEditing(p,'交互记录.md','markdown',true),false);p=setMarkdownView(p,'交互记录.md','source');assert.equal(p.editing,true);assert.equal(columnEditing(p,'交互记录.md','markdown',true),true);assert.equal(columnEditing(p,'交互记录.md','markdown',false),false);
 p=setColumnEditing(p,'交互记录.md','markdown',false);assert.equal(markdownView(p,'交互记录.md'),'read');p=setColumnEditing(p,'交互记录.md','markdown',true);assert.equal(markdownView(p,'交互记录.md'),'source');
});
test('Markdown view is independent per column and survives workspace normalization',()=>{
 const a=setMarkdownView(pane('a',['same.md']),'same.md','source'),b=setMarkdownView(pane('b',['same.md']),'same.md','read');const s=normalizeWorkspace([a,b]);assert.equal(markdownView(s.panes[0],'same.md'),'source');assert.equal(markdownView(s.panes[1],'same.md'),'read');assert.equal(columnEditing(s.panes[1],'same.md','markdown',true),false);
});

test('only deliberately added empty panes survive; opening and closing their first file removes them',()=>{
 let s=normalizeWorkspace([pane('a',['one']),pane('unused',[])]);assert.equal(s.panes.length,1);s=addPane(s);const manual=s.panes[1].id;assert.equal(s.panes.length,2);assert.equal(s.panes[1].manualEmpty,true);
 s=restoreWorkspace(s.panes,manual,WORKSPACE_LAYOUT_VERSION);assert.equal(s.panes.length,2);s=openTab(s,'two');assert.equal(s.activePane,manual);assert(!s.panes[1].manualEmpty);s=closeWorkspaceTab(s,manual,'two');assert.equal(s.panes.length,1);
});
test('moving the sole tab closes its source even below capacity; zero-column workspaces restore and reopen safely',()=>{
 let s=normalizeWorkspace([pane('a',['one']),pane('b',['two'])]);s=dropTab(s,{paneId:'a',path:'one'},{kind:'split',index:2});assert.equal(s.panes.length,2);assert(s.panes.every(p=>p.tabs.length));assert.equal(s.panes[1].active,'one');
 s=dropTab(s,{paneId:'a',path:'one'},{kind:'merge',paneId:'b'});assert.equal(s.panes.length,1);for(const t of [...s.panes[0].tabs])s=closeWorkspaceTab(s,'b',t.path);assert.equal(s.panes.length,0);s=restoreWorkspace(s.panes,s.activePane,WORKSPACE_LAYOUT_VERSION);assert.equal(s.panes.length,0);s=openTab(s,'again','missing-previous-pane');assert.equal(s.panes.length,1);assert.equal(s.panes[0].active,'again');
 const manual=setPaneCount(normalizeWorkspace([]),4);assert.equal(manual.panes.length,4);assert(manual.panes.every(p=>p.manualEmpty));
});
