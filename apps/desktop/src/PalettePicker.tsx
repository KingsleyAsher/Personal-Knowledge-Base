import type {CSSProperties} from 'react';import {Check} from 'lucide-react';import {COLOR_THEMES} from '../main/theme-palettes.js';import './palette-picker.css';
export default function PalettePicker({value,mode,onChange,compact=false}:{value:string;mode:'light'|'dark';onChange:(id:string,anchor?:DOMRect)=>void;compact?:boolean}){
 return <section className={'palette-picker'+(compact?' compact':'')}><div className="palette-heading"><strong>配色主题</strong><span>浅色与深色独立设计</span></div><div className="palette-grid" role="radiogroup" aria-label="配色主题">{COLOR_THEMES.map((t,index)=>{
 const colors=t[t.preferredMode??mode],style=Object.fromEntries(Object.entries(colors).map(([k,v])=>['--preview-'+k,v])) as CSSProperties;
 return <button key={t.id} className={'palette-card'+(value===t.id?' selected':'')} data-palette-id={t.id} role="radio" aria-label={t.name} aria-checked={value===t.id} tabIndex={value===t.id?0:-1} style={style} onClick={e=>onChange(t.id,e.currentTarget.getBoundingClientRect())} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const next=(index+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+COLOR_THEMES.length)%COLOR_THEMES.length,button=e.currentTarget.parentElement?.children[next] as HTMLButtonElement;onChange(COLOR_THEMES[next].id,button?.getBoundingClientRect());button?.focus();}}>
  <span className="palette-preview" aria-hidden="true"><i className="palette-preview-sidebar"><b/><b/><b/></i><i className="palette-preview-page"><b/><b/><b/></i><i className="palette-preview-chat"/>{value===t.id?<span className="palette-check"><Check size={12}/></span>:null}</span>
  <span className="palette-name">{t.name}</span>{(!compact||t.id==='default')?<span className="palette-description">{t.description}</span>:null}
 </button>;
 })}</div></section>;
}
