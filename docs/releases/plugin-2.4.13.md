# 知识库插件 2.4.13 / Knowledge-base plugin 2.4.13

## 2.4.13：更新不再重解析宿主依赖（2026-11-05）

安全更新只在独立解析目录中解析无依赖的知识库包，将其 importer、package、snapshot 三组记录合并到原 pnpm v9 锁文件。其他插件的来源、锁定版本及记录逐字节保留，不再向注册源查找宿主内置包，也不复制或重装其他插件。未知锁格式、歧义或跨包引用失败时保留旧安装。

19 项更新状态检查、8 项真实 pnpm／事务检查通过；另用本机清单的隔离副本验证仅解析知识库包能完成准备，原 profile 清单与锁未改动。保留回滚与崩溃恢复；真实设备安装及加载结果另记，不由准备成功推断。

## 2.4.13: preserve unrelated Host dependency locks (2026-11-05)

Resolve only the dependency-free knowledge package in an isolated resolver, then merge its importer, package and snapshot entries into the original pnpm v9 lockfile. Other source specifiers, pinned versions and records remain byte-for-byte intact. Host-internal packages are not looked up, copied or reinstalled. Unsupported or ambiguous locks and cross-package references fail closed.

Nineteen update-confirmation checks and eight real-pnpm/transaction checks passed. An isolated copy of the actual profile metadata also prepared successfully while the live manifest and lock remained unchanged. Rollback and crash recovery remain in place. Live installation and activation results are recorded separately from staging success.

