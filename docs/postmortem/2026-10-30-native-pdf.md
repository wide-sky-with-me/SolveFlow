# 原生快速 PDF 移植与验收

日期：2026-10-30。状态：本轮离线、构建及模拟器验收完成；真机与发行未验。

范围：当前未提交工作区，Android/iOS版本0.1.81/build82。补上原生空导出入口，提供快速原文的单份PDF、多份不同错误数ZIP、答案表、高亮、书签、补图、备注及原生保存/分享。尚未移植网页其他版式，不把编译和离线检查当作真机安装或联网答题验收。

## 实现

- 沿共享投影、作答规划和PDF生成器，本地DOM页只接收题目快照；模型设置和密钥不进入渲染页，不调用模型。
- 工作区持有任务和渲染页，关窗继续；有界分块传输、取消释放、迟到结果拒收。
- 独立SQLite保存文件与任务，事务容量检查和原子删除，补存不重绘；系统目录/分享失败保留App内成品。
- 使用既有Expo DOM、SQLite、文件与分享能力，没有新增依赖。设置和题目数据不迁移，Web部署保持独立。

## 当前验证

证据归`.runtime/native-pdf-2026-10-30/`，各轮失败与复测分别保留。

| 检查 | 实际结果 |
| --- | --- |
| 首次分块回归 | 先运行失败，缺少原生传输实现；补实现后通过，不删除断言 |
| 本轮定向单元 | 最终8文件117项通过、退出0；含原生内容/传输/真实SQLite、快速内容、任务、错误分配及分享缓存 |
| 类型 | 根`pnpm typecheck`退出0，包含共享包、根及移动端；可选属性、夹具导入路径和目录大小可空检查已修正 |
| SQLite故障 | 实际SQLite BLOB重启读回、删除触发器回滚、写满后补存不重新生成、取消迟到字节及中断恢复通过；不是手机整机ENOSPC |
| Android | `pnpm mobile:apk`退出0，0.1.81/code82；`test-android-document.mjs`退出0，包内实际生成两份答案PDF的ZIP及纯题PDF，原图/补图、完整长文、书签7/7/6和链接6/6/0通过；未安装真机 |
| iOS PDF | 独立Mac源码717项核对，模拟器Release编译退出0；`ios-smoke-BuYfWc`的PDF XCTest通过、退出0，覆盖两份错题1/2的ZIP、纯题、横屏、重启和系统分享；SQLite两条完成记录/两个文件、原题六条预置run未增加及模拟器清理均通过 |
| iOS实际文件 | 两份答案PDF各7页、7书签、6链接；纯题6页、6书签、0答案链接。三份均保留两张不同来源图片与155段完整长文；纯题无答案canary。实际封面高亮、错题标记、题面及系统分享截图已人工核对 |
| iOS基础交互 | 同一包的`ios-smoke-x53D8B`两项XCTest退出0；补图工作台、相册/裁剪、设置/Keychain、横屏和SQLite读回通过，零新增模型run；独立模拟器已清理 |
| iOS真机目标 | `xcodebuild -sdk iphoneos -destination generic/platform=iOS`的Release编译、打包退出0；0.1.81/build82，未签名IPA不能当作可安装包 |
| 管理脚本 | `pnpm lint`及最终`pnpm docs:check`退出0；文档测试受限执行整体退出1，正常子进程权限下原命令20项通过、退出0，不调整断言 |

## 修复与失败记录

首次Mac编译命中克隆目录中的旧Metro绝对路径缓存；本轮独立`TMPDIR`后编译通过。第一次PDF交互的数字键盘阻挡第二份输入，改为48px单行字段、键盘避让及弹窗内滚动。原生提交还暴露React Native没有`AbortSignal.throwIfAborted()`，已使用兼容检查；先补回归，再保留Web原有取消原因对象，76项共享任务回归通过。

