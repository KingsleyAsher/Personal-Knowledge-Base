from pathlib import Path
repo=Path(__file__).resolve().parents[1]
for rel in ['package.json','cordis.patch.yml','src/host/kbcore.js','src/client/index.js','tests/workbench-ui.mjs','README.md','WORKBENCH.md','WORKBENCH-IMPLEMENTATION.md','PREVIEW.md','website/index.html']:
    p=repo/rel
    p.write_text(p.read_text(encoding='utf-8').replace('2.0.1-beta1','2.0.1-beta2'),encoding='utf-8',newline='')
source=(repo/'tools/prepare-stable-bridge.py').read_text(encoding='utf-8').replace('1.1.4','1.1.5').replace('1.1.3','1.1.4').replace('2.0.1-beta1','2.0.1-beta2')
source=source.replace('仅增加正式版与预览版分别检查、显示及由用户选择下载/安装的能力','增加 Gitee / GitCode / GitHub 三源检查与下载、失败切换及摘要校验')
(repo/'tools/prepare-stable-domestic.py').write_text(source,encoding='utf-8',newline='')
p=repo/'tools/validate-workbench.py';t=p.read_text(encoding='utf-8').replace("'tests/preview-updates.test.mjs']","'tests/preview-updates.test.mjs', 'tests/mirror-updates.test.mjs']")
p.write_text(t,encoding='utf-8',newline='')
source=(repo/'tools/validate-stable-bridge.py').read_text(encoding='utf-8').replace('1.1.4','1.1.5').replace('1.1.3','1.1.4')
source=source.replace("'preview-updates.test.mjs',","'preview-updates.test.mjs','mirror-updates.test.mjs',")
source=source.replace('Changed from 1.1.4:', 'Changed from 1.1.4:')
(repo/'tools/validate-stable-domestic.py').write_text(source,encoding='utf-8',newline='')
for rel in ['README.md','WORKBENCH.md','PREVIEW.md']:
    p=repo/rel;t=p.read_text(encoding='utf-8')
    t=t.replace('正式版 1.1.4','正式版 1.1.5').replace('local-dsh-knowledge-base-1.1.4.tgz','local-dsh-knowledge-base-1.1.5.tgz').replace('正式版清单指向 1.1.4','正式版清单指向 1.1.5')
    t+='\n## 国内更新源\n\n1.1.5 正式版与 2.0.1-beta2 预览版内置 Gitee、GitCode 和 GitHub。三个源并发检查正式/预览清单，采用可用源中的最新版本；同版本摘要冲突时阻止更新。优先使用国内源，下载失败或包校验失败时切换其他源。界面可展开查看来源状态和各源下载入口。GitCode 使用官方文件 API，Gitee 使用可重新获取的原始文件链接，不保存临时签名地址。镜像同步可能有延迟；全部源不可用会明确报错，不视为最新。已安装的旧版需要先更新一次才能使用新源。\n'
    p.write_text(t,encoding='utf-8',newline='')
p=repo/'website/index.html';t=p.read_text(encoding='utf-8').replace('1.1.4','1.1.5')
t=t.replace('href="downloads/local-dsh-knowledge-base-1.1.5.tgz"','href="https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-1.1.5.tgz"')
t=t.replace('href="https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.0.1-beta2.tgz"','href="https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.0.1-beta2.tgz"')
p.write_text(t,encoding='utf-8',newline='')
p=repo/'RELEASE.md';t=p.read_text(encoding='utf-8')
p.write_text('''# 1.1.5 正式版：国内更新源

基于 1.1.4 的小更新，加入 Gitee / GitCode / GitHub 三源检查和下载，保留正式版/预览版自主选择。没有加入知识工作台功能。

- 并发读取各源清单，采用最新可用版本，避免镜像延迟隐藏新版本。
- 同版本摘要不一致时阻止更新；下载失败或校验失败后切换其他源。
- 展开下载源可查看各源状态及正式、预览安装包入口。
- GitCode 使用官方 raw 文件 API，Gitee 仅允许平台文件域名内的 HTTPS 跳转。
- 检查更新不自动下载或安装。保留资料、绑定和设置。

正式版：1.1.5；预览版：2.0.1-beta2。旧版需安装本次更新后才能获得国内源。

---

'''+t,encoding='utf-8',newline='')
print('Prepared 1.1.5 / 2.0.1-beta2 domestic releases')
