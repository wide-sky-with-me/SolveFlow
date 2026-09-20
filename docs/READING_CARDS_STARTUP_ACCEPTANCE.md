# 0.1.9 阅读卡片与启动衔接（2026-09-16）

## 修改

- 题目、答案、详细步骤、知识点各自使用白色圆角卡片，浅灰背景和12px间距明确分区；题干更正移入题目卡片，原图按钮仍在题目旁。详细步骤保持默认折叠，展开后图示与步骤留在同一卡片；知识点独立展开、追问。多题和同题追问仍按原来的题目分组。
- 去掉解答外围的大白色容器，追问输入使用独立卡片，文字降级结果也按题目/答案/步骤/知识点分卡。
- 修复启动时序：原生开屏保持提前到入口模块；SafeAreaProvider使用原生初始安全区尺寸；启动恢复等待模型配置、本地题目、当前各题的答案DOM字体与布局反馈后，才允许开屏淡出。加载成功或10秒文字降级都能结束启动，不会无限等待图文组件。
- 启动就绪记录仅在首次恢复阶段收集，之后停止；不累计用户浏览过的题目。没有额外固定开屏延迟、路由切换、数据库迁移或模型请求。

主要实现：`apps/mobile/src/app.tsx`、`index.ts`、`components/question-thread.tsx`、`answer-panel.tsx`、`dom/answer-document.tsx`、`answer-content.tsx`、`problem-statement.tsx`、`knowledge-panel.tsx`、`answer.css`。

## 回归与验收

- 修改前用真实延迟字体资源复现：字体请求尚未完成时，旧版开屏已消失；测试按预期失败。日志`/tmp/solveflow-v19-before.log`。
- 新增`tests/mobile-e2e/startup-cards.spec.ts`，验证延迟资源期间开屏保持、资源就绪后直接显示四卡片、卡片间距/圆角/窄屏、步骤默认折叠；另覆盖资源一直阻塞时的文字降级与可用导航。
- lint、根TypeScript检查、移动端TypeScript检查、Web导出通过。
- 全套桌面/移动回归首轮69项通过，1项新测试因同时匹配到隐藏的历史DOM而失败；定位收窄到当前答案article后，4项启动/卡片测试全部通过（29.6秒）。所有70项用例均已取得通过结果，无跳过或放宽断言。日志`/tmp/solveflow-v19-e2e.log`、`/tmp/solveflow-v19-startup-final.log`。
- 已查看320px手机宽度的四卡片截图，卡片边界、公式、展开入口和底栏显示正常。
- `JAVA_HOME=/home/yhr/.sdkman/candidates/java/current pnpm mobile:apk`通过（2分2秒）；`node scripts/test-android-document.mjs`通过，包含真实APK四卡片、原图/追问桥接、公式、图示、展开后高度与240px窄屏。
- APK为0.1.9/versionCode10，43,235,464字节，与旧版签名一致，私密配置扫描通过；SHA-256 `1f5d42efafff918e5d83c3a43660d0668eec87062538a759ca0b6f1a17f5c87e`。
- 产物`.runtime/artifacts/solveflow-arm64-local-0.1.9.apk`；原云盘文件已更新并回读名称/大小：[下载APK](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。
- 用户解锁后覆盖安装成功，手机读回0.1.9/versionCode10。iQOO Neo9/Android16连续3次冷启动、四段阅读内容、默认折叠、展开/收起与原图打开/关闭全部通过。启动录屏逐帧检查显示开屏淡出直接进入完整卡片，未出现加载中的中间页；真机卡片截图已查看。原题和配置保留，没有模型调用。记录`.runtime/device-reading-cards/result.json`、`/tmp/solveflow-v19-device.log`，诊断截图/录屏只留本机忽略目录。

本轮未修改Agent、供应商配置或题目存储协议；未重复Agent/数据库测试，未新增付费模型调用，iOS原生构建仍暂停。
