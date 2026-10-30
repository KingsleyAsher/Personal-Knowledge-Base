(() => {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let language=window.siteLanguage||'zh-CN';
  const uiText={
    'zh-CN':{pause:'Ⅱ 暂停动效',resume:'▷ 开启动效',pauseLabel:'暂停页面动效',resumeLabel:'开启页面动效',copied:'已复制，可粘贴保存',selected:'文字已选中，可按 Ctrl+C 复制'},
    en:{pause:'Ⅱ Pause motion',resume:'▷ Resume motion',pauseLabel:'Pause page motion',resumeLabel:'Resume page motion',copied:'Copied. You can paste it now.',selected:'Text selected. Press Ctrl+C to copy.'}
  };
  let paused=reduce.matches;
  const motion=$('#motion-toggle');
  function updateMotion(){const t=uiText[language];document.body.classList.toggle('motion-paused',paused);motion.setAttribute('aria-pressed',String(paused));motion.textContent=paused?t.resume:t.pause;motion.setAttribute('aria-label',paused?t.resumeLabel:t.pauseLabel);if(paused)$$('.reveal').forEach(el=>el.classList.add('visible'));}
  updateMotion();
  if(!paused)document.body.classList.add('js-motion');
  motion.addEventListener('click',()=>{paused=!paused;updateMotion();});
  reduce.addEventListener('change',e=>{paused=e.matches;updateMotion();});
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target);}}),{threshold:.09});
  $$('.reveal').forEach(el=>observer.observe(el));

  // Moving nodes, pointer attraction and card parallax remain code-native.
  const art=$('.hero-art'),canvas=$('#network'),ctx=canvas.getContext('2d');
  let width=700,height=600,time=0,active=true,last=0;
  const pointer={x:-999,y:-999,inside:false};
  const cards=$$('.knowledge-card');
  const points=Array.from({length:36},(_,i)=>({angle:i*2.39996,radius:.17+(i%7)*.035,x:0,y:0}));
  function sizeCanvas(){const r=art.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);paint();}
  function paint(){
    ctx.clearRect(0,0,width,height);
    for(let i=0;i<points.length;i++){
      const n=points[i],a=time*(.00012+i%3*.000018)+n.angle;
      let x=width*.59+Math.cos(a)*width*n.radius,y=height*.49+Math.sin(a)*height*n.radius*.82;
      const d=Math.hypot(pointer.x-x,pointer.y-y),near=pointer.inside&&d<240;
      if(near){const pull=(1-d/240)*.2;x+=(pointer.x-x)*pull;y+=(pointer.y-y)*pull;}
      n.x=x;n.y=y;
      const radius=i%6===0?2.7:1.25,g=ctx.createRadialGradient(x,y,0,x,y,near?22:13);
      g.addColorStop(0,near?'rgba(180,255,230,.55)':'rgba(170,255,224,.25)');g.addColorStop(1,'rgba(170,255,224,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,near?22:13,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=near?'#effff9':'#bcf5df';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
      if(near){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(pointer.x,pointer.y);ctx.strokeStyle=`rgba(174,248,224,${(1-d/240)*.6})`;ctx.lineWidth=.9;ctx.stroke();}
    }
    if(pointer.inside){const glow=ctx.createRadialGradient(pointer.x,pointer.y,2,pointer.x,pointer.y,80);glow.addColorStop(0,'rgba(180,255,228,.14)');glow.addColorStop(1,'rgba(180,255,228,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(pointer.x,pointer.y,80,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(pointer.x,pointer.y,15,0,Math.PI*2);ctx.strokeStyle='rgba(190,255,232,.55)';ctx.lineWidth=.8;ctx.stroke();}
  }
  new ResizeObserver(sizeCanvas).observe(art);
  new IntersectionObserver(([e])=>{active=e.isIntersecting;}).observe(art);
  function frame(t){if(!paused&&active&&!document.hidden&&t-last>33){time+=33;paint();last=t;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  if(matchMedia('(pointer:fine)').matches){
    let pending=false,px=0,py=0;
    document.addEventListener('pointermove',e=>{px=e.clientX;py=e.clientY;if(!paused&&!pending){pending=true;requestAnimationFrame(()=>{$('.pointer-light').style.transform=`translate(${px-240}px,${py-240}px)`;pending=false;});}},{passive:true});
    $('.hero').addEventListener('pointermove',e=>{if(paused)return;const r=art.getBoundingClientRect(),h=$('.hero').getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.inside=pointer.x>=0&&pointer.x<=r.width&&pointer.y>=0&&pointer.y<=r.height;const nx=(e.clientX-h.left)/h.width-.5,ny=(e.clientY-h.top)/h.height-.5;art.style.setProperty('--art-x',`${nx*25}px`);art.style.setProperty('--art-y',`${ny*18}px`);cards.forEach((card,i)=>{card.style.setProperty('--tilt-x',`${-ny*8}deg`);card.style.setProperty('--tilt-y',`${nx*12}deg`);card.style.setProperty('--card-x',`${nx*(12+i*2)}px`);card.style.setProperty('--card-y',`${ny*(10+i*2)}px`);});},{passive:true});
    $('.hero').addEventListener('pointerleave',()=>{pointer.x=-999;pointer.y=-999;pointer.inside=false;art.style.setProperty('--art-x','0px');art.style.setProperty('--art-y','0px');cards.forEach(card=>['--tilt-x','--tilt-y','--card-x','--card-y'].forEach(v=>card.style.removeProperty(v)));});
  }

  // Tab state changes are immediate and show authored examples in the active language.
  const parseMarkup={
    'zh-CN':{
      ocr:'<small>提取的文字内容</small><h3>山地生态系统的演变与适应</h3><p>山地生态系统是地球上最复杂、最独特的自然系统之一。地形、气候与物种之间的相互作用，塑造了丰富的生态环境。</p><h4>1 · 研究背景</h4><p>在气候变化与人类活动的共同影响下，研究者需要长期记录、对照不同时间的观察结果。</p><div class="result-source"><span>来源</span>研究资料.pdf · 第 1 页</div>',
      asr:'<small>音频转写的文字内容</small><h3>研究方法 · 语音随记</h3><p>下次做研究时，先确定问题，再把资料按主题整理。</p><p>每条笔记都标明来源，把不确定的信息单独列出来。写作时，就能沿着线索回到原文核对。</p><h4>留给下一次的线索</h4><p>研究问题 → 主题归类 → 来源核对</p><div class="result-source"><span>来源</span>语音随记.wav</div>'
    },
    en:{
      ocr:'<small>Extracted text</small><h3>Mountain ecosystems: change and adaptation</h3><p>Mountain ecosystems are among Earth’s most complex and distinctive natural systems. Interactions among terrain, climate, and species shape a rich range of habitats.</p><h4>1 · Research context</h4><p>As climate change and human activity reshape these systems, researchers need to record and compare observations over time.</p><div class="result-source"><span>Source</span>Research paper.pdf · Page 1</div>',
      asr:'<small>Transcribed audio</small><h3>Research method · Voice note</h3><p>Next time I research a topic, define the question first, then organize sources by theme.</p><p>Keep a source with every note and set uncertain details aside. When writing, follow each thread back to the original material.</p><h4>A thread for next time</h4><p>Research question → Organize by theme → Verify sources</p><div class="result-source"><span>Source</span>Voice note.wav</div>'
    }
  };
  let mode='ocr',zoom=80;
  function renderRecognition(){const audio=mode==='asr',english=language==='en';$('#result-tab-title').textContent=audio?(english?'Transcript':'转写结果'):(english?'Recognition result':'识别结果');$('#source-filename').textContent=audio?(english?'Voice note.wav':'语音随记.wav'):(english?'Research paper.pdf':'研究资料.pdf');$('#source-format').textContent=audio?(english?'WAV · Voice note':'WAV · 语音随记'):(english?'PDF · Page 1':'PDF · 第 1 页');$('#recognized').innerHTML=parseMarkup[language][mode];$('#copy-status').textContent='';}
  function selectTab(button){const list=button.closest('[role=tablist]');$$('[role=tab]',list).forEach(tab=>{const yes=tab===button;tab.setAttribute('aria-selected',String(yes));tab.tabIndex=yes?0:-1;});}
  $$('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    selectTab(button);mode=button.dataset.mode;const audio=mode==='asr';
    $('#parse-panel').setAttribute('aria-labelledby',button.id);$('#paper-viewport').hidden=audio;$('#audio-source').hidden=!audio;$('.zoom-controls').hidden=audio;
    $('#side-image').classList.toggle('selected',!audio);$('#side-audio').classList.toggle('selected',audio);
    renderRecognition();
  }));
  for(let i=0;i<27;i++){const b=document.createElement('i');b.style.height=`${12+Math.abs(Math.sin(i*1.1))*60}px`;b.style.animationDelay=`-${i*.17}s`;$('.waveform').append(b);}
  function updateZoom(){zoom=Math.max(60,Math.min(120,zoom));$('#paper').style.transform=`scale(${zoom/80})`;$('#zoom-value').textContent=`${zoom}%`;$('#zoom-out').disabled=zoom<=60;$('#zoom-in').disabled=zoom>=120;}
  $('#zoom-out').addEventListener('click',()=>{zoom-=10;updateZoom();});$('#zoom-in').addEventListener('click',()=>{zoom+=10;updateZoom();});
  $('#copy-result').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#recognized').innerText);$('#copy-status').textContent=uiText[language].copied;}catch{const range=document.createRange();range.selectNodeContents($('#recognized'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);$('#copy-status').textContent=uiText[language].selected;}});

  const cases={
    'zh-CN':{
      research:{files:[['file','研究资料.pdf'],['audio','语音随记.wav']],excerpt:'“地形、气候与物种之间的相互作用，塑造了丰富的生态环境。”\n“下次研究时，先确定问题，再把资料按主题整理。”',note:'一份研究材料，加上一段方法随记。内容相关，却尚未组织到一起。',title:'山地生态 · 主题研究笔记',outputs:[['核心线索','围绕地形、气候与物种的相互作用，建立山地生态研究主题。'],['下一步','补充长期观察与对照资料，区分气候变化和人类活动的影响。'],['方法与来源','先明确研究问题；正文关联 PDF 第 1 页，方法随记保留音频来源。']],source:'研究资料.pdf · 第 1 页 / 语音随记.wav → 主题研究笔记'},
      review:{files:[['file','项目随手记.md'],['file','阶段会议纪要.md']],excerpt:'“先完成访谈，再决定是否扩展功能。目前还缺新用户的反馈。”\n“下周先补访谈提纲，不急着进入设计。”',note:'两次讨论留下的记录。决定、理由和行动项交织在一起。',title:'项目复盘 · 先验证，再设计',outputs:[['已定方向','先完成用户访谈，暂缓扩展功能与进入设计。'],['决策依据','新用户反馈不足，现有记录尚不能支持功能取舍。'],['下一步','完善访谈提纲，补充新用户访谈，再回看功能范围。']],source:'项目随手记.md / 阶段会议纪要.md → 项目决策与行动记录'},
      inspiration:{files:[['audio','灵感随记.wav'],['image','参考图片.png']],excerpt:'“想写一个关于重新开始的故事。图片里那条通向山后的路，可以作为开场。”\n“先记住这个画面，主人公的动机还没想好。”',note:'一段转写文字、一张参考图。画面已经出现，故事方向还待展开。',title:'创作素材 · 山后的路',outputs:[['创作主题','重新开始：用一条通向山后的路作为故事的开场意象。'],['关联素材','将参考图片和语音原件放在同一条创作记录下，便于回看。'],['待展开','主人公为什么出发？把尚未确定的动机保留为问题，不替作者填空。']],source:'灵感随记.wav / 参考图片.png → 创作素材与待展开问题'}
    },
    en:{
      research:{files:[['file','Research paper.pdf'],['audio','Voice note.wav']],excerpt:'“Interactions among terrain, climate, and species shape a rich range of habitats.”\n“Next time I research a topic, define the question first, then organize sources by theme.”',note:'A research paper and a note about method. They are related, but have not yet been brought together.',title:'Mountain ecology · topic research notes',outputs:[['Key thread','Build a mountain-ecology research theme around interactions among terrain, climate, and species.'],['Next steps','Add long-term observations and comparisons to distinguish climate change from human activity.'],['Method and sources','Define the research question first. Link the paper text to page 1 and keep the method note linked to its audio source.']],source:'Research paper.pdf · Page 1 / Voice note.wav → Topic research notes'},
      review:{files:[['file','Project notes.md'],['file','Milestone meeting notes.md']],excerpt:'“Finish the interviews before deciding whether to expand the feature set. We still need feedback from new users.”\n“Next week, improve the interview guide. No need to start design yet.”',note:'Notes from two discussions. Decisions, reasons, and action items are mixed together.',title:'Project retrospective · validate before designing',outputs:[['Direction','Finish user interviews before expanding features or moving into design.'],['Why','There is not enough feedback from new users to make a grounded feature decision.'],['Next steps','Improve the interview guide, speak with new users, then revisit the feature scope.']],source:'Project notes.md / Milestone meeting notes.md → Decisions and actions'},
      inspiration:{files:[['audio','Inspiration note.wav'],['image','Reference image.png']],excerpt:'“I want to write a story about beginning again. The road in this picture, leading beyond the mountains, could open it.”\n“Keep this image for now. I have not worked out the protagonist’s motivation.”',note:'A transcribed note and a reference image. The scene is taking shape; the story still has room to unfold.',title:'Creative materials · the road beyond the mountains',outputs:[['Creative theme','Beginning again: use a road beyond the mountains as the story’s opening image.'],['Related materials','Keep the reference image and voice original with the same creative note for later review.'],['Open question','Why does the protagonist leave? Keep the unresolved motivation as a question; do not fill it in for the writer.']],source:'Inspiration note.wav / Reference image.png → Creative materials and open questions'}
    }
  };
  let currentCase='research';
  function showCase(key){currentCase=key;const c=cases[language][key];$('#source-files').replaceChildren(...c.files.map(([icon,name])=>{const span=document.createElement('span');span.className='source-file';span.innerHTML=`<svg aria-hidden="true"><use href="#i-${icon}"/></svg>`;span.append(document.createTextNode(name));return span;}));$('#case-excerpt').textContent=c.excerpt;$('#case-input-note').textContent=c.note;$('#case-output-title').textContent=c.title;$('#case-output').replaceChildren(...c.outputs.map(([label,value])=>{const row=document.createElement('div');row.className='output-row';const name=document.createElement('span'),p=document.createElement('p');name.textContent=label;p.textContent=value;row.append(name,p);return row;}));$('#case-source').textContent=c.source;}
  $$('[data-case]').forEach(button=>button.addEventListener('click',()=>{selectTab(button);$('#case-panel').setAttribute('aria-labelledby',button.id);showCase(button.dataset.case);}));showCase('research');
  document.addEventListener('site-language-change',event=>{language=event.detail.language;updateMotion();renderRecognition();showCase(currentCase);});
  $$('[role=tablist]').forEach(list=>list.addEventListener('keydown',e=>{const tabs=$$('[role=tab]',list),i=tabs.indexOf(document.activeElement);if(i<0)return;let next=i;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();tabs[next].focus();tabs[next].click();}));
  const dialog=$('#install-dialog');
  $$('[data-install]').forEach(b=>b.addEventListener('click',()=>{dialog.showModal();document.body.style.overflow='hidden';}));$('.dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{document.body.style.overflow='';});dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
})();
