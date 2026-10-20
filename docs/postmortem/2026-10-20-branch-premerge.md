# 分支预合并验收与审计门槛

日期：2026-10-20，Asia/Shanghai。

范围：`feat/batch-pdf-unified` 的 `b9044c2` 加当前未提交工作区；目标主分支为 `886e009`。使用 Node 24.19.0、pnpm 11.7.0、Chrome 154；模型与浏览器数据均为离线/合成夹具。

结论：用户明确选择依赖审计全绿后再合并。当前依赖审计和浏览器回归均未通过，保留分支及未提交成果，未提交、合并、推送或部署。浏览器全量721通过、13失败、2项按既有宽屏条件跳过；本报告不是发布放行记录。

## 主分支保留与修正

原 main 已创建附注标签 `pre-merge/main-2026-10-20`，目标提交为 `886e009ff08da57d6214dd5b2b3c5ad42bc01c46`，标签不表示发布版本。原 main 与当前功能分支均未移动。

首轮 `pnpm lint` 退出1：源码边界通过，5份未冻结记录中14条临时证据链接已失效。改为历史路径并明确缺失，不补造证据、不修改旧成绩。另两份报告将仍在本机但不随仓库分发的运行证据改为行内路径。仅改文档，不改产品逻辑或检查门槛。

最初 Node 24.21.0 的 `pnpm typecheck` 退出0，但版本不符；切回已有24.19.0后重新完整验证，以下正式成绩均使用锁定版本。依赖审计也在24.19.0复测，结果同为8条通告、退出1。

## 验证结果

所有命令在仓库根目录执行；完整日志与本地产物仅保留于 `.runtime/merge-verification-2026-10-20/`，不随 Git 分发。

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm lint` | 修复后退出0；源码边界及文档检查通过 |
| `pnpm docs:test` | 20项通过，退出0 |
| `pnpm typecheck` | 非移动工作区构建、根及移动端类型检查通过，退出0 |
| `pnpm test:web-container` | 13项通过，退出0 |
| `node --test scripts/pdf-render-baseline.test.mjs scripts/html2canvas-lifecycle.test.mjs scripts/html2canvas-parser.test.mjs` | 49项通过，退出0；不由Vitest成绩代替 |
| `pnpm exec vitest run --maxWorkers=2` | unit/offline共167文件、1957项通过，退出0 |
| `CI=1 EXPO_NO_TELEMETRY=1 pnpm --filter @solveflow/mobile build` | Web、Android/iOS JS/Hermes导出通过，退出0；没有原生二进制 |
| `node scripts/check-build.mjs` | 包内资源及普通Node加载检查通过，退出0 |
| `pnpm install --offline --frozen-lockfile` | 926条锁定记录通过安装策略核验，退出0；未变更锁文件 |
| 不含忽略目录的源码副本文档检查 | 初次297当前文档，补报告后298；87决定、143源码锚点、108冻结文档通过，退出0 |
| `node scripts/package-web-container.mjs .runtime/merge-verification-2026-10-20/release` | 本地打包退出0，无凭据或数据库；没有构建/运行Docker镜像 |
| `pnpm exec playwright test --list` | 收集78文件、736案例；仅收集，不算执行通过 |
| 独立静态服务上的全量Playwright | 721通过、13失败、2跳过，共736，耗时38.8分钟，退出1 |
| `pnpm deps:audit` | 退出1：2 critical、5 high、1 low，未满足合并门槛 |

浏览器服务通过导出的 `webServer(resolve('apps/mobile/dist'))` 创建，不加载根.env或用户模型设置。URL为 `http://127.0.0.1:53791`，本次PID为2279076；实际命令为 `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:53791 pnpm exec playwright test --reporter=line --output=.runtime/merge-verification-2026-10-20/playwright-results`，串行执行，未与构建/性能任务并行。辅助脚本声称停止后，实测PID仍监听；核对命令和cwd后定向SIGTERM，确认进程退出、端口释放。未操作原3100服务或用户浏览器数据。

