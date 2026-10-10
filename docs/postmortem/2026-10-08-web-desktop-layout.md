# Web 宽屏布局与原生隔离验收

日期：2026-10-08。

范围：本机 Web 导出、隔离 Chromium、合成图片及假模型；桌面与触摸浏览器配置。iOS 只检查 Hermes 导出和模块选择，不操作正在进行的 Mac 模拟器验收。

结论：宽屏首页、主导航、个人页和设置布局已调整，去重后 26 个场景在两个浏览器配置共 52 项检查通过。Web 桌面模块未进入 iOS 主包源码映射；本轮不代表 iOS 原生交互或真实模型验收。

## 变更与处理

原宽屏仍使用纵向手机布局，首页内容靠上、主导航远在底部，个人菜单和模型表单过宽。现在工作区居中并保留外侧留白，主导航移到顶部；首页插画与操作横排，个人页统计与菜单并排，解题与校验配置双列。

[桌面 CSS](../../apps/mobile/src/workspace/desktop.web.css)只从 `startup.web.ts` 导入，在宽度至少 1100 px、高度至少 600 px 时生效。窄屏和短横屏沿用原布局，窗口缩放不卸载题目或追问草稿。[品牌组件](../../apps/mobile/src/components/app-brand.web.tsx)只在 Web 渲染，原生同名默认组件返回空；共享组件仅补定位标记和品牌入口。

iOS 的 `MotionModal` 安全区域、设置 `KeyboardAvoidingView`、Expo 配置、原生工程和测试脚本均未由本轮修改。没有新增依赖、提交或 worktree 合并；Web 模块隔离已足够，不需要另开工作树。

## 验证结果

Node 24.19.0、pnpm 11.7.0，通过本机 Node/corepack 缓存入口执行以下 pnpm 命令。使用本次应用户要求启动的服务 `http://127.0.0.1:3100`，PID 4141328；交付后保留服务供用户测试。浏览器上下文独立，不操作用户题目或密钥。

| 实际命令或检查 | 结果 / 退出码 |
| --- | --- |
| 旧构建运行 `pnpm exec playwright test tests/mobile-e2e/desktop-layout.spec.ts --project desktop --grep 'wide home' --timeout=15000` | 新宽屏要求复现失败，1 项失败，退出 1；旧截图保留 |
| `pnpm --filter @solveflow/mobile typecheck` | 初次退出 2，Web 品牌使用的 `dataSet` 不在 RN 类型中；改成 Web 专属 HTML 属性后退出 0 |
| `pnpm exec tsc --noEmit` | 根源码与测试类型通过，退出 0 |
| `pnpm --filter @solveflow/mobile build:web` | 成功导出并更新 `apps/mobile/dist`，退出 0；最终品牌分行调整后再次成功 |
| `pnpm exec playwright test` 加下列第一组文件 | 42 项通过，退出 0 |
| `pnpm exec playwright test tests/mobile-e2e/desktop-layout.spec.ts tests/mobile-e2e/batch-solving.spec.ts` | 14 通过、2 失败，退出 1；新增缩放测试误要求窄屏无需滚动即可完整看到追问按钮 |
| `pnpm exec playwright test tests/mobile-e2e/desktop-layout.spec.ts --grep 'resizing a wide answer'` | 先正常滚动到追问，再保留完整可见断言并增加实际命中检查；2 项通过，退出 0，未改产品或放宽可见比例 |
| `pnpm --filter @solveflow/mobile exec expo export --platform ios --source-maps --output-dir ../../.runtime/web-wide-2026-10-08/ios-export` | Hermes 与 DOM 导出通过，退出 0；不是 Xcode 原生编译 |
| `pnpm lint`、`git diff --check` | 均退出 0；包含源码边界和文档检查，报告收尾后另跑 `pnpm docs:check` |

第一组文件均在 `tests/mobile-e2e/`：`desktop-layout.spec.ts`、`responsive-ui.spec.ts`、`navigation.spec.ts`、`production-ui.spec.ts`、`settings-role-validation.spec.ts`、`style-controls.spec.ts`。浏览器命令使用 `--reporter=line`，输出分为本轮 `before-results`、`after-results`、`final-results` 与 `resize-results`；重跑场景不累计。

检查覆盖 1280/1600/1920 宽屏和明暗主题，窄屏与短横屏入口、导航动画、模型角色校验、配置保存、连接反馈滚动、备份返回、单题与批量、窗口缩放和追问草稿。人工查看首页、历史、个人页、双列设置及答案截图。

读取 iOS 主包 `.hbc.map` 的 `sources`：包含 `app-brand.tsx`，未包含 `app-brand.web.tsx`、`startup.web.ts` 或 `desktop.web.css`，检查退出 0。证据、截图及隔离导出在忽略目录 `.runtime/web-wide-2026-10-08/`。

## 未验证项与剩余风险

本轮未重新执行 Mac/Xcode 模拟器或真机验收，不改变[并行 iOS 验收](2026-10-08-ios-simulator.md)的证据范围。Safari/Firefox、真实供应商 CORS、实体相机、线上发布及模型准确率未验；CSS 使用的浏览器能力仍需对应浏览器实测。浏览器触摸配置不能代替原生设备。
