from pathlib import Path
import json,shutil
repo=Path(__file__).resolve().parents[1]
stable=repo.parent/'知识库产品-1.1.5'
manifest=json.loads((stable/'manifest.json').read_text(encoding='utf-8'))
assert json.loads((stable/'validation.json').read_text(encoding='utf-8'))['passed']
shutil.copyfile(stable/'manifest.json',repo/'release-manifest.json')
for folder in ['dist','website/downloads']:shutil.copyfile(stable/manifest['tgz'],repo/folder/manifest['tgz'])
(repo/'SHA256SUMS').write_text(manifest['sha256']+'  '+manifest['tgz']+'\n',encoding='utf-8',newline='')
p=repo/'README.md';t=p.read_text(encoding='utf-8')
start=t.index('- **正式版 1.1.5**');end=t.index('\n\n',start)
t=t[:start]+'''- **正式版 1.1.5**：[Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-1.1.5.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-1.1.5.tgz?ref=main) · [GitHub 下载](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v1.1.5/local-dsh-knowledge-base-1.1.5.tgz)。
- **预览版 2.0.1-beta2**：[Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.0.1-beta2.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.0.1-beta2.tgz?ref=main) · [GitHub 下载](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.0.1-beta2/local-dsh-knowledge-base-2.0.1-beta2.tgz)。''' +t[end:]
p.write_text(t,encoding='utf-8',newline='')
source=(repo/'tools/publish-beta.py').read_text(encoding='utf-8').replace('2.0.1-beta1','2.0.1-beta2').replace('1.1.4','1.1.5')
source=source.replace("'tools/prepare-release-feeds.py'])", "'tools/prepare-release-feeds.py', 'tests/mirror-updates.test.mjs', 'tools/live-update-mirrors.mjs', 'tools/probe-update-mirrors.py', 'tools/prepare-domestic.py', 'tools/assemble-domestic.py', 'tools/prepare-stable-domestic.py', 'tools/validate-stable-domestic.py', 'tools/publish-domestic.py'])")
source=source.replace('with optional preview updates','with domestic update mirrors').replace('optional stable and preview updates only','domestic update sources only').replace('1.1.5 · 正式版与预览版可选更新','1.1.5 · 国内更新源').replace('2.0.1-beta2 · 知识工作台预览版','2.0.1-beta2 · 国内源与知识工作台预览')
(repo/'tools/publish-domestic.py').write_text(source,encoding='utf-8',newline='')
source=(repo/'tools/verify-github-publication.py').read_text(encoding='utf-8').replace('2.0.1-beta1','2.0.1-beta2').replace('1.1.4','1.1.5')
# Keep this verifier read-only; no helper rewrite is needed for the new publication.
source=source.split('# Keep the public upload helper')[0]
(repo/'tools/verify-domestic-publication.py').write_text(source,encoding='utf-8',newline='')
print('Assembled 1.1.5 feed, domestic download links and publication helpers')
