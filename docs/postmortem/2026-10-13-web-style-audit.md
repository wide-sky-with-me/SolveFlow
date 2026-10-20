# Web 页面与 PDF 弹窗样式验收

日期：2026-10-13，Asia/Shanghai。

范围：当前工作树的 Expo Web 构建；Chrome、全新浏览器上下文与合成单题/11题批次。检查首页、我的、设置及高级参数、题页、历史、备份恢复、PDF 导出/图片整理/长设置/预览。常规矩阵为1440×900、1100×600、390×844、320×568、568×320、740×390，浅深主题；另验证1600×1000缩为390×1000后的追问草稿和控件。没有操作原浏览器数据，也没有真实模型调用。

结论：修复四类可复现问题，保留现有主题、层级、布局与导出算法。相关功能回归70项通过；构建、类型检查通过。全量离线单测1202项通过、1项失败，失败为既有兼容入口缺少导出，并非全仓检查全部通过。

## 问题与最小处理

- 中：PDF长题目列表选到末项、关闭并重新打开，末项虽获焦点却不可见，视口比例为0。[选择器](../../apps/mobile/src/components/pdf-picker.web.tsx#L21)取消初始焦点的`preventScroll`，让浏览器将选中项滚入菜单；方向键、Enter、Tab与Escape行为保留。
- 中：打开批量设置后，在淡入结束前按Escape会关闭主导出弹窗。React Native Web在入场动画结束后才登记上层Modal。[导出组件](../../apps/mobile/src/components/batch-pdf-export.web.tsx#L58)在设置打开期间优先关闭嵌套草稿；正常动画与减少动态效果均验证，主弹窗、已应用份数和源记录保留。
- 低：宽题页缩为窄屏后，自动滚动使追问发送按钮底边裁切0.1875px；568×320的PDF批量设置入口也出现视口比例0.99609375。[阅读滚动区](../../apps/mobile/src/workspace/desktop.web.css#L174)和[PDF正文](../../apps/mobile/src/components/batch-pdf-dialog.web.css#L3)增加8px滚动内边界，未扩大内容间距或改变原生布局。修复前仅注入这一属性即可使追问按钮完整可见，随后落实到源码。
- 低：答案区“校验”被末级选择器覆盖为14px，与现有紧凑控件13px约定冲突。[答案样式](../../apps/mobile/src/dom/answer.css#L121)统一为13px，保留44px以上触达区域。

[新增回归](../../tests/mobile-e2e/style-audit.spec.ts)覆盖末项重开、菜单键盘导航、十份长设置末题输入和固定操作栏、嵌套Escape及焦点恢复、动画期间快速Escape、字号/触达区域、缩屏草稿与存储不变。继续使用完整可见比例1，未放宽断言。当前交互说明同步到[渲染子系统](../subsystems/rendering.md)。

## 验证结果

所有命令在仓库根执行。Node实际为v24.21.0，项目要求24.19.0；pnpm11.7.0。引擎版本警告保留，不替换依赖或锁文件。

- `pnpm build:web`：基线、首轮修复与最终PDF滚动修复构建均退出0；基线静态产物保持独立。
- 基线：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3147 pnpm test:e2e:functional tests/mobile-e2e/desktop-layout.spec.ts tests/mobile-e2e/responsive-ui.spec.ts tests/mobile-e2e/style-regressions.spec.ts tests/mobile-e2e/ui-consistency.spec.ts tests/mobile-e2e/batch-pdf-export.spec.ts --output=.runtime/style-audit-2026-10-13/baseline-tests`：30通过、4失败，退出1；分别为窄屏追问裁切与校验字号，在两个浏览器项目复现。
- 新增基线：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3147 pnpm test:e2e:functional tests/mobile-e2e/style-audit.spec.ts --project=desktop --output=.runtime/style-audit-2026-10-13/new-tests-before-final`：四项均失败，退出1；确认菜单末项、PDF短屏裁切、字号/追问裁切与快速Escape。首轮修复复测三项通过，仅剩PDF滚动边界失败，退出1；随后补入同一最小滚动修复。
- 最终：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3148 pnpm test:e2e:functional tests/mobile-e2e/desktop-layout.spec.ts tests/mobile-e2e/responsive-ui.spec.ts tests/mobile-e2e/style-regressions.spec.ts tests/mobile-e2e/style-controls.spec.ts tests/mobile-e2e/ui-consistency.spec.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/style-audit.spec.ts --output=.runtime/style-audit-2026-10-13/final-e2e`：70通过，退出0。包括合成模型下的真实PDF/十份ZIP下载、取消与缓存、纯题目模式、旋转/裁切、深色与窄屏。随后将截图时机移到有限动画结束后，`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3148 pnpm test:e2e:functional tests/mobile-e2e/style-audit.spec.ts --output=.runtime/style-audit-2026-10-13/final-settled-e2e`再次8项通过，退出0；不重复计入70项。
- `pnpm typecheck`：退出0。`pnpm test`：1202通过、1失败，退出1。`pnpm exec vitest run tests/unit/client-entries.test.ts`独立复现，退出1；[兼容入口](../../packages/client/src/index.ts)未导出`collectBatchPrint`，[分入口](../../packages/client/src/local.ts)存在该导出。入口源码及[失败测试](../../tests/unit/client-entries.test.ts#L13)均无工作树差异。本轮仅记录，未扩展到包接口修改。
- `STYLE_AUDIT_PHASE=before SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3147 python .runtime/style-audit-2026-10-13/audit.py`与相同命令的`after`/3148：均退出0，每阶段139张截图，页面异常、额外外部/写请求、文档横向溢出均为0。元素级候选含有意滚动容器、隐藏KaTeX辅助文字和省略标题，不将其原始计数当成真实溢出缺陷。

`pnpm lint`首次及中间复测的边界检查通过，文档检查因新增说明超过渲染页既有2200单位预算而退出1；逐步精简后最终退出0，含`pnpm docs:check`通过。未放宽预算或改动既有说明；详细失败与复测日志均保留。

## 证据与隔离

完整日志、DOM指标、截图与基线/修复产物只保留在本机 `.runtime/style-audit-2026-10-13/`，不随仓库分发。下列路径均相对此目录。`before/metrics.json`明确指向3147，`after/metrics.json`明确指向3148；每个阶段使用全新上下文。首次审计因环境配置请求悬挂而超时，退出1；给测试请求返回404空对象后通过。一次复拍误用了环境变量名，指向基线的结果另存`after-wrong-origin`，不作为修复证据。

- 菜单重开：修复前末项隐藏见 `new-tests-before-final/style-audit-a-reopened-lon-2909f-yboard-option-fully-visible-desktop/selected-1440x900-light.png`，修复后完整显示见 `final-settled-e2e/style-audit-a-reopened-lon-2909f-yboard-option-fully-visible-desktop/selected-1440x900-light.png`。
- 追问：修复前裁切见 `before/follow-up-clipped.png`，修复后完整可见及草稿见 `final-e2e/style-audit-answer-control-a53b4--desktop-to-narrow-resizing-desktop/answer-bottom-390x1000-light.png`。
- 快速Escape：修复前主弹窗消失见 `new-tests-before-final/style-audit-Escape-during--f2ee1-isses-only-the-nested-draft-desktop/test-failed-1.png`，修复后主弹窗保留见 `final-e2e/style-audit-Escape-during--f2ee1-isses-only-the-nested-draft-desktop/settings-early-escape-no-preference.png`。

深色短横屏长设置截图 `final-settled-e2e/style-audit-long-PDF-setti-239dd-ested-Escape-in-both-themes-desktop/settings-bottom-740x390-dark.png`确认末题可达、关闭及应用栏完整；这一证据在动画结束后拍摄，排除淡入期间透底。

保护清单覆盖开工时全部21个已改动/未跟踪文件，SHA-256复核无变化。原有下载分页修复及同名用户单测均保留；没有提交、推送、部署或替换用户服务。新增测试使用隔离IndexedDB，并核对源文档未改写；相关PDF回归仅使用合成请求，未连接真实模型。自建3147/3148服务已停止，原进程与内核监听均消失，清理证据保存于 `cleanup.json`；一次连接探测超时，改用进程与内核事实确认。

## 未验证项与剩余问题

未验证Android/iOS真机、真实软键盘、Safari/Firefox、屏幕阅读器、真实性能指标、生产服务、真实模型接通、实体打印和所有真实题目。Playwright的`mobile`项目仍是Chrome模拟视口，不是真机验收。全仓兼容入口失败仍需另行处理；Hindsight在本工作区禁用，已尝试检索/诊断，未将历史记忆作为当前证据。