一次增量构建仅更新共享包源码、没有重编dist，造成取消修复未进入App；构建流程补上`pnpm build:shared`。后续已实际生成两条完成记录，测试曾因React Native嵌套文本重复计数、视图后代文本查询差异失败，改用状态明确的记录标识，仍独立断言两条记录及两个SQLite文件，不降低数量要求。

Android分享选择器返回时，接收方未必已读取文件；立即删除临时文件会使URI失效。现在先完整写入再交接，并保留有界24小时副本，补上延迟读取、复用、容量/过期清理及取消回归。

模拟器分享前提示缓存不完整；实际副本与SQLite成品均101,669字节且逐字节一致。根因是SDK的`File.move()`异步执行，代码未等待完成就检查目标；稍后取证时移动已完成，容易误判为长度接口故障。改用`info()`未解决时序问题，最终补上`await`，并让测试替身也异步移动：原实现3项失败且出现迟到拒绝，修复后7项通过。临时诊断已移除，字节检查未放宽。

目录保存也检查最终长度，模拟截断时删除不完整文件、不返回保存成功。另按锁定SDK源码兼容iOS的`ERR_FILE_PICKING_CANCELLED`，取消目录选择不再误报故障；相关缺陷保留先失败、后通过的回归输出。

## 命令与产物

定向测试：`pnpm exec vitest run`，文件为`native-pdf-input`、`native-pdf-transfer`、`export-task-store.native`、`direct-batch-content`、`native-pdf-error`、`save-export.native`、`local-export-tasks`、`batch-print-variants`各自测试，最终117项输出为`unit-async-final.log`。

Android构建设置`SOLVEFLOW_KOTLIN_IN_PROCESS=1 SOLVEFLOW_GRADLE_NO_DAEMON=1`，随后执行`node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local.apk`；最终构建、包内PDF检查分别见`android-build-async-final.log`、`android-document-async-final.log`，最终定向回归见`unit-async-final.log`。

APK为`.runtime/native-pdf-2026-10-30/SolveFlow-0.1.81-android-arm64.apk`，18,201,814字节，SHA256为`0ea1d9ad7f7b8cf48a054cdcbd3880b7e2b882d3eaa6a0d67e5dffcb2e00ef39`。内部测试证书与前包一致，凭据/外部播放器/探针扫描通过；不是商店签名。

iOS在独立源码目录执行`pnpm test:ios:smoke --app=<本轮模拟器.app> --pdf`及不带`--pdf`的基础用例，均退出0；原始命令、XCTest、SQLite及清理结果在`ios-evidence/`。同目录保存以下产物，下载大小和SHA256均校对通过：

| 产物 | 字节 | SHA256 |
| --- | --- | --- |
| `SolveFlow-0.1.81-ios-simulator.zip` | 37,490,109 | `ae8037a438a2b6a2b7e2b3bda809a9937e188e51b310da3ff907478b92c670dc` |
| `SolveFlow-0.1.81-ios-unsigned.ipa` | 16,124,172 | `eb190a9a977baef5915439b4f636930e6dcf405d5da134d6087fce9df2f439f7` |

模拟器包本地ad hoc签名，真机IPA未签名；二者平台及版本已分别核对，两个归档分别检查186/72个文件，六项私密配置值扫描通过。实际导出文件为同目录`ios-answers-1.pdf`、`ios-answers-2.pdf`、`ios-questions-1.pdf`，结构结果归`ios-pdf-verification.json`。

本轮新建模拟器均已删除，Mac临时防休眠已解除，3131返回200。收尾发现本机旧服务未监听，恢复同一3100资源后返回200，首页哈希与三份私有配置保持不变，未重建Web或发起模型请求。

## 边界

模拟器使用独立合成六题、不同原图/补图及长文；不请求真实模型。不安装用户手机、不写用户真实题库或浏览器存储。iOS真机签名仍依赖Mac可用Apple身份；相机、真实联网和低内存/大批次性能另验。

行为及保存语义归[原生PDF](../subsystems/native-pdf.md)，旧0.1.80的无原生PDF结论保留在[上一轮记录](2026-10-29-native-adaptation.md)。
