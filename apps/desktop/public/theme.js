(()=>{
 let stored='system';try{const value=JSON.parse(localStorage.getItem('kb-preview-theme')||'"system"');if(['light','dark','system'].includes(value))stored=value;}catch{}
 const bridge=window.kbDesktop,choice=bridge?.startupPreference??stored;
 const mode=['light','dark'].includes(bridge?.startupTheme)?bridge.startupTheme:choice==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):choice;
 let palette=bridge?.startupPalette;try{palette??=localStorage.getItem('kb-palette');}catch{}
 document.documentElement.dataset.palette=['default','iris','ocean','jade','sand','rose','graphite'].includes(palette)?palette:'default';
 document.documentElement.dataset.theme=mode;document.documentElement.dataset.themePreference=choice;
})();

