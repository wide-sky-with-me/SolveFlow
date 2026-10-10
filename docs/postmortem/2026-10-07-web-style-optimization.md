# 网页版样式优化与回归

日期：2026-10-07。

范围：当前工作区 RN/Expo 共享界面及本机 Web 导出；Chromium 桌面/手机视口、隔离 IndexedDB、合成图片与假供应商。没有付费模型调用、线上部署、APK 打包或手机安装。

结论：修复窄屏裁切预览压缩问题，完成横屏首页、桌面容器、辅助字号及设置分组优化。25 个正式浏览器场景在两个项目共 50 项检查最终通过；另有 1 个合成长答案检查通过。首次失败与复测分开保留，重复执行不增加场景数。

## 变更与处理

| 问题 | 修改与结果 |
| --- | --- |
| 320×568 开启裁切微调后，2:1 题图预览只有 86px 高 | [裁切界面](../../apps/mobile/src/components/photo-editor.tsx)为预览和手柄保留空间，小屏微调列表限高并滚动，横屏保留侧栏；最终实测 134px，原图比例与规范化逻辑不变 |
| 568×320 首页首屏只有插画，主要操作需滚动 | [空状态](../../apps/mobile/src/components/empty-state.tsx)使用小插画与左右布局；拍照、相册、初始配置按钮均在首屏完整可点击 |
| 桌面导航和补图入口横跨全屏，与居中正文脱节 | [宽度约定](../../apps/mobile/src/components/ui.tsx)供工作区、导航、补图、分页器和设置页复用；备份长文及弹窗保留较小阅读上限 |
| 导航文字仅 10px，核验状态部分为 11–12px | 导航改为 12px，核验状态改为 13px；已验证状态改用主题辅助色，明暗主题下状态文字对比度均达到 4.5 |
| 设置缺少区块层级，高级字段一直占空间 | [设置页](../../apps/mobile/src/components/settings.tsx)按考试、解题、校验分组；各模型可单独展开高级参数，折叠不重置值；连接结果仍滚动至对应提示 |

设置字段、默认值、完整 schema 校验和存储格式保持原有语义。布局分组后，连接反馈滚动位置加上所在区块偏移，避免把嵌套坐标误当整页坐标。相关当前说明归入[阅读与交互](../subsystems/rendering.md)。没有新增依赖。

## 验证结果

环境：Node 24.19.0、pnpm 11.7.0，Chromium 使用 `/usr/bin/google-chrome`。自有服务为 `http://127.0.0.1:56865`，PID 3313043；测试结束后关闭。

正式回归使用根 Playwright 配置，`SOLVEFLOW_TEST_WEB_URL` 指向上述本机地址。场景覆盖窄屏/横屏主操作、桌面对齐、裁切四边微调及保存、设置折叠/保存/刷新、独立校验配置、连接反馈、深度思考请求参数、主题对比度、备份标题、题号分页及减少动态效果。

| 实际命令或阶段 | 结果 / 退出码 |
| --- | --- |
| 上一轮样式复查：10 场景×2 | 18 通过、2 失败，均为裁切预览 86px；退出 1，保留在 `.runtime/web-style-review-2026-10-07/` |
| 优化前 `pnpm exec playwright test tests/mobile-e2e/responsive-ui.spec.ts --project desktop --output .runtime/web-style-optimization-2026-10-07/before-results --reporter=line` | 3 个新增场景全部失败；退出 1，旧构建未满足横屏首屏、桌面对齐和高级参数交互要求 |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm typecheck` | 均通过，退出 0；后者包含共享包、根测试与移动端类型 |
| `pnpm build:web`；最后的状态文字调整后 `pnpm --filter @solveflow/mobile build:web` | 均通过，退出 0；产物为 `apps/mobile/dist` |
| `pnpm exec playwright test tests/mobile-e2e/responsive-ui.spec.ts tests/mobile-e2e/style-controls.spec.ts tests/mobile-e2e/style-regressions.spec.ts tests/mobile-e2e/ui-consistency.spec.ts tests/mobile-e2e/production-ui.spec.ts tests/mobile-e2e/thinking-settings.spec.ts tests/mobile-e2e/pager-layout.spec.ts tests/mobile-e2e/motion-experience.spec.ts --output .runtime/web-style-optimization-2026-10-07/after-results --reporter=line` | 第一阶段 48 项通过，退出 0，1.4 分钟 |
| 最终产物定向运行 `responsive-ui.spec.ts` 和 `style-controls.spec.ts`，输出到 `final-results` | 8 通过、2 失败，退出 1；新增刷新断言在异步保存完成前刷新，截断了保存操作；状态字号/对比度与其余场景均通过 |
| `pnpm exec playwright test tests/mobile-e2e/responsive-ui.spec.ts --grep 'advanced model' --output .runtime/web-style-optimization-2026-10-07/save-results --reporter=line` | 等待应用保存完成、设置弹窗关闭后刷新，两个项目均通过，退出 0；保留容量 65536、输出上限 4096 的断言，未放宽阈值 |
| `pnpm exec playwright test --config .runtime/web-style-optimization-2026-10-07/playwright.config.ts visual-long --project desktop --output .runtime/web-style-optimization-2026-10-07/long-results --reporter=line` | 1 个补充场景通过，退出 0；1440×900 亮色、320×568 亮色、390×844 暗色下长答案、公式局部滚动和追问可达；整页无横向溢出 |

去重后正式检查为 50 项。最终补测只修正测试的刷新时机，没有修改产品持久化实现。截图改用 `testInfo.outputPath`，避免覆盖旧日期的证据。

新日志、截图、裁切尺寸、源文件修改前快照和最终 HTML/JS 哈希保存在忽略目录 `.runtime/web-style-optimization-2026-10-07/`。人工检查了桌面、390×844、320×568、568×320 的截图及明暗主题、弹窗/高级参数效果。`pnpm lint`（含文档检查）和修改范围内的 `git diff --check` 均退出 0。

## 未验证项与剩余风险

浏览器移动视口不代表 Android 真机验收。共享 RN 样式有变化，但本轮未生成 APK、安装手机或验证原生安全区/系统字体放大；Safari、Firefox、实体相机、真实供应商 CORS 及线上缓存更新均未验。原有模型准确率与核验超时问题不属于本次样式修复，参见[可靠性验收](2026-10-07-exam-reliability-repair.md)。
