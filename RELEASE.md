# 个人知识库 1.0.5

## 流程会话自动归入工作区

之前流程新会话只传 cwd，没有指定 DSH 工作区身份，所以落在「未分组」。本版改为先创建/复用工作区，再以 workspaceId 创建会话。

- 第一次从知识库页签运行流程，在知识库文件夹旁边创建同级的「流程工作区」文件夹，并注册为同名 DSH 工作区。
- 后续流程复用该工作区，多个浏览器窗口发起的创建请求按顺序处理，避免重复注册。
- 草稿、下载和临时文件放在流程工作区；最终产出仍按流程规则落库。提示词带上两个绝对路径，避免把工作目录误当成知识库。
- 同名工作区指向别处、目录被文件或目录链接占用、目录不可创建或宿主服务不可用时明确失败，不创建未分组回退会话。
- 已有会话原样保留，不自动迁移。

例如：`某个目录/知识库` 与 `某个目录/流程工作区`，两者同级。

## 安装与验证

下载 [local-dsh-knowledge-base-1.0.5.tgz](https://github.com/KingsleyAsher/Personal-Knowledge-Base/blob/main/dist/local-dsh-knowledge-base-1.0.5.tgz)，通过 DSH「设置 → 插件」安装。完全退出客户端（包括托盘）再启动，顶部应显示「版本 1.0.5」。第一次运行时才自动创建工作区，发布或安装阶段不访问正式知识库。

- 源码与安装包 20/20 字节一致，版本与哈希核对通过。
- 工作区创建/复用/并发、名称、目录位置、提示词路径，以及同名/文件/目录链接冲突回归通过。
- 浏览器虚构环境验证新会话显式传 workspaceId、复用同一个工作区、创建失败无未分组回退，以及原流程/更新入口，1440×900 和 390×844 通过。故意注入的 HTTP 500 已单独核对，成功路径无相关控制台错误。
- 更新检查、流程提示词和索引判定回归通过；未读取正式知识库或运行个人流程/模型。真实桌面运行态需重启后核对。

```text
python -X utf8 tools/verify-release.py
node tests/flow-workspace-probe.mjs
node tests/updates-probe.mjs
node tests/flow-conversation-probe.mjs
node tests/rebuild-probe.mjs src/host/index.js
```

安装包 220117 字节，SHA256：`06df88643df8c34417ccfc3e670dab3a7e136ad54b6ec8c14fe5abd487858b63`。
