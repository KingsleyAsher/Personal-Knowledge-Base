export interface ShortcutCommand {id:string;label:string;default:string}
export const SHORTCUT_COMMANDS:readonly ShortcutCommand[];
export const DEFAULT_SHORTCUTS:Readonly<Record<string,string>>;
export function normalizeShortcut(input:unknown):string|null;
export function shortcutFromEvent(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'|'isComposing'>):string;
export function shortcutIssues(bindings:Record<string,string>):Record<string,string[]>;
export function validateShortcuts(input:unknown):Record<string,string>;
export function safeShortcuts(input:unknown):Record<string,string>;
