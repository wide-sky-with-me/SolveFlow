# 页面 UI 与生产就绪复核

日期：2026-10-03。

范围：设备应用的页面交互、浏览器回归及 0.1.71 / code 72 的 Android 安装；不改变模型、提示词、持久化协议或依赖版本。

结论：两个 UI 问题修复并通过相关回归；截至本次验收，可继续小范围实际试用，尚不满足正式生产发布条件。

后续证据：[原生存储](2026-10-03-android-storage.md)、[依赖加固](2026-10-04-dependency-hardening.md)、[0.1.73 安装](2026-10-04-android-install.md)。它们不计入本报告成绩，维护中的待办见 [发布状态](../project-status.md)。

## 变更与处理

- 320×568 设置页只有表单底部可返回；启用独立校验模型后，解题模型连接失败提示在长表单底部，屏幕内看不到。修复前两个移动视口用例均因 `toBeInViewport` 失败；元素存在不等于用户能看到。
- 新增 [固定页头](../../apps/mobile/src/components/page-header.tsx)，用于设置、导出、恢复和记录维护。返回与标题不随正文滚走，保留主题、触控尺寸及忙碌时的退出约束。
- [设置页](../../apps/mobile/src/components/settings.tsx) 将连接进度和结果放到相应角色按钮附近，并滚动显示结果。保留脱敏、15 秒取消期限及原请求次数，不增加重试。
- [新回归](../../tests/mobile-e2e/production-ui.spec.ts) 覆盖小屏长表单返回、429 反馈在视口内、无供应商原文泄露，以及明暗主题的短横屏备份页面。截图按测试输出目录隔离。

## 验证结果

### 构建与浏览器

- `pnpm build`：修改前基线通过，含三端 JS/Hermes 和本地文档资源，不是原生 IPA。修改后 `pnpm --filter @solveflow/mobile build:web` 通过。
- `pnpm typecheck` 通过。构建共享包后，`pnpm exec vitest run --maxWorkers=2` 全部 97 文件、836 项通过。首次受沙箱本机端口/子进程限制，99 项失败；记录保留，允许本机测试后同命令通过，未修改断言。
- 专用静态服务 `http://127.0.0.1:42327`，用 `SOLVEFLOW_TEST_WEB_URL` 指定，验收后已停止。`production-ui`、`ui-consistency`、`model-failures`、`thinking-settings` 共 18 项通过，含桌面与移动视口。
- 扩展 Playwright `style-controls`、`style-regressions`、`theme`、`navigation`、`motion-experience`、`history-export`、`history-import`、`storage-recovery`、`history-management`、`exam-settings` 共 54 项通过；与上述合计 72 项。覆盖相机拒绝权限、裁切、触控/文字对比、主题切换、弹层关闭和减少动态效果、草稿保留、考试快照及备份/损坏恢复。存储故障注入只在隔离浏览器中执行。
- 调整截图输出隔离后，新用例 6 项再次通过，属于上述场景的复跑，不累计为 78 项；根 TypeScript 再次通过。`pnpm lint`、文档与 diff 检查通过，43 份当前文档、7 篇决策、8 处源码锚点和 108 份冻结档案保持有效。
- 原始日志与截图存于忽略目录 `.runtime/ui-production-2026-10-03/`，没有付费模型调用。使用合成数据的浏览器验证与下述真机检查分别记录。

### APK 与真机

`GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` 成功。0.1.71 / code 72，ARM64 内部签名，17,254,518 字节；同证书、5 项私密值、Hermes/本地资源与外部播放器排除检查通过。`node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.71.apk` 通过实际包内公式、桥接、布局和注入检查，不等于原生帧率测试。

产物 `.runtime/artifacts/solveflow-arm64-local-0.1.71.apk`；SHA-256 `f227898430f23a7e906ffa2002662be1636b1f957d129b45eebdf05efff03673`。通过 `adb install -r` 从手机 0.1.69 覆盖升级；读回版本并计算已安装 base.apk 的哈希，与产物一致。

iQOO Neo9 / V2338A，1260×2800，保留用户原有深色主题和系统字体：

- 设置页进入、两次长滚动、顶部返回通过；返回按钮 bounds 始终为 `[70,168][253,322]`。设置、导出、恢复页截图复查未见标题/操作遮挡。
- 恢复入口打开厂商系统文件选择器 `com.android.filemanager`；取消后显示“已取消恢复”，按钮重新可用，正常返回。没有选取、恢复或覆盖任何文件；导出页仅检查布局，未执行真实导出。
- 升级前后个人页均为 149 道题，未清库、改密钥/模型配置或系统设置。结束时返回原先的桌面；没有付费、相机拍摄或分享发送。

首轮临时真机脚本在选择器切换时立即读取 Activity，未取得已恢复 Activity，且预设了 AOSP DocumentsUI。确认实际厂商选择器后，改为等待 UI 稳定并验证其包名；同组重跑通过，首次日志保留。这是测试脚本时序/平台假设修正，没有修改应用来绕过断言。

本轮没有重新测量切题帧率、逐帧白屏或长期内存；此前仍有慢帧的观测见 [0.1.69 真机报告](../DEVICE_ACCEPTANCE_0_1_69.md)。0.1.71 包的文件选择取消通过，不代表原生大卷恢复或磁盘故障已验收。

## 未验证项与剩余风险

`pnpm audit --json` 返回 19 条通告：6 high、10 moderate、3 low，无 critical。高危路径为保留服务端 Pi coding-agent 的 undici，以及 Expo/Metro 构建链的 brace-expansion、node-forge、braces。这是安装依赖图的通告数，不能等同于 APK 有 6 个可利用漏洞。

本次生成的设备 Agent esbuild 元数据有 1028 个输入，未包含上述模块或 pi-coding-agent；这只证明该 bundle 的排除，不能替代整包漏洞分析。参考 [undici WebSocket 通告](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5)、[特定 BalancedPool TLS 配置通告](https://github.com/advisories/GHSA-w293-vg96-wgc3)、[node-forge 通告](https://github.com/advisories/GHSA-86w9-cpqp-85rv)。依赖处理需按实际执行路径评估并独立升级回归，本轮没有批量升级 SDK。

完整准确率仍以 [641 次历史主测](../UAT_UK_LIVE_EVAL_2026_10_02.md) 为依据，其中存在答错却校验通过；[后续定向复测](../MODEL_RELIABILITY_2026_10_03.md) 不能代替完整题集复测，也不能证明所有题型达到发布性能目标。

磁盘满、强杀写入和大库分卷恢复须使用隔离设备/数据验收；不向用户手机注入故障。更多机型及超长答案性能、远端 CI 与分支保护仍未验收。保留服务路径的部署和隔离 Python、iOS 原生不在本轮范围；浏览器合成数据回归不代表这些路径已通过。
