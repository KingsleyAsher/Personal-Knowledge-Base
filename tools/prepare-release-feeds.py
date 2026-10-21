from pathlib import Path
import json,shutil
repo=Path(__file__).resolve().parents[1]
stable=repo.parent/'知识库产品-1.1.4'
m=json.loads((stable/'manifest.json').read_text(encoding='utf-8'))
assert json.loads((stable/'validation.json').read_text(encoding='utf-8'))['passed']
shutil.copyfile(stable/'manifest.json',repo/'release-manifest.json')
shutil.copyfile(stable/m['tgz'],repo/'dist'/m['tgz'])
shutil.copyfile(stable/m['tgz'],repo/'website/downloads'/m['tgz'])
(repo/'SHA256SUMS').write_text(m['sha256']+'  '+m['tgz']+'\n',encoding='utf-8',newline='')
for rel in ['README.md','WORKBENCH.md','PREVIEW.md','website/index.html']:
    p=repo/rel; t=p.read_text(encoding='utf-8')
    t=t.replace('正式版 1.1.3','正式版 1.1.4').replace('正式版清单仍指向 1.1.3','正式版清单指向 1.1.4').replace('正式版继续提供 1.1.3','正式版提供 1.1.4').replace('local-dsh-knowledge-base-1.1.3.tgz','local-dsh-knowledge-base-1.1.4.tgz')
    t=t.replace('旧版更新器首次体验需从下载页安装新版。','旧版用户先通过原有更新入口安装 1.1.4，即可选择正式版或预览版。')
    t=t.replace('已发布的旧版更新器不具备预览提示界面，首次体验请使用以上下载入口安装新版。','旧版用户先升级正式版 1.1.4，即可获得预览提示和可选下载入口。')
    t=t.replace('旧版更新器不能通过远端清单自动获得新界面，首次体验需手动安装本预览版。','旧版用户先通过现有更新入口升级 1.1.4，即可选择是否安装预览版。')
    p.write_text(t,encoding='utf-8',newline='')
p=repo/'RELEASE.md'
t=p.read_text(encoding='utf-8')
p.write_text('''# 1.1.4 正式版：可选更新通道

基于 1.1.3，仅增加正式版和预览版分别检查、显示及由用户选择下载/安装的能力。知识工作台功能仅在 2.0.1-beta1 预览版提供。

- 旧版用户通过现有“检查更新”入口获得正式版 1.1.4。
- 安装 1.1.4 后，同时查看正式版状态和可选预览更新。
- 检查本身不下载、不安装；选择预览版后才执行对应操作。
- 预览清单不可用时保留正式版检查；安装前重新校验版本、包身份、大小和 SHA256。
- 保留原有资料、绑定和设置；不增加工作台引导。

[下载正式版 1.1.4](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-1.1.4.tgz) · [下载预览版 2.0.1-beta1](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.0.1-beta1.tgz)

更新通道、原有更新安装流程和导入授权回归使用模拟服务通过；真实 DSH 安装尚待实机验收。

---

'''+t,encoding='utf-8',newline='')
p=repo/'WORKBENCH-IMPLEMENTATION.md';t=p.read_text(encoding='utf-8').replace('未公开发布、未改动已安装 profile 或正式知识库。','本次获准发布 GitHub；未改动已安装 profile 或正式知识库。').replace('未修改已安装的 1.1.3','未修改本机已安装的 1.1.3')
p.write_text(t,encoding='utf-8',newline='')
print('Prepared stable 1.1.4 and beta 2.0.1-beta1 download feeds')
