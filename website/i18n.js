(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const text = {
    '跳转到正文': 'Skip to content',
    '个人知识库': 'Personal Knowledge Base',
    '产品能力': 'What it does',
    '工作方式': 'How it works',
    '安全与掌控': 'Privacy & control',
    '开始使用': 'Get started',
    '让积累的知识，': 'Let what you learn today',
    '成为下一次的灵感。': 'inspire what you do next.',
    '把散落的文件、想法与经历，连接成可以持续使用的个人知识库。': 'Connect scattered files, ideas, and experiences in a personal knowledge base you can keep using.',
    '探索产品': 'Explore the product',
    '体验工作流程': 'See the workflow',
    '项目': 'Projects',
    '从想法到成果': 'From idea to outcome',
    '知识': 'Knowledge',
    '连接与沉淀': 'Connect and build',
    '人物': 'People',
    '合作与成长': 'Work and grow together',
    '素材': 'Materials',
    '灵感与引用': 'Inspiration and sources',
    'Ⅱ 暂停动效': 'Ⅱ Pause motion',
    '从一份资料，到一整个知识体系。': 'From a single source to a connected body of knowledge.',
    '收集': 'Capture',
    '多种来源，轻松导入': 'Bring materials in from many sources',
    '解析': 'Understand',
    '理解内容，提取信息': 'Read content and extract information',
    '整理': 'Organize',
    '清晰归类，保留来源': 'Sort clearly and keep source links',
    '复用': 'Reuse',
    '随时调用，激发新想法': 'Bring it back when new ideas need it',
    '读懂图片，也听懂声音。': 'Read images. Understand audio.',
    '无论是扫描的文档、手写笔记，还是会议录音与音频，都能被提取并转化为可搜索、可关联的知识内容。': 'Extract information from scanned documents, handwritten notes, meeting recordings, and audio, then turn it into searchable, connected knowledge.',
    '图片与文档识别': 'Image and document recognition',
    '音频与语音转写': 'Audio and speech transcription',
    '概念界面': 'Conceptual UI',
    '全部内容': 'All materials',
    '文档': 'Documents',
    '图片': 'Images',
    '音频': 'Audio',
    '笔记': 'Notes',
    '研究资料.pdf': 'Research paper.pdf',
    '山地生态系统的': 'Mountain ecosystems:',
    '演变与适应': 'change and adaptation',
    '山地生态系统是地球上最复杂、最独特的自然系统之一。地形、气候与物种之间的相互作用，塑造了丰富的生态环境。': 'Mountain ecosystems are among Earth’s most complex and distinctive natural systems. Interactions among terrain, climate, and species shape a rich range of habitats.',
    '1 · 研究背景': '1 · Research context',
    '在气候变化与人类活动的共同影响下，研究者需要长期记录、对照不同时间的观察结果。': 'As climate change and human activity reshape these systems, researchers need to record and compare observations over time.',
    '语音随记.wav': 'Voice note.wav',
    '“下次做研究时，先确定问题，': '“Next time I research a topic, define the question first,',
    '再把资料按主题整理……”': 'then organize sources by theme…”',
    '音频片段 · 转写示例': 'Audio excerpt · transcription demo',
    'PDF · 第 1 页': 'PDF · Page 1',
    '识别结果': 'Recognition result',
    '提取的文字内容': 'Extracted text',
    '山地生态系统的演变与适应': 'Mountain ecosystems: change and adaptation',
    '来源': 'Source',
    '研究资料.pdf · 第 1 页': 'Research paper.pdf · Page 1',
    '把一次整理，': 'Turn today’s organizing',
    '变成下一次的起点。': 'into a starting point for tomorrow.',
    '好流程的价值，体现在留下的成果里。': 'A good workflow shows its value in what it leaves behind.',
    '选择一个场景，看看散落的输入如何变成可复用的知识。': 'Choose a scenario to see how scattered inputs can become reusable knowledge.',
    '研究资料整理': 'Research organization',
    '项目阶段复盘': 'Project retrospective',
    '创作灵感归集': 'Creative inspiration',
    '整理前': 'Before',
    '散落的原始资料': 'Scattered source materials',
    '整理后': 'After',
    '可继续使用的成果': 'Knowledge ready to reuse',
    '你定义步骤，知识库延续方法。': 'You define the steps; your knowledge base carries the method forward.',
    '自定义触发语、参数和输出规则；在 DSH 中启动后，通过新会话查看实际执行过程与结果。': 'Set custom trigger phrases, parameters, and output rules. Start a workflow in DSH, then follow its progress and results in a new session.',
    '以上为预制内容对照，展示整理方式；不会执行模型推理。': 'These pre-authored examples illustrate an organization workflow; no model inference runs here.',
    '你的知识，始终由你掌控。': 'Your knowledge stays in your hands.',
    '所有内容都以你的方式保存与管理，数据在你可控的环境中运行。': 'Save and manage everything your way, in an environment you control.',
    '让知识的积累更安心、更长久。': 'Build your knowledge with confidence, over time.',
    '本地目录': 'Local files',
    '知识保存于你指定的本地目录，以 Markdown 条目组织。原件与提炼内容保留关联，长期积累有据可循。': 'Knowledge stays in a local folder you choose and is organized as Markdown entries. Source files remain linked to distilled notes, so you can trace what you have built over time.',
    '外发可控': 'Controlled sharing',
    '可设置仅本地策略。添加云端服务不会改变本地默认；本地解析失败，也不会自动把资料转向云端。': 'Choose a local-only policy. Adding a cloud service does not change the local default, and a local parsing failure does not send materials to the cloud automatically.',
    '索引可恢复': 'Recoverable indexes',
    '后台增量维护检索索引，保留最近 3 份有效快照。扫描不完整或条目异常减少时，保留旧索引并提示处理。': 'Search indexes are maintained incrementally in the background, with the latest three valid snapshots retained. If a scan is incomplete or item counts drop unexpectedly, the previous index is kept and the issue is surfaced.',
    '索引快照只恢复检索索引，不恢复已删除的原文、聊天或其他记忆。原始资料仍需妥善备份。': 'An index snapshot restores the search index only. It does not restore deleted source files, chats, or other memory. Back up original materials separately.',
    '适合长期积累，': 'Made for the long term,',
    '也为下一次使用。': 'ready when you need it again.',
    '学习研究、项目创作与个人成长，': 'For learning, research, projects, and personal growth,',
    '让每一次投入，都留下可继续的线索。': 'so each effort leaves a thread you can pick up later.',
    '已有资料怎么接入？': 'How do I bring in existing materials?',
    '在 DSH 设置中绑定目录。空目录可初始化；普通资料文件夹可以先查看导入计划，再选择原地接入或复制到收件箱。任务支持查看进度、中止与重试。需要 OCR 或 ASR 的资料，先解析，再按需要整理落库。': 'Bind a folder in DSH settings. An empty folder can be initialized. For an ordinary folder, review the import plan, then link it in place or copy items to the Inbox. Tasks show progress and support cancellation and retry. Parse materials that need OCR or ASR before organizing them into the library.',
    '识别与转写，需要准备什么？': 'What do I need for recognition and transcription?',
    '在「识别与转写」中配置可用服务。支持本地 PaddleOCR-VL、Qwen3-ASR 等部署，以及已配置的 OpenAI 兼容、Qwen、百度原生接口与 CLI。插件不自动安装模型依赖；云端服务可能产生服务商费用，实际识别效果取决于模型、原件与运行环境。': 'Configure an available service under Recognition and Transcription. Supported options include local PaddleOCR-VL and Qwen3-ASR deployments, configured OpenAI-compatible and Qwen services, Baidu native APIs, and CLI tools. The plugin does not install model dependencies automatically. Cloud services may charge fees; recognition quality depends on the model, source material, and runtime environment.',
    '自定义流程怎样帮我少做重复工作？': 'How do custom workflows reduce repeated work?',
    '把固定步骤、触发语、参数及输出规则保存为流程。下一次从流程页启动，会创建知识库会话并发送完整提示词。在会话中查看回复、工具调用与执行结果，也可以停止。实际执行需满足 DSH 宿主、知识库预设与授权要求。': 'Save repeatable steps, trigger phrases, parameters, and output rules as a workflow. Starting it from the Workflow page creates a knowledge-base session and sends the full prompt. Follow replies, tool calls, and results in the session, or stop the run. Execution still depends on the DSH host, knowledge-base preset, and authorization.',
    '怎样找回曾经整理过的内容？': 'How do I find materials I organized earlier?',
    '支持标题、标签、类型与正文全文检索，并沿来源定位原始资料。当前能力不是向量语义搜索。索引缺失或损坏时，可回退磁盘扫描；日常变动由后台增量维护，必要时可以手动重建。索引维护不修改正文或原件。': 'Search titles, tags, types, and full text, then follow source links back to original materials. The current capability is not vector semantic search. If an index is missing or damaged, the plugin can fall back to a disk scan. Routine changes are maintained incrementally in the background; rebuild manually when needed. Index maintenance does not modify source text or originals.',
    '让每一次积累，都有下一次回响。': 'Let what you build today help with what comes next.',
    '个人知识库 2.3.0 正式版：自定义流程可选择执行模型和推理强度，保存默认值，运行前随时调整。': 'Personal Knowledge Base 2.3.0 stable: custom workflows can save an execution model and reasoning level as defaults, with an option to adjust them before each run.',
    '个人知识库 2.3.0': 'Personal Knowledge Base 2.3.0',
    '下载正式版 2.3.0': 'Download stable 2.3.0',
    'GitHub 仓库': 'GitHub repository',
    'DSH 插件 · 本地安装包': 'DSH plugin · local package',
    '安装指南 ↗': 'Installation guide ↗',
    '查看更新说明': 'Release notes',
    '插件设计与演进记录': 'Design and development record',
    '回到顶部 ↑': 'Back to top ↑',
    '从这里，开始积累。': 'Start building your library.',
    '在客户端安装插件': 'Install the plugin in the client',
    '将「下载插件」按钮的链接填入 DSH 插件管理器的安装源，由客户端自动下载；也可选择本地安装包': 'Add the **Download plugin** link as an installation source in the DSH plugin manager and let the client download it, or choose the local package',
    '核对加载结果': 'Confirm that it loaded',
    '宿主支持时直接热加载；仅在提示需要重启时，完全退出 DSH（包括托盘）再打开。核对版本为 2.3.0。后续同一大版本内的正式版小版本和补丁会自动更新；跨大版本或预览版请手动选择。': 'The host hot-loads the plugin when supported. Fully exit and reopen DSH, including the tray process, only if prompted. Confirm version 2.3.0. Later stable minor and patch updates within the same major version install automatically; choose major-version and preview updates manually.',
    '绑定一个本地文件夹': 'Bind a local folder',
    '打开「设置 → 个人知识库」，选择目录并点击「自动建库 / 识别」。先预览，再接入已有资料。': 'Open **Settings → Personal Knowledge Base**, choose a folder, and select **Initialize / Recognize**. Preview the plan before bringing in existing materials.',
    '按需配置 OCR 与 ASR': 'Configure OCR and ASR when needed',
    '在「识别与转写」中配置已有本地环境或云端服务，再进行环境检查与解析验证。': 'Under **Recognition and Transcription**, configure an existing local environment or cloud service, then check the environment and validate parsing.',
    '下载插件 ↓': 'Download plugin ↓',
    '可选 OCR／ASR 服务沿用已有环境；本版底层优化无需额外安装或配置。安装包来自公开仓库，可通过发布清单核对版本与 SHA-256 摘要。': 'Optional OCR/ASR services reuse existing environments. The foundational optimizations in this version require no extra installation or configuration. The package comes from a public repository; verify its version and SHA-256 against the release manifest.'
  };
  const attributes = {
    '主导航': 'Primary navigation',
    '知识库的组织方式': 'How the knowledge base is organized',
    '资料进入知识库的四个阶段': 'Four stages for bringing materials into the knowledge base',
    '资料解析方式': 'Material parsing modes',
    '示意文件分类': 'Example file categories',
    '黑白山地与冰川谷地研究图片': 'Black-and-white study image of mountains and a glacial valley',
    '暂停页面动效': 'Pause page motion',
    '开启页面动效': 'Resume page motion',
    '缩小文档': 'Zoom out on the document',
    '放大文档': 'Zoom in on the document',
    '复制识别结果': 'Copy recognition result',
    '复制结果': 'Copy result',
    '整理成果示例': 'Organization workflow examples',
    '被精细环形光线围绕的半透明盾牌': 'A translucent shield encircled by fine rings of light',
    '关闭安装指南': 'Close installation guide'
  };

  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  const toggle = $('#language-toggle');
  const systemLanguage = (navigator.language || '').toLowerCase();
  const savedLanguage = (() => {
    try { return localStorage.getItem('pkb-showcase-language'); } catch { return null; }
  })();
  const initialLanguage = savedLanguage === 'en' || savedLanguage === 'zh-CN'
    ? savedLanguage
    : systemLanguage.startsWith('zh') ? 'zh-CN' : 'en';
  let current = 'zh-CN';
  window.siteLanguage = current;

  function spaced(original, translated) {
    const start = original.match(/^\s*/)?.[0] || '';
    const end = original.match(/\s*$/)?.[0] || '';
    return `${start}${translated}${end}`;
  }

  function setLanguage(next, persist = false) {
    const useEnglish = next === 'en';
    if (current !== next) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.parentElement?.closest('script,style,svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        if (!originalText.has(node)) originalText.set(node, node.nodeValue);
        const source = originalText.get(node);
        node.nodeValue = useEnglish ? spaced(source, text[source.trim()] || source.trim()) : source;
      }
      document.querySelectorAll('[aria-label], [title], [alt]').forEach(element => {
        for (const name of ['aria-label', 'title', 'alt']) {
          if (!element.hasAttribute(name)) continue;
          let values = originalAttributes.get(element);
          if (!values) { values = {}; originalAttributes.set(element, values); }
          if (!(name in values)) values[name] = element.getAttribute(name);
          const source = values[name];
          element.setAttribute(name, useEnglish ? attributes[source] || source : source);
        }
      });
      document.documentElement.lang = useEnglish ? 'en' : 'zh-CN';
      document.title = useEnglish ? 'Personal Knowledge Base · Knowledge that keeps growing' : '个人知识库 · 让知识持续生长';
      const description = $('meta[name="description"]');
      description.content = useEnglish
        ? 'Personal Knowledge Base for DSH connects files, ideas, and experience over time. Import materials, use OCR and ASR, search, and run custom workflows while staying in control.'
        : 'DSH 个人知识库，让文件、想法与经历成为可持续使用的知识。资料导入、OCR、ASR、检索与自定义流程，尽在你的掌控。';
      document.querySelectorAll('[data-doc-cn][data-doc-en]').forEach(link => {
        link.href = useEnglish ? link.dataset.docEn : link.dataset.docCn;
      });
      current = next;
      window.siteLanguage = current;
      document.dispatchEvent(new CustomEvent('site-language-change', { detail: { language: current } }));
    }
    toggle.textContent = useEnglish ? '中文' : 'EN';
    toggle.setAttribute('lang', useEnglish ? 'zh-CN' : 'en');
    toggle.setAttribute('aria-label', useEnglish ? 'Switch language to Chinese' : 'Switch language to English');
    if (persist) {
      try { localStorage.setItem('pkb-showcase-language', next); } catch { /* Storage may be unavailable in private browsing. */ }
    }
  }

  toggle.addEventListener('click', () => setLanguage(current === 'en' ? 'zh-CN' : 'en', true));
  setLanguage(initialLanguage);
})();
