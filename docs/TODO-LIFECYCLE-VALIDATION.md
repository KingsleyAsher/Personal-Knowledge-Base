# 任务计划面板验收记录（2026-11-06）

范围更新：用户随后明确本次只修宽度，延迟由用户自行观察。已停止状态测量，恢复临时替换的 JSON.parse、断开 MutationObserver、清空未发送的测试草稿并关闭开发者工具；没有发送测试任务。以下桌面状态测量项保留为未验证记录，不再作为本次交付的待办。

## 已证实

源码宽度修复只触及 `[data-todo-lifecycle-panel]`：border-box、官方 composer 宽度/上限公式、水平居中，保留底部 8px 间距。变量兜底为 side-clearance=16px、dock-inset=8px、card-max-width=952px；max(0px, …) 防止极窄容器出现负计算值。index.js 内联副本由 `python -X utf8 tools/sync-todo-lifecycle-client.py` 同步，脚本只替换唯一的 BEGIN/END 标记区块。

`node --test tests/todo-lifecycle.test.mjs`：7 通过，0 失败，0 跳过。覆盖内联逐字一致、宽度公式及兜底、原外观与收起状态、viewOf 映射和 Host 每轮一次收尾核对。没有修改状态源、文案、轮末核对或增加计时器。

`node --test tests/*.test.mjs` 首轮：253 项，251 通过、1 失败、1 跳过。失败的 direct-243-upgrade 测试把当前源码 2.5.0 与发布清单 2.4.14 混用；修正为从发布清单选择发布包后，单独复跑该项 1/1 通过，实际完成隔离的 2.4.3 → 2.4.14 升级。合计最终结果：252 通过、0 未解决失败、1 跳过；没有重复整套测试。跳过项为 command-description 的 installed DSH dispatch：未提供 DSH_TEST_TOOLS_URL。这一发布包回归不证明当前源码已安装。测试只使用虚构库。

运行 `node tools/measure-todo-layout.mjs`，通过隔离 Edge headless DOM 的 getBoundingClientRect 测量：

| 视口 px | 面板 px | 官方公式对照 px | 卡片公式对照 px | 差值 px | 横向溢出 |
| --- | --- | --- | --- | --- | --- |
| 320 | 256 | 256 | 288 | 0 | 无 |
| 1280 | 680 | 680 | 712 | 0 | 无 |
| 1920 | 920 | 920 | 952 | 0 | 无 |
| 2560 | 920 | 920 | 952 | 0 | 无 |

这是合成页面，宽视口设置 280px 侧栏，非真实 DSH 布局。页面注入 side-clearance=16px、dock-inset=8px、card-max-width=calc(clamp(680px,64cqw,920px) + 32px)。读取的 CSS 自定义属性为该表达式，面板实际计算宽度如表。另移除全部三个自定义属性，320/1280/1920/2560 下分别为 256/920/920/920px，与使用同样兜底的官方公式对照差值均 0px，均无横向滚动。原始 JSON 在 `.test-runs/todo-layout/layout.json`，脚本支持第一个参数指定输出目录。对照元素使用给定公式，并非挂载官方 React 组件；这些数值不能算已安装桌面的验收证据。

只读核对已安装 desktop 包 package.json：版本为 2.5.0。没有修改其源码。没有读写真实知识库，未修改宿主 settings.yaml、cordis 配置或 model-sync.mjs。

## 未能复现

没有完成桌面三次任务的观测，不能报告“未能复现面板层滞后”，也不能判定为 useSessionStatus 缺失、sessions.list 延迟或收尾轮语义。未凭推断修改 B。

## 未验证

本次查看桌面时，DSH 正显示 deepseek-splash 的安装进度对话框；随后 UI 工具报告检测到用户正在操作该窗口。未中止该安装、重启应用或抢占用户操作，已请求桌面可用时继续测量。已发现 9230 是标题为 DeepSeek Harness Host、URL 为 dsh://host 的 Inspector，不是前端 DOM 调试目标。

下列桌面验收均尚缺证据：

- 已安装 2.5.0 上三次 ≥3 步任务的 todo/write 到达 → 面板 DOM 变化 → 轮结束时间线。
- 根据这三次观测判定滞后所在层，以及 useSessionStatus 的实际返回值和选择器稳定性。
- 修复后桌面三次事件到渲染延迟及官方组件同场对照；是否 ≤500ms 或不劣于官方。
- 1280/1920/2560 真实桌面窗口下的面板、输入卡片和 CSS 变量读数，以及与真实官方面板的 ≤2px 比较。
- 本补丁 TGZ 的安装、重新加载和实际构建指纹确认。

因此本记录仅证明源码补丁、状态语义回归和隔离 CSS 几何检查通过；按用户更新后的范围交付宽度源码修复，延迟由用户自行观察。本补丁尚未安装到 desktop。
