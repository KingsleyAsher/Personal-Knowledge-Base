export type ToolWindow='relation'|'relationPreview'|'inbox'|'trash'|'search'|'library'|'sort'|'settings'|'backups'|'tasks';
export function raiseToolWindow(order:ToolWindow[],id:ToolWindow){return order.at(-1)===id?order:[...order.filter(k=>k!==id),id];}
export function toolWindowZ(order:ToolWindow[],id:ToolWindow){return 130+Math.max(0,order.indexOf(id))*10;}
