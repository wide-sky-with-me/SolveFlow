# 0.1.24 多题图文展示失败修复

日期：2026-09-17。用户反馈最近再次解答失败；实际当前界面提示“图文解答加载失败，已保留结果”。

## 证据与原因

应用内诊断显示本次模型三轮调用正常结束：首轮响应头2.3秒、toolUse 6.9秒；第二轮toolUse 14.1秒；第三轮响应头15.7秒、stop 22.1秒；任务完成22.3秒。三题答案已保存，未自动调用Verifier。因此这次反馈对应前端展示失败，没有证据说明模型解题失败。

0.1.22在第二题重新加载仍失败；冷启动后第一题正常显示。随后用同一份已保存答案快速切到第二、第三、第一题，等待超过10秒再回第二题，再次出现图文加载失败。测试没有重发原图或调用模型。

代码检查发现两个相互关联的缺陷：

1. QuestionPager保留已访问的隐藏题页，加载期限却只判断AppState，隐藏页仍会在10秒后被标记失败。
2. AnswerDocument将onReady依赖于document.fonts.ready；Android隐藏WebView可延后字体/布局完成，已提交的答案因此不能及时报告就绪。失败后原组件被卸载，原来的迟到就绪无法恢复它。

这两条均由回归独立复现：隐藏页单元用例先失败；实际0.1.22 APK解包，在字体就绪Promise保持pending、RAF暂停时，正文已存在但onReady始终未到达。没有WebView崩溃栈，不将该现象归因为Android渲染进程崩溃或供应商异常。

## 修改

- question-page-activity.ts / question-pager.tsx：提供当前题页是否可见的信息，保留每题草稿和原有页面状态。
- answer-panel.tsx / document-deadline.ts：仅前台且可见题页计算加载期限，切回后重新给予正常加载时间。
- answer-document.tsx：React提交答案后报告就绪；字体完成仍触发原有高度/公式测量，不再决定答案是否加载成功。
- 不变更模型、提示词、结果协议或用户记录，也不通过重新解题掩盖显示错误。

## 验收

隐藏页、前后台暂停和高度稳定相关4项单元测试通过；pnpm typecheck、pnpm lint通过。实际APK字体等待回归、手机三题切页和最终安装正在进行，完成后追加真实结果。

### 第一轮修复边界

0.1.23首包完成字体/隐藏页修复，实际APK字体pending探针通过，桌面/移动分页与手动校验6项通过。旧启动测试要求卡在开屏或字体超时后显示失败，这与本次修复目的冲突；改为要求字体未完成时答案可读、超过原10秒期限不误失败，4项均通过。没有删除公式、卡片、交互、零模型请求断言。

但覆盖安装后的真机仍发生加载失败，说明前述两个缺陷不足以解释/解决全部现场故障。本轮不宣布修复完成，继续通过临时USB WebView诊断查启动路径，正式交付前关闭调试并重新打包。

## 最终根因：初始数据桥接竞争

临时启用USB WebView调试，在真实第二题启动时直接捕获异常：`Failed to parse injectedObjectJson: window.ReactNativeWebView.injectedObjectJson is not a function`。稍后同一个页面的接口已成为function、能读到完整初始数据，但article仍不存在；第一和第三题可正常建立article。异常发生在Expo生成HTML的初始数据读取脚本，早于应用React渲染。

锁定RNCWebView 13.16.1使用异步evaluateJavascript注入该方法；原来的`injectedJavaScriptBeforeContentLoaded: 'true;'`只能触发早期注入，不能保证HTML入口先后顺序。[上游官方参考](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)也说明Android早期脚本注入并非完全可靠。依据是已安装源码和真机异常，未把上游main文档当作本项目锁定版本已修复的证明。

最终修复通过Expo配置插件`with-dom-bootstrap.cjs`接入当前Gradle的BundleHermesCTask，在打包本项目生成的三个本地HTML资源时运行`prepare-dom-bootstrap.mjs`：等待原生接口和初始props有效后，再按顺序加载原来的本地入口脚本。最多160次、25ms间隔；销毁页面取消，缺失数据失败关闭。保留原契约的运行时校验和本地路径限制，不执行题目文本、不升级/修改node_modules，也不重写Pi循环。插件在正常prebuild/原生构建中生效，不依赖手工改APK。

先对真实解包资源做修复预检：晚到桥接已恢复、早到桥接也通过；公式、图片、三文档、240px、字体pending、暂停RAF、安全注入均通过。新增启动适配3项单元测试覆盖接口/数据迟到、等待上限、销毁清理、未知模板与非本地入口拒绝；与加载期限/高度稳定共7项通过。实现初版被测试发现String.replace将双美元符号当替换语法，已改为回调替换并复测通过；该初版没有交付手机。

临时USB端口转发已移除，源码已恢复关闭WebView调试；正式0.1.24已构建并重新验收真机，结果如下。

## 最终交付与真机结果

- `pnpm mobile:apk`退出0，Gradle成功执行三个本地HTML的启动适配；0.1.24 / code25，43,780,777字节，SHA256 `a44f91bc32b182427e1e0dc1a75ac519af866e96581907636e9e2d6656d150c0`。
- 同签名覆盖兼容、4项服务端真实私密配置扫描、Hermes/SQLite/本地图文资源检查通过。
- `node scripts/test-android-document.mjs`使用最终APK通过：原生接口迟到时自动恢复启动，字体pending/RAF暂停、简洁多题payload、历史桥接、公式/图像/图示、240px及注入安全均通过。
- 手机安装命令在系统确认等待中超过120秒；用户随后确认安装，读回versionName=0.1.24、versionCode=25。以实际读回结果为准，没有把命令超时记成安装成功。
- 真机原失败顺序：快速2→3→1，停留11秒，再依次检查2→3→1→2，四次均有WebView和答案、没有加载失败或卡住；冷启动后第一、第二题均恢复。记录在忽略目录`.runtime/recent-answer-review/v124-acceptance.json`。
- 通过手机当前进程的Unix socket检查，WebView调试端口确已关闭；临时USB端口转发已移除。测试未重发原题、未调用模型、未清除历史或配置。

本轮没有修改模型/Agent行为，未重复付费评测；未进行iOS构建和全程息屏验收。浏览器测试采用本地假模型，真实手机检查读取本次已保存的模型结果，两者不混称。

收尾：第三题曲线、0.5/整数刻度与三个点标签实际显示正常。最后截图遇到无关通知横幅，已删除该截图，未操作通知；随后检测到用户切换应用，立即停止界面操作。临时常亮设置恢复false、手机临时XML已清理、本轮Web测试服务已关闭。额外的最终像素稳定性截图比较因此未继续，不能据此宣称本版完成了该项测量。
