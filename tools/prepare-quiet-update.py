from pathlib import Path
repo=Path(__file__).resolve().parents[1]
for rel in ['package.json','cordis.patch.yml','src/host/kbcore.js','src/client/index.js','tests/workbench-ui.mjs','README.md','WORKBENCH.md','WORKBENCH-IMPLEMENTATION.md','PREVIEW.md','website/index.html']:
    p=repo/rel;t=p.read_text(encoding='utf-8').replace('2.0.1-beta2','2.0.1-beta3')
    if rel != 'src/host/kbcore.js':t=t.replace('1.1.5','1.1.6')
    t=t.replace('界面可展开查看来源状态和各源下载入口。','正常更新自动选择可用源，不展示来源清单；只有全部源失败时才列出原因与备用入口。')
    p.write_text(t,encoding='utf-8',newline='')
for rel in ['prepare-stable-domestic.py','validate-stable-domestic.py','assemble-domestic.py']:
    p=repo/'tools'/rel;t=p.read_text(encoding='utf-8').replace('2.0.1-beta2','2.0.1-beta3').replace('1.1.5','1.1.6')
    if rel in ['prepare-stable-domestic.py','validate-stable-domestic.py']:t=t.replace('1.1.4','1.1.5')
    if rel=='prepare-stable-domestic.py':
        needle="t=t[:start]+current[cstart:cend]+t[end:]"
        t=t.replace(needle,needle+"\nstart=t.index('    function createClientUpdateFlow(')\nend=t.index('    let updateViewState',start)\ncstart=current.index('    function createClientUpdateFlow(')\ncend=current.index('    let updateViewState',cstart)\nt=t[:start]+current[cstart:cend]+t[end:]")
    if rel=='validate-stable-domestic.py':
        needle="shutil.copyfile(repo/'dist/local-dsh-knowledge-base-1.1.3.tgz',source/'dist/local-dsh-knowledge-base-1.1.3.tgz')"
        t=t.replace(needle,needle+"\nshutil.copyfile(repo/'dist/local-dsh-knowledge-base-1.1.4.tgz',source/'dist/local-dsh-knowledge-base-1.1.4.tgz')")
        t=t.replace('changedFilesFrom114','changedFilesFrom115')
    if rel=='assemble-domestic.py':
        t=t.replace("replace('1.1.4','1.1.6')", "replace('1.1.4','1.1.6')")
        t=t.replace("'tools/publish-domestic.py'])", "'tools/publish-domestic.py', 'tools/prepare-quiet-update.py'])")
    p.write_text(t,encoding='utf-8',newline='')
p=repo/'RELEASE.md';t=p.read_text(encoding='utf-8')
p.write_text('''# 1.1.6 正式版：自动选择可用更新源

在国内更新源基础上简化更新操作：点击更新后自动选择可用地址，下载、校验及交给宿主安装。正常情况不列出来源、地址或单个源的失败信息；只有全部源不可用时才列出原因和备用入口。保留正式版/预览版自主选择，不包含工作台功能。

对应预览版：2.0.1-beta3。旧版本安装包保留。

---

'''+t,encoding='utf-8',newline='')
print('Prepared quiet automatic updates: 1.1.6 / 2.0.1-beta3')
