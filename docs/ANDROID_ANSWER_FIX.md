# 安卓解答正文空白修复（2026-09-16）

> 真机后续已完成：iQOO Neo9上复现0.1.2仍有桥接时序故障；0.1.3补齐加载前注入钩子后，三次冷启动、公式/步骤/最终答案、知识点展开和原生追问入口均通过。用户手机已覆盖安装0.1.3。下文0.1.2记录保留为历史，最终验收见末节。

用户在0.1.1真机上已能完成解题，但只看到原生界面的“模型独立校验通过”，图文正文未显示。用户反馈证明解题已走到终态，不等于图文展示已验收。本轮仅修复展示，不更改模型、Pi循环、校验或历史数据格式，不新增付费调用。

## 原因与修复

锁定的 `react-native-webview@13.16.1` 安卓 `RNCWebView.java` 将 `injectedJavaScriptObject` 放入 JavaScript 模板字符串；Expo 57.0.22 DOM启动页再读取该函数并JSON解析。原先直接传入候选对象，题目/解答里的换行、引号、LaTeX反斜线会被模板字符串提前解释，导致启动阶段JSON解析失败或内容变化。反引号和插值表达式也不能直接经过这个边界。独立校验标记是RN文本，所以仍会显示。

- `packages/client/src/answer-payload.ts`：版本化、schema校验的答案封包，使用percent编码传入；DOM端解码后再次校验。只有编码字符串经过初始注入，不修改上游依赖。
- `apps/mobile/src/dom/answer-document.tsx`：解包后沿用原有题干、KaTeX、原图裁片、图示和知识点渲染，挂载后确认正文就绪。
- `apps/mobile/src/components/answer-panel.tsx`：展示加载状态；加载错误、WebView进程异常或10秒无就绪通知时，显示已保存的文字解答和“重新加载解答”。此按钮只重新挂载文档，不发起解题/付费请求。
- `apps/mobile/src/document-props.native.ts`：给ScrollView中的WebView容器明确初始宽度和最小高度，再由DOM内容测量调整高度；保留原有文件、导航和桥接权限限制。

旧SQLite记录无需迁移，重新打开历史题目即可使用新渲染路径。未升级SDK、引入依赖或将服务端环境配置放入APK。

## 验证

先复现旧注入方式遇到数学答案换行时的 `Bad control character in string literal`，再加入安全封包回归。测试使用合成题目，不读取用户题图。

- `pnpm exec vitest run`：591项/62文件通过，包括真实模板字符串注入模拟、公式/换行/引号完整往返、插值攻击文本、损坏与过长载荷拒绝。
- `pnpm typecheck`、移动端独立typecheck、`pnpm lint`：通过。
- `pnpm --filter @solveflow/mobile build:web`：通过。
- `node /tmp/solveflow-web-regression.mjs`（临时随机端口服务运行 `pnpm exec playwright test`，结束后关闭）：52项完整桌面/移动浏览器回归通过，含旧记录加载、富文本、知识点、多题追问和完整本地流程。
- `node scripts/test-android-document.mjs`：新APK实际解包资源测试通过，包含初始注入、题干、公式、原图/图示、知识点、追问桥接、内容高度变化、320px宽度、离线加载及插值攻击不执行。
- `JAVA_HOME=/home/yhr/.sdkman/candidates/java/current pnpm mobile:apk`：通过；签名校验、与0.1.1同证书检查、版本及资源检查、服务器配置泄露扫描通过。

打包资源验收命令：`node scripts/test-android-document.mjs [APK路径]`。脚本解包APK中的HTML/JS/CSS，使用Chromium的file页面、锁定Expo测量脚本和安卓初始注入方式，检查离线资源、公式、原题图片、图示、知识点、追问桥接与320px布局。它与普通Web E2E不同，但仍不等同安卓真机WebView/Yoga验收。

本轮没有修改服务端存储/接口，未重跑数据库集成测试。iOS原生构建继续暂停。

## 安装包

- 版本0.1.2，versionCode 3，包名 `com.solveflow.app`，Android 7+、ARM64内部测试包。
- 路径 `.runtime/artifacts/solveflow-arm64-local.apk`，40,791,118字节。
- SHA-256：`32208f963a06a6477c42a91ce5b1ffa833b3cf4e5add7ab68d1a8dbb2ed3b1ae`。
- 同证书覆盖安装；保留本地数据和配置，不要卸载旧版。打开历史题目查看即可，无需重做解题。
- 原Google云盘文件已更新为 `solveflow-0.1.2-arm64.apk`，回读ID、文件名和40,791,118字节大小一致：[下载APK](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。
- 0.1.2仍需安卓真机复核；开发环境没有连接设备，Chromium包内资源验收不替代真机结论。

## 0.1.3 真机修复与验收

用户连接iQOO Neo9（Android 16，系统WebView 151.0.7922.200），明确授权直接操作，并在手机确认USB调试。通过Windows ADB同签名覆盖安装，未卸载、清空数据或修改模型设置。

0.1.2真机只显示文字兜底。临时诊断包的DevTools捕获到：`Failed to parse injectedObjectJson: window.ReactNativeWebView.injectedObjectJson is not a function`。页面加载完后函数虽存在，初始props已缺失，root为空、高度为0。锁定RNCWebView的 `callInjectedJavaScriptBeforeContentLoaded()` 仅在加载前脚本非空时，才在onPageStarted重新注入初始对象函数；旧配置未提供此钩子，页面解析先于onPageFinished的注入。这是此前字符串转义修复之外的第二个故障。

正式改动只在 `apps/mobile/src/document-props.native.ts` 增加 `injectedJavaScriptBeforeContentLoaded: 'true;'`，触发锁定SDK的早期注入；保留编码封包、10秒加载兜底和原权限限制。诊断时临时开启的WebView调试已移除，正式版本0.1.3/versionCode 4。

实际验证：

- 正式0.1.3覆盖安装成功；连续三次force-stop→启动→历史解答恢复均显示真实WebView和解题步骤，无空白/加载失败。
- 真机截图确认题干、行内/独立公式、分步解析和最终答案正常；上下滚动可到达知识点及题内追问。
- 点击知识点展开，详细解释正常；点击“追问这个知识点”，原生输入框聚焦并带入对应知识点内容。未点击发送，测试草稿已通过重开应用清除。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm lint`、`git diff --check`通过；`pnpm mobile:apk`通过。
- `node scripts/test-android-document.mjs`增强为先复现晚注入导致空白，再验证早注入正常；针对最终APK运行通过。
- APK版本/同证书/资源/服务器配置隔离扫描通过。本次只有原生配置与版本增量，未重复与之无关的全量Web/数据库测试；此前591项单元和52项Web回归见上文。

最终产物 `.runtime/artifacts/solveflow-arm64-local.apk`：40,791,118字节；SHA-256 `9771205d41c367d64b64e98c723817bdae35080d84265972fd7262faf4484032`。原云盘文件已替换为 `solveflow-0.1.3-arm64.apk` 并回读文件名/大小一致。手机已安装此版本，原题目和配置保留。

真机证据仅在忽略目录 `.runtime/device-check/`，不提交真实截图/题目。临时调试转发和手机上的临时UI文件已删除。没有重新调用真实模型，未验证新的付费追问、其他安卓设备或iOS。