13项失败为下表7组场景：桌面7项，模拟移动视口6项。两项跳过是[既有宽屏考试入口条件](../../tests/mobile-e2e/quick-exam.spec.ts#L7)，不是本轮添加；未修改产品代码、断言或跳过条件。

## 浏览器失败定位

以下为已出现的失败点及静态/现场核对，不是已验证修复；失败之后的断言尚未执行，不把选择器或夹具过时归类为通过。

| 场景 | 现场与待处理约束 |
| --- | --- |
| [补图重解](../../tests/mobile-e2e/exam-flow.spec.ts#L56-L73) | 旧按钮文案与当前图片选择文案不符；仍需验证明确重解携带原图及补图、请求次数和刷新不重放 |
| [历史维护](../../tests/mobile-e2e/maintenance-layout.spec.ts#L49) | 差异仅派生摘要补写answerState；原记录/图片字节未变。源码与此测试均未相对main变化；应保留原件、损坏证据及零模型请求约束 |
| [多材料预览](../../tests/mobile-e2e/materials-multi.spec.ts#L44) | 新夹具未准备试卷而默认paper模式正确阻止预览；四张当前图片及替换像素断言仍需在有效准备状态验证，不等同图片丢失 |
| [导航](../../tests/mobile-e2e/navigation.spec.ts#L11) | 桌面导航含默认考试按钮与一个相机入口，旧广域按钮计数过时；源码/测试原已在main存在 |
| [逐题追问](../../tests/mobile-e2e/question-conversations.spec.ts#L11-L28) | 夹具只在第二个HTTP请求回503，现有有界重试随即拿到第三个成功响应；现场已显示解答而非失败状态。请求次数与用户轮次应分别建模 |
| [富文本图示](../../tests/mobile-e2e/rich-answer.spec.ts#L60-L65) | 全页“适应宽度”命中答案/步骤中两个控件；应明确目标图示并保留溢出、脚本与外链约束，不用任意first掩盖歧义 |
| [导出Escape](../../tests/mobile-e2e/style-audit.spec.ts#L145-L155) | 数字输入的Escape在[份数设置](../../apps/mobile/src/components/batch-copy-settings.web.tsx#L12-L13)回滚草稿并停止冒泡，与整窗关闭断言冲突。先明确分层键盘语义，尚未判定修改实现还是测试 |

## 审计阻断与后续

审计涉及既存锁定版本：proxy-addr 2.0.7、shell-quote 1.10.0、node-forge 1.4.0、braces 3.0.3、source-map-js 1.2.1、sharp 0.35.4、MCP SDK 1.30.0，以及remark-math间接使用的KaTeX 0.16.47。本分支没有升级这些既存版本；既有[发布待办](../project-status.md)的漏洞数量与此次一致。

注册表实际查询：proxy-addr 2.0.8、shell-quote 1.11.0、sharp 0.35.5和MCP SDK 1.31.0存在；node-forge当前1.4.0、braces当前3.0.3，查询通告建议的1.4.1/3.0.4均退出1且无匹配版本。不能将建议范围当作可安装版本，也未绕过审计、引入忽略名单或扩大为SDK整体升级。

下一步先按上述约束处理浏览器七组回归并复验；再按[既有定向依赖策略](../../.agents/notes/implemented/security/2026-10-04-dependency-overrides.md)处理可用修复、核对实际消费方兼容，对尚无发布修复的两包另行评估升级父包/移除受影响路径。消费方回归、冻结安装、类型、全量离线、构建和依赖审计全绿后，再提交当前成果并合并；新源码或依赖变更使本报告对应范围需要复验。

## 未验证项与限制

未运行真实付费模型、APK/Xcode编译、Android/iOS真机、跨浏览器、远端CI或生产部署。完整浏览器列表包含性能文件，但其通过也不等同真实设备INP或产品性能目标达成。打包清单的 `sourceDiffSha256` 仅覆盖未暂存diff，不是包含未跟踪文件的完整源码指纹；本轮仅验证打包可执行，不以该字段证明未提交发布的完整来源。

[当前CI](../../.github/workflows/ci.yml)直接执行Vitest，不调用容器/PDF Node专项或Playwright；本轮手工补齐这些本地入口，没有修改CI接线。远端作业与自动覆盖仍需单独推进。
