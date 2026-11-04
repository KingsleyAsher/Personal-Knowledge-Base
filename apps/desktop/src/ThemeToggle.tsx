import {Sun,Moon} from 'lucide-react';
export default function ThemeToggle({theme,onToggle}:{theme:'light'|'dark';onToggle:()=>void}){return <button className="theme-icon icon-button" aria-label="切换主题" data-current-theme={theme} title={theme==='dark'?'当前深色，切换为浅色':'当前浅色，切换为深色'} onClick={onToggle}>{theme==='dark'?<Moon size={17}/>:<Sun size={17}/>}</button>;}
