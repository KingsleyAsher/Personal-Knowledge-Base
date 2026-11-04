export const SHORTCUT_COMMANDS=Object.freeze([
 {id:'quickOpen',label:'快速打开文件',default:'Ctrl+O'},
 {id:'save',label:'保存当前文档',default:'Ctrl+S'},
 {id:'search',label:'全局搜索',default:'Ctrl+Shift+F'},
 {id:'quickSearch',label:'呼出全局搜索浮窗',default:'Alt+F'},
 {id:'find',label:'查找文本内容',default:'Ctrl+F'},
 {id:'dsh',label:'打开 DSH 聊天',default:'Ctrl+Shift+D'},
 {id:'rename',label:'重命名文件',default:'F2'},
 {id:'toggleLeft',label:'展开或收起文件栏',default:'Ctrl+B'},
 {id:'toggleRight',label:'展开或收起右侧栏',default:'Ctrl+Shift+B'},
 {id:'closeTab',label:'关闭当前标签',default:'Ctrl+W'},
 {id:'relations',label:'打开关系图浮窗',default:''},
]);
export const DEFAULT_SHORTCUTS=Object.freeze(Object.fromEntries(SHORTCUT_COMMANDS.map(c=>[c.id,c.default])));
const reserved={
 'Ctrl+C':'文本编辑器 · 复制','Ctrl+X':'文本编辑器 · 剪切','Ctrl+V':'文本编辑器 · 粘贴','Ctrl+A':'文本编辑器 · 全选','Ctrl+Z':'文本编辑器 · 撤销','Ctrl+Y':'文本编辑器 · 重做','Ctrl+Shift+Z':'文本编辑器 · 重做',
 'Ctrl+P':'文档 · 打印','Ctrl+R':'桌面运行环境 · 刷新页面','Ctrl+Shift+R':'桌面运行环境 · 强制刷新','F5':'桌面运行环境 · 刷新页面','F12':'桌面运行环境 · 开发者工具','Ctrl+Shift+I':'桌面运行环境 · 开发者工具',
 'Alt+F4':'Windows · 关闭窗口','Alt+Tab':'Windows · 切换窗口','Ctrl+Alt+Delete':'Windows · 安全选项','Meta+L':'Windows · 锁定设备','Ctrl+G':'代码编辑器 · 跳转到行','Ctrl+H':'代码编辑器 · 替换','Ctrl+Space':'代码编辑器 · 补全',
};
const keyAliases={space:'Space',spacebar:'Space',escape:'Escape',esc:'Escape',enter:'Enter',return:'Enter',tab:'Tab',backspace:'Backspace',delete:'Delete',arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',',':'Comma',comma:'Comma','.':'Period',period:'Period','/':'Slash',slash:'Slash','-':'Minus',minus:'Minus','=':'Equal',equal:'Equal'};
export function normalizeShortcut(input){
 if(typeof input!=='string'||input.length>48)return null;if(!input.trim())return '';
 const parts=input.split('+').map(p=>p.trim()),modifiers=new Set(),keys=[];
 for(const part of parts){const p=part.toLowerCase(),m=['ctrl','control'].includes(p)?'Ctrl':p==='alt'?'Alt':p==='shift'?'Shift':['meta','win','cmd','command'].includes(p)?'Meta':null;if(m){if(modifiers.has(m))return null;modifiers.add(m);}else keys.push(part);}
 if(keys.length!==1)return null;const raw=keys[0],key=keyAliases[raw.toLowerCase()]??(/^[a-z0-9]$/i.test(raw)?raw.toUpperCase():/^F([1-9]|1[0-2])$/i.test(raw)?raw.toUpperCase():null);
 if(!key||(!/^F\d+$/.test(key)&&!modifiers.has('Ctrl')&&!modifiers.has('Alt')&&!modifiers.has('Meta')))return null;
 return [...['Ctrl','Alt','Shift','Meta'].filter(m=>modifiers.has(m)),key].join('+');
}
export function shortcutFromEvent(event){
 if(event.isComposing||['Control','Alt','Shift','Meta','AltGraph','Dead','Process','Unidentified'].includes(event.key))return '';
 const key=event.key===' '?'Space':event.key;
 return normalizeShortcut([event.ctrlKey?'Ctrl':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',event.metaKey?'Meta':'',key].filter(Boolean).join('+'))??key;
}
export function shortcutIssues(bindings){
 const issues={},normalized={};for(const c of SHORTCUT_COMMANDS){const value=normalizeShortcut(bindings[c.id]??'');normalized[c.id]=value;if(value===null)issues[c.id]=['使用 Ctrl / Alt / Win 组合键，或 F1–F12'];else if(value&&reserved[value])issues[c.id]=['与“'+reserved[value]+'”冲突'];}
 for(const c of SHORTCUT_COMMANDS){const value=normalized[c.id];if(!value)continue;for(const other of SHORTCUT_COMMANDS)if(other.id!==c.id&&normalized[other.id]===value)(issues[c.id]??=[]).push('与“'+other.label+'”冲突');}
 return issues;
}
export function validateShortcuts(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_SHORTCUTS,k)))throw Error('快捷键配置无效');
 const full={...DEFAULT_SHORTCUTS,...input},issues=shortcutIssues(full);if(Object.keys(issues).length){const id=Object.keys(issues)[0];throw Error(SHORTCUT_COMMANDS.find(c=>c.id===id).label+'：'+issues[id].join('；'));}
 return Object.fromEntries(SHORTCUT_COMMANDS.map(c=>[c.id,normalizeShortcut(full[c.id])]));
}
export function safeShortcuts(input){try{return validateShortcuts(input??{});}catch{return {...DEFAULT_SHORTCUTS};}}
