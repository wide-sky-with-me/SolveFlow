# Android与iOS原生构建及图片工作台验收

日期：2026-10-29—2026-10-30。

范围：当前未提交工作区，包含当日工作流隔离、补图草稿与缩略图修复；版本0.1.80，Android versionCode及iOS buildNumber均为81。本机Linux构建Android，远程Mac独立目录构建iOS；最终验收使用合成题图及应用图标，不调用真实模型。

结论：Android ARM64内部测试APK已生成，签名、包内DOM及资源检查通过。Mac端701份必需源码已核对一致；iOS模拟器和真机目标Release编译通过，两项XCTest及SQLite读回通过。Mac无Apple开发者签名身份，真机IPA未签名，不能直接安装；模拟器包采用本地ad hoc签名。

## 变更与处理

- 更新移动版本和构建号，Android沿原内部测试证书；不覆盖或清除用户手机数据。
- 扩充既有iOS XCTest：单张补图裁剪、已存材料编辑、多张补图的旋转及裁剪、横屏关闭和提交入口、取消不落盘、材料保存与重启恢复。SQLite终检同时核对历史材料、当前选择及零模型run，不能只以按钮返回判断成功。
- 设置中的服务地址改用URL键盘，iOS密钥使用ASCII键盘；测试逐字输入并核对完整值，最终密钥仍在键盘打开时提交，保留遮挡和保存检查。
- 模拟器构建保留本地签名；冒烟入口增加包签名预检，避免能启动却不能使用Keychain的未签名包进入交互验收。
- Mac使用独立源码目录和新模拟器；快照排除真实环境配置、密钥、题图、依赖及生成工程，实际构建前逐项核对必需源码哈希。保留现有Web部署和已有模拟器。

## 验证结果

证据位于忽略目录`.runtime/native-adaptation-2026-10-29/`；首次失败及后续结果分别保留，不累计重复样本。

| 检查 | 实际结果 |
| --- | --- |
| Android工具 | 受限环境首次Java子进程探测失败；正常构建权限下`pnpm mobile:doctor`确认JDK及SDK齐备，没有重新安装工具 |
| Android编译 | `SOLVEFLOW_KOTLIN_IN_PROCESS=1 SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk`退出0，含共享构建、Hermes、内部签名和私密资源排除检查 |
| Android产物 | 最终`SolveFlow-0.1.80-android-arm64.apk`，17598166字节，SHA-256为`e5e3f3545953149a8ed3308702bc102ff822a0a483c9572142ee61baab58068a`；同前包证书，见`android-build-report.json` |
| 包内页面 | `node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local.apk`退出0；离线DOM、公式、历史桥接、安全及窄布局检查通过，不代表真机合成器或交互 |
| 原生图片回归 | `pnpm exec vitest run --project unit --maxWorkers=2`定向platform-image、platform-batch-import、photo-thumbnail-cache、batch-photo-preparation四文件，25项通过、退出0 |
| iOS工程生成 | `pnpm exec vitest run --project offline --maxWorkers=2 tests/unit/ios-scene.test.ts`一项通过、退出0，不代表Xcode编译 |
| 类型与管理 | 最终`pnpm typecheck`退出0；`pnpm docs:test`首次受限环境失败，正常权限最终复测20项通过、退出0；脚本语法退出0。最终文档初检超出长度17单位，精简后`pnpm lint`退出0，没有提高长度门槛 |
| iOS原生工具 | Xcode27.0、iOS27.0模拟器、iPhone17；依赖安装、共享构建、prebuild及Pods分别退出0 |
| iOS模拟器 | `xcodebuild`的`iphonesimulator` Release目标退出0，本地签名核对通过；最终`ios-smoke-GmtnrF`的两项XCTest均通过，整体冒烟命令退出0 |
| iOS持久化 | SQLite读回record/image/summary/settings各1、模型runs为0；历史材料4、当前图片4、材料文档4，符合编辑留旧版本及取消不保存的预期；本轮模拟器已关闭并删除 |
| iOS真机目标 | `xcodebuild`的`iphoneos` Release目标退出0，版本0.1.80/build81及iPhoneOS平台核对通过；`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`，不作为签名或安装验收 |

两项XCTest为`testLandscapeModalOrientation`和`testOfflineDeviceFlow`，最终分别10.541秒及177.952秒；重复执行不累计为新用例。材料工作台属于单题多补图流程，本轮不代表完整批次分配、插题或真实答题已在原生验证。

| iOS产物 | 大小与SHA-256 |
| --- | --- |
| `SolveFlow-0.1.80-ios-unsigned.ipa` | 15547148字节；`7e9a21292b24c441c3cb0743c0183c7557cc8121b7a9b7710d82ad2e6052aa88` |
| `SolveFlow-0.1.80-ios-simulator.zip` | 25310966字节；`be1de5ab367b5f11626d689031b43d81f0f4d3e59e582ba6e36828014569b558` |

## 失败及复测

1. `ios-smoke-Kb8YAB`横屏用例通过，设置页因Keychain不可用失败。原因是本轮直接Xcode构建时关闭签名；改用本地ad hoc签名并增加入口预检，没有清除用户配置或绕过错误。
2. `ios-smoke-sgb8HC`已完成补图编辑、取消、保存和重启恢复，随后设置用例因键盘缩小视口、大幅滑动反复越过目标失败。逐字校验同时发现测试输入丢字；增加URL/ASCII键盘，并将测试非密钥字段逐字输入、核对后收起键盘。
3. `ios-smoke-VlSPCH`的小幅坐标拖动未能滚动到高级参数，仍失败。恢复原有滚动方法，保留逐字、键盘遮挡及键盘打开时保存断言；不增加重试阈值或放宽断言。最终第四轮完整通过。

前三轮曾将同一夹具重复导入相册，系统去重后第二次选择取到了全新模拟器自带示例照片。最终改用合成题图与应用图标两张独立图片；不把前几轮的部分成功声明为全套合成图片验收。失败日志、截图及各轮退出码保留。

SFTP、旧式SCP及rsync传输均出现超时或断连；目标部分文件存在不能视为同步成功。保留传输日志，改为SSH命令通道分块传输必需差异，单块、整包及最终源码均核对哈希。Mac临时防休眠有时限，最后一轮绑定验收进程退出，不影响用户Web服务。

最终人工查看原生横屏工作台、已存材料和设置截图；两份iOS产物与证据包已回传本机，大小与SHA-256均一致。最终源码701项与本机再核对，无差异；本轮防休眠进程已退出。文件和阶段结果归`ios-delivery.json`、`ios-downloads.json`及`ios-evidence/`。

## 未验证项与剩余风险

本机ADB未发现设备，没有安装到用户手机；未验证Android相机、分享、后台或真实设备帧表现。iOS模拟器验证不能替代真机签名、相机成像或后台能力。当前[批次PDF](../subsystems/batch-pdf.md)属于Web路径，原生尚未实现该入口；不因编译成功宣称完整移植。

无真实模型请求、提交、推送或远程Web部署。收尾检查发现本机3100旧进程已退出，原因未确认；复用原有网页产物和配置恢复，HTTP200、首页摘要及私密配置未变化，见`local-web-delivery-state.json`。Mac既有3131及3130入口均返回HTTP200，未重启；防休眠与模拟器均已清理。后续结论更新[发布状态](../project-status.md)，不改旧验收成绩。
