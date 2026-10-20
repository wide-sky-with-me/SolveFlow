# PDF 生命周期窗口读取复核

日期：2026-10-17。

范围：沿用[扁平解析候选](2026-10-17-pdf-flat-parser.md)，只合并单个 owner 末尾相邻的两次 `doc.defaultView` 读取。原生读取削减、整批保真与取消通过，但镜像两轮速度及长任务一好一坏，未证明稳定收益，未采用；旧服务保持，整体生产目标开放。

## 选择与约束

[生命周期实现](../../apps/mobile/src/local/pdf-render-lifecycle.web.ts)的祖先捕获只在创建和绑定时执行；每次 assert 本就只有一个 owners 循环，没有可删除的第二轮动态祖先扫描。局部 view 必须在 takeRecords、永久失效、连接、ownerDocument、父文档、contentDocument 和 root 短路检查之后读取，再用于 currentDocument/frameElement 两项检查。

不把源预检、队列后复查或跨 owner 身份校验合成整轮快照；观察器子类可在 takeRecords 中重入并改写源文档，原 Document 仍相同而 root 已换，队列后检查仍必需。也不改绑定前后断言、16 轮门禁、completeRendering 阶段门禁和同步 dispose。选择与替代方案归于[既有提案](../../.agents/notes/proposed/storage/2026-10-17-pdf-render-lifecycle.md)。

## 实际检查

证据位于 `.runtime/pdf-production-2026-10-16/`。Node 24.21.0/pnpm 11.7.0；配置要求 Node 24.19.0 的警告仍在。[原生浏览器测试](../../tests/mobile-e2e/pdf-render-lifecycle.spec.ts)新增以下契约：

| 检查 | 结果 |
| --- | --- |
| 工作预算先红 | `r54-window-red.log`：桌面/移动、source-only/clone 共 4 项按 getter 预算失败，非夹具错误。真实 Document getter 转发计数：单层 source+clone 的健康 assert 中 source 4→3、clone 2→1、parent 1 不变，总 7→5；未绑定 clone 总 4→3 |
| 无跨次复用 | 同一 lease 连续断言重新读取；源 getter 暂时返回 null 时同步失败，恢复后重新验证。计数只证明读取削减，不是整批提速 |
| 短路与原值 | check 先抛原始取消 sentinel，不读取 DOM；clone 已失效时不预读后置 view getter |
| 队列后复查 | 原生 observer 子类在 drain 时 document.open/write，保留 Document 身份；同轮检出 root 替换，后续 clone 队列未被提前 drain |
| 同步清理 | A 抛 undefined、B 注销 C 并重入 dispose、D 抛另一个值；快照 A/B/C/D 同步各一次，首个 undefined 原样抛出，提前注销生效，重复 dispose 不重放，关闭后 check 仍保取消优先 |

短路、队列后复查与同步清理的 8 个浏览器场景先在旧实现通过（`r54-boundaries-before.log`）。改后标准命令 `pnpm test:pdf-render-lifecycle` 的 49 项 Node 契约及 98 项浏览器用例通过（`r54-native-green.log`），4 文件 60 项单元通过（`r54-unit.log`）。首轮根类型检查因测试 class 捕获可空 Document 退出 2，日志保留；改为经空检查的非空绑定，不加断言或抑制，根/移动类型重跑退出 0，`r54-*-types-v2.log`。该改动仅绑定别名，不重跑已通过的运行时用例。

隔离 Web export 退出 0：`r54-web-window-v1/`。`r54-build-proof.json` 核对当前/前版 SDK 字节相同，锁文件、workspace 配置、补丁及生成器字节不变。不新增版本或依赖，不改 renderer 的 95 个恢复检查。

## 整批对照

画质轮以旧服务作基线，CPU1 冷首份逐页 RGBA/JPEG。计时轮只比较前版 R53 与本轮窗口候选，按前版/窗口/窗口/前版独占镜像执行，CPU4 各两次；不并行构建/测试、不读像素或采 profile。到达点为 80/700/1800/4200ms 与 250/1100/2600/4800ms，从取得真实取消控件位置后独立计时。

6 份 PDF 共 162 页可见 JPEG/绘制流、27 页 RGBA 对照及 16 次可信取消独立核验通过；缓存身份不变，模型/外部调用和 pageerror 均为 0。VM/静态 SDK 字节一致。完整证据为 `r54-verification.json`、`r54-metrics.json` 及各 `integrated-r51-r54-*` 目录。

| CPU4 路径 | 两次整批 ms | 中位 ms | 两次最长任务 ms | 输入等待范围 ms | 点击至落盘 ms | 点击至 UI 观测 ms |
| --- | --- | --- | --- | --- | --- | --- |
| R53 前版 | 20040.1 / 20104.8 | 20072.45 | 379 / 418 | 4.6–463.8 | 142.0–237.6 | 373.9–530.3 |
| 局部窗口 | 18482.4 / 20897.1 | 19689.75 | 314 / 641 | 6.3–262.6 | 124.8–219.7 | 353.2–458.4 |

中位低 1.91%，但两组配对方向相反，且候选反序最长任务更高。固定八到达点、每组两次导出不足以确立稳定吞吐或尾部分位；UI 观测含轮询，不是精确绘制时间。

本轮没有重跑旧服务 CPU4 计时，不拼接上轮数值推算其收益。核验器只改精确构建目录映射与输出名，保留实际 VM/静态/服务字节、缓存、CSP、可见 JPEG/绘制流、RGBA、可信取消及资源门禁。

## 采用条件

局部读取削减未被证明是主要阻塞来源。补充资源快照在两组均发现仍存活、未编码的 300×150 画布；来源尚未归属。现有核验器要求已编码输出清零，未覆盖所有未编码画布，不把该豁免写成全资源已释放；也不凭 WeakRef 存活认定泄漏。后续先在非计时诊断中定位创建/持有来源，再验证首绘同步岛、分片预算及更广模式。长期负载、多样题型、整本回退、跨浏览器与实体打印继续验收。
