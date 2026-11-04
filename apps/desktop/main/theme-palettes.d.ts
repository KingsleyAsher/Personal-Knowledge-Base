export interface ColorTheme {id:string;name:string;description:string;preferredMode?:'light'|'dark';light:Record<string,string>;dark:Record<string,string>}
export const COLOR_THEMES:ColorTheme[];
export function validPalette(id:unknown):id is string;
export function paletteForMode(id:string,mode:string):string;
export function normalizePalette(id:unknown):string;
