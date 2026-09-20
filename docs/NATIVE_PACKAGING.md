# Android / iOS 安装包构建

> 最新：用户已授权设备直连模型与本地存储，见[本地应用验收](LOCAL_APP_ACCEPTANCE.md)。当前安卓命令 `pnpm mobile:apk` 生成 `solveflow-arm64-local.apk`，启动后在设置页填写模型；不再需要 EXPO_PUBLIC_API_URL 或 SolveFlow 后端域名。下文较早的 API 缺失/编译检查包记录属于迁移前状态。iOS原生构建已暂停。

`pnpm build` 是三端代码和资源导出。真正的安装包还需要原生编译、签名和可用的服务地址。生成APK/IPA与真机解题验收分别记录。

## 当前本地应用 APK

2026-09-18：**0.1.26（versionCode 27）** 已构建，43,789,805字节。按最新要求移除选择题文本正则兼容，直接使用模型的options/selectedOptions/解释字段；校验标签归属，多题与追问保存对应标签。645项全量离线及后续34项相关测试、10项桌面/移动场景、3道SAT/ACT真实HTTP题、实际APK结构化选项与图文安全检查通过。已覆盖安装到iQOO Neo9并读回版本，详见[选择题验收](SAT_CHOICE_ACCEPTANCE.md)。

2026-09-18：**0.1.25（versionCode 26）** 已构建并覆盖安装，43,792,461字节。选择题选项逐行排版，答案标签提前、依据在下，SAT提示与诊断改进。签名/私密配置扫描、三端导出、离线与浏览器相关回归及两道自编SAT真实模型测试通过。已检查已有题目排版；其正则转换随后按用户要求在0.1.26删除，详见[选择题与耗时验收](SAT_CHOICE_ACCEPTANCE.md)。

2026-09-17：**0.1.24（versionCode 25）** 已构建，43,780,777字节，修复Android原生初始数据晚于DOM入口脚本到达造成的图文启动失败，同时修正隐藏题页超时与字体等待。7项针对性单元、10项桌面/移动相关场景（首轮6项加更新后的启动4项）、类型/lint、实际APK晚到桥接与安全/图文检查通过。已覆盖安装到iQOO Neo9，原失败切题顺序、三题展示、冷启动恢复及关闭临时调试均通过；根因与验收见[多题展示故障](MULTI_QUESTION_DISPLAY_FIX.md)。

2026-09-17：**0.1.22（versionCode 23）** 已构建并覆盖安装到iQOO Neo9，43,779,193字节，增加SAT/ACT/AP专项方法，并包含简洁答案、按需步骤、手动校验和图文稳定性修复。634项离线测试、8道考试真实样例和校验正反例、三端导出、签名/私密配置扫描及实际APK资源检查通过。真机原题重答、按需步骤缓存、手动校验及冷启动恢复通过；见[考试验收](EXAM_SKILLS_ACCEPTANCE.md)及[按需答案验收](ON_DEMAND_ANSWER_ACCEPTANCE.md)。

2026-09-17：**0.1.20（versionCode 21）** 已构建并覆盖安装到iQOO Neo9，43,748,157字节。新增单题分页、固定题号轴和左右切题，调整轴的样式/对齐及知识点折叠行，优化图表刻度、标签分层和手机阅读比例。626项单元/合约测试、88项浏览器全套及最终8项相关回归、三端导出、实际APK资源验证通过。真机选题、图表手势、折叠与亮暗切换已检查；五科真实模型验收通过同一核心的Node脚本完成，本版未重新进行手机息屏解题。产物哈希、首次数学失败与修复及完整边界见[多题分页与绘图验收](QUESTION_PAGER_FIGURE_ACCEPTANCE.md)。

2026-09-17：**0.1.18（versionCode 19）** 已构建并覆盖安装，43.74MB，继承后台解题、主题、公式、大图与Skill改进，修复历史摘要失败后只显示编号、后台生成答案被误判为展示超时的问题，并补齐RN Headless JS生命周期。历史/主题/导航18项浏览器回归、6项历史/图片单元及2项后台展示计时测试、移动端typecheck、lint和实际APK图文资源检查通过。已实测息屏约32秒完成并校验PASS，重启后结果仍在；真机检查与息屏结果见[历史预览恢复](HISTORY_PREVIEW_RECOVERY.md)和[后台验收](BACKGROUND_SOLVE_ACCEPTANCE.md)。

2026-09-16最新构建为 **0.1.13（versionCode 14）**，43.69MB，已覆盖安装到iQOO Neo9。重新解答移到题目旁，全局按钮统一，题干更正支持TeX源码与实时预览；横屏裁切操作栏同步适配。见[按钮与公式编辑验收](BUTTONS_TEX_ACCEPTANCE.md)。

此前 **0.1.12（versionCode 13）**，43.24MB，已覆盖安装到iQOO Neo9。新增解题等待卡片、扫描/呼吸动效及真实阶段指示，支持系统减少动态效果。相关24项浏览器用例经首轮与修复复测全部取得通过结果，见[等待动效验收](SOLVE_PROGRESS_ACCEPTANCE.md)。

