## 插件 2.5.7 · 修复 ASAR 索引误报

知识库服务按磁盘上的真实文件扫描，整份 ASAR 安装包作为一个原件登记。包内虚拟文件不再触发「文件在读取期间发生变化」，索引维护可正常完成。此版仅更新 DSH 插件，客户端版本仍为 1.1.2。

## Plugin 2.5.7 · ASAR indexing fix

The knowledge-base service treats Electron ASAR archives as physical files. Virtual entries no longer cause repeated file-change errors during index maintenance. Desktop client 1.1.2 remains compatible.
