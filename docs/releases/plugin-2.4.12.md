# 知识库插件 2.4.12 / Knowledge-base plugin 2.4.12

## 2.4.12：本地依赖与自动更新准备（2026-11-05）

保留 2.4.11 的共享状态构建字段与旧接口确认修复。进一步修复更新准备阶段拒绝 profile 内相对路径本地插件的问题：将这些依赖复制到隔离的影子目录，使 pnpm 只处理影子清单；保持真实 profile 中其他插件的来源字符串及文件不变。拒绝越界、链接、元数据冲突和超过 64 MiB 的相对依赖，不复制运行知识库或凭据。

19 项状态确认检查、7 项真实 pnpm 与事务检查通过，覆盖本地依赖保留、越界拒绝、发布失败回滚和进程崩溃恢复。实际设备自动升级另行记录；下载成功、合成检查或磁盘包版本均不单独代表正在运行的新构建已经生效。

## 2.4.12: local dependencies during automatic update staging (2026-11-05)

Retain the shared-build and legacy confirmation fixes from 2.4.11. Profile-local relative package dependencies are now copied into isolated shadow staging so pnpm can resolve them without changing their live source specifiers or files. Escapes, links, metadata collisions and relative packages over 64 MiB are rejected. Knowledge libraries and credentials are not staged.

Nineteen confirmation checks and seven real-pnpm/transaction checks passed, including dependency preservation, escape rejection, rollback and crash recovery. Live-device automatic upgrade results are recorded separately; downloads, synthetic checks and disk package versions alone do not establish activation of the new running build.