此前 **0.1.11（versionCode 12）**，43.24MB，已覆盖安装到iQOO Neo9。在0.1.10基础上移除个人页顶部“我的”和卡片内“我的题目”，保留题目数量与功能入口。详见[本轮验收补充](REGENERATE_ACCEPTANCE.md#0111-个人页标题精简)。

此前 **0.1.10（versionCode 11）**，43.24MB，已覆盖安装到iQOO Neo9。新增每题“重新解答”并保留旧版本，精简个人页说明文字；599项单元/编排测试与相关浏览器回归通过，真机入口及原题保留检查通过。见[本轮验收](REGENERATE_ACCEPTANCE.md)。

此前 **0.1.9（versionCode 10）**，43.24MB，已覆盖安装到iQOO Neo9。题目/答案/步骤/知识点改为独立卡片，修复开屏过早退场；70项桌面/移动用例经首轮及针对性重测均取得通过结果，APK资源检查、3次真机冷启动与卡片交互通过。见[本轮验收](READING_CARDS_STARTUP_ACCEPTANCE.md)。

此前 **0.1.8（versionCode 9）**，43.23MB。底栏改为分层图标过渡与镜头收合反馈，高亮沿图标轮廓呈现。构建、12项导航回归、包内DOM和签名/私密配置检查通过；云盘已更新，已覆盖安装到iQOO Neo9；版本读回、连续切换、原有题目与历史保留、相机打开返回和图标过渡帧检查通过。见[本轮验收](NAVIGATION_MOTION_ACCEPTANCE.md)。

此前 **0.1.7（versionCode 8）**，43.23MB，已覆盖安装到用户手机。详细步骤默认折叠，原图入口移至题目旁，删除当前页的删除按钮及收藏页返回按钮；空页面插画与底栏点击动画同步更新。见[本轮验收](COMPACT_READING_ACCEPTANCE.md)。0.1.6历史公式与收藏功能记录见[历史与收藏验收](HISTORY_FAVORITES_ACCEPTANCE.md)；以下0.1.3与0.1.2为历史记录。

此前版本**0.1.3（versionCode 4）**，已在用户iQOO Neo9/Android 16上覆盖安装并通过三次冷启动、题干/公式/步骤/最终答案、知识点展开和原生追问输入桥接验收。修复0.1.2仍有的安卓DOM初始化时序问题，详见[真机验收](ANDROID_ANSWER_FIX.md#013-真机修复与验收)。原Google云盘文件同步更新，以下0.1.2为前一轮历史。

`pnpm mobile:apk` 不需要API环境变量。当时产物 `.runtime/artifacts/solveflow-arm64-local.apk` 为0.1.2（versionCode 3），约40.8MB，内部测试签名与0.1.1一致，可覆盖安装。用户确认0.1.1能完成解题，本版修复只显示校验标记、图文正文空白的问题，详见[答案展示修复](ANDROID_ANSWER_FIX.md)。包内实际DOM资源测试已通过，0.1.2仍需真机复测。首次打开需配置模型；旧的 `compile-check.apk` 不能用于新的本地配置流程。此前安卓立即失败与拖动裁切修复见[0.1.1验收](ANDROID_SOLVE_FIX.md)。


## 构建前配置

仅在 `apps/mobile/.env` 或构建环境设置 `EXPO_PUBLIC_API_URL=https://你的API域名`。这里只填公开HTTPS源站，不带 `/api/v1`、登录参数或密钥；不要复制根目录服务端`.env`。Web继续同源访问，不受影响。构建检查会拒绝缺失配置、localhost和模板占位域名。

```sh
pnpm mobile:doctor
```

它检查地址、JDK、锁定RN所需Android SDK和本地Xcode。非零退出表示仍缺前置项；地址格式通过不保证域名已部署或手机可达。

## Android 本地内部测试 APK

当前Linux已安装JDK17与项目专用Android工具链：SDK36、Build Tools36.0.0、NDK27.1.12297006、CMake3.22.1、platform-tools。SDK/Gradle缓存只放 `.runtime`，没有更改全局SDK路径。其他电脑可设置自己的 `ANDROID_HOME`；需要的SDK版本从已安装RN版本目录读取。

```sh
pnpm mobile:apk
```

该命令验证服务地址、构建共享包与公式字体、生成原生工程，然后执行Gradle `assembleRelease`。当前产物为ARM64内部测试APK，使用Expo模板的测试签名；JS/Hermes和本地DOM资源随包嵌入，不依赖Metro。成功后写到 `.runtime/artifacts/solveflow-arm64-preview.apk`，同时生成SHA256文件。这个签名不用于Google Play正式发布。

仅验证编译、没有API时可显式运行：

```sh
pnpm mobile:apk --compile-only
```

产物名为 `solveflow-arm64-compile-check.apk`，未配置服务、只显示配置提示，不能称为可解题安装包。该模式不会修改 `.env` 或代填域名。打包使用2个Gradle worker，每条子命令最多30分钟，并传播中断信号。

本机Android命令行工具22.0来自Google官方页面的 `commandlinetools-linux-15859902_latest.zip`，SHA256：`4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583`。实际编译记录见下节；SDK下载、license接受与Gradle构建日志保存在忽略目录 `.runtime/android-downloads/`。

## iOS 与正式分发

本地iOS原生编译必须在macOS/Xcode运行，Linux不能直接生成iOS原生二进制。也可以从Linux提交EAS Build，由Expo的macOS环境编译；这是远程服务，会上传项目源码并可能消耗云构建额度。本轮仅提供配置，不自动提交云构建、注册账号或上传商店。

`apps/mobile/eas.json` 提供：

| Profile | Android | iOS |
| --- | --- | --- |
| preview | 可安装APK，内部签名 | 真机内部测试，需要Apple签名及已登记设备 |
| ios-simulator | 不使用此profile构建Android | 模拟器.app归档，无需真机分发签名，不能装到iPhone |
| production | Google Play AAB | App Store签名IPA，需Apple开发者团队配置 |

在 `apps/mobile` 目录使用固定EAS CLI24.4.2（MIT，发布包未压缩约5.76MB，Node要求已满足）。此CLI通过显式命令运行，没有加入App运行时依赖。

```sh
cd apps/mobile
pnpm dlx eas-cli@24.4.2 login
pnpm dlx eas-cli@24.4.2 init
# 在EAS项目的preview/production环境中设置公开EXPO_PUBLIC_API_URL
pnpm dlx eas-cli@24.4.2 build --platform ios --profile preview
# 或模拟器归档 / Android云构建
pnpm dlx eas-cli@24.4.2 build --platform ios --profile ios-simulator
pnpm dlx eas-cli@24.4.2 build --platform android --profile preview
```

登录和签名凭据通过官方CLI/系统钥匙串配置，不在聊天中发送。`eas init`绑定实际Expo项目后，将生成的公开projectId按项目要求写入配置；仓库不伪造projectId或teamId。构建后还需核对安装包、安装设备和真机功能。生产profile不会自动提交商店。

`eas-build-post-install`准备共享contracts/client及本地KaTeX资源；`.easignore`排除环境文件、运行数据、依赖缓存、生成原生目录和签名材料，远端通过CNG重建工程。实际云构建前应使用EAS CLI的归档检查确认上传文件；本轮未上传或验证云端构建。

## 本轮实际状态

2026-09-15：Android工具链已安装并通过文件检查，宿主JDK可运行；缺少 `EXPO_PUBLIC_API_URL`，doctor按预期非零退出。iOS无本地Xcode，Expo项目及Apple签名尚未绑定。新增2项构建配置回归、根/移动端类型检查及lint通过。

用户确认目前没有域名，也没有Mac或Expo构建环境。本轮不提交云构建，产物仅为Android编译验证包；iOS仍无IPA。

Android实际编译已完成：首次直接Gradle `assembleRelease` 成功（6分25秒）；新增 `pnpm mobile:apk --compile-only` 连续两次通过，最后一版在移除默认悬浮窗权限后成功（1分41秒）。最终产物：

- 路径：`.runtime/artifacts/solveflow-arm64-compile-check.apk`
- 大小：37,823,429字节（约37.8MB）
- SHA256：`b51937f4bbae840dd9cfac93fa90a088a855018990964657d8c0f9fc782bf385`
- 验证：APK v2签名通过；DEX、ARM64原生库、Hermes、本地DOM答案页和内嵌KaTeX字体存在；保留CAMERA，移除悬浮窗/录音/广泛媒体库权限；解压逐项扫描未发现本机服务端凭据或环境文件。
- 未验证：安装/启动/相机/WebView桥接/解题的真机运行。未配置API，启动显示服务配置提示，不能解题。

`pnpm mobile:apk` 在没有API配置时按预期非零退出，未产生被误标为可用的preview包。冻结离线安装通过，新增2项单元测试、根/移动端类型检查及lint通过；未重复跑既有解题模型或浏览器全套回归。实际产物报告在 `.runtime/artifacts/android-build-report.json`，最终构建日志 `/tmp/solveflow-native-apk-final.log`。

没有域名不妨碍后续做局域网联调，但需要单独配置手机可达的服务和内部调试包；本轮未开放局域网/公网端口或建立隧道。既有RN Web/API健康检查仍为HTTP200、live且可提交解题；本轮未调用付费模型。

## 官方依据

- [Android工具下载与校验值](https://developer.android.com/studio)
- [SDK Manager](https://developer.android.com/tools/sdkmanager)
- [Expo本地编译](https://docs.expo.dev/more/expo-cli/)
- [EAS APK](https://docs.expo.dev/build-reference/apk/)
- [EAS monorepo配置](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [EAS生命周期hook](https://docs.expo.dev/build-reference/npm-hooks/)
- [EAS上传排除](https://docs.expo.dev/build-reference/easignore/)
