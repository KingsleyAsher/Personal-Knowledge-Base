# 知识库插件 2.4.3 / Knowledge-base plugin 2.4.3

## 2.4.3：原件同步与 Windows 解析任务修复（2026-11-05）

- 合入文本原件与引用同步：归档文本参与检索，原件编辑后更新索引与引用范围；旧的自动生成镜像引用当前原件，独立撰写的摘要仍保留。
- 调整索引排除与恢复时的关联原件、派生记录及增量向量复用；修复含中文路径及版本化 Python 路径的 PDF 渲染。
- Windows 解析任务记录的读取和原子替换共用进程级队列，减少句柄重叠；外部占用有限重试，耗尽时保留旧记录并清理临时文件。
- 提交、重试和启动恢复的后台错误均被捕获；尽力保存失败状态，无法保存时明确报告，清理心跳和运行标记。

Windows 定向复验 73/73 通过（原有 68 项及新增 5 项故障测试）。测试使用虚构资料和请求替身，不证明真实 OCR/ASR 效果、自动 PDF/Office 索引同步、原生位置映射或完整桌面运行兼容性。客户端独立发布版本仍为 1.0.3，本次不重新发布客户端安装器。

## 2.4.3: source synchronization and Windows parsing jobs (2026-11-05)

- Merge text-original retrieval and citation synchronization. Archived text is searchable; edits refresh source records and ranges. Legacy generated mirrors resolve to current originals while independently authored summaries remain searchable.
- Preserve exclusions across related originals and derived records, reuse unchanged embeddings, and support PDF rendering with non-ASCII paths and versioned Python executables.
- Serialize parsing-record reads and atomic replacements in one process, including separate service instances. External locks receive bounded retries; exhausted writes preserve the old record and clean up temporary files.
- Catch background failures during submission, retry and startup recovery. Persist failure diagnostics where possible, report persistence failures, and release heartbeats and running registrations.

Windows focused verification passed 73/73 tests: 68 existing checks and 5 injected-failure regressions. Synthetic inputs and transport stubs do not establish real OCR/ASR quality, automatic PDF/Office re-indexing, native source-position mapping or complete desktop compatibility. The independently released client remains 1.0.3; its installer is not rebuilt for this release.

## 安装 / Installation

下载本 Release 的 TGZ 并核对发布清单摘要。先保存任务并退出 DSH（含托盘）及连接同库的客户端，再安装；重新打开后核对 2.4.3 与清单构建号。安装失败时保留状态目录，勿清空解析记录。

Verify the TGZ against its manifest. Save work and exit DSH, including its tray process, and clients sharing the library before installation. Reopen and verify version 2.4.3 and the manifest build ID. Keep existing parsing state if installation fails.
