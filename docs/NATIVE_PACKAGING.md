# Android / iOS 安装包构建

> 2026-10-03 生产存储修复：已构建 **0.1.70 / versionCode 71**，ARM64 内部测试包 17,253,714 字节。增加失败结果保存重试、损坏记录维护和单题恢复、128 MiB 分卷备份。833 项离线测试及 32 项浏览器用例通过，Web 事务补丁后 14 项存储用例复测通过；同签名、私密值扫描、播放器排除及实际 APK 离线页面检查通过。产物 `.runtime/artifacts/solveflow-arm64-local-0.1.70.apk`，未安装手机。详见 [生产修复与限制](RELIABILITY_REVIEW_2026_10_03.md)。

> 2026-10-03 真机补测：**0.1.69 / versionCode 70** 已同签名覆盖安装至 iQOO Neo9（Android 16）。修复原生切题合成时的瞬时空白，最终包 72 次正反向切题、1233 个解码帧未检出目标空白；同组 P95 帧耗时由 46ms 降至 21ms（单轮观测）。ARM64 APK 17,216,214 字节，SHA-256 `61eb3f4416569ec65a21c84d1e1b4604c4872dbde848b002596f6393adde7c84`，产物 `.runtime/artifacts/solveflow-arm64-local-0.1.69.apk`。见 [真机验收及限制](DEVICE_ACCEPTANCE_0_1_69.md)。

> 2026-10-03：已构建 **0.1.68 / versionCode 69**，ARM64 APK 17,212,718 字节。减少追问输入时答案与题图的重复编码/桥接，保持后台刷新时题号数组稳定，并修复网页切题遇时钟回拨时停滞的问题。44 项功能场景、18 项切题压力回归验证完成，签名、私密值与播放器排除检查通过；未安装手机。见 [性能检查记录](PERFORMANCE_2026_10_03.md)。

> 2026-10-03：已构建 **0.1.67 / versionCode 68**，ARM64 APK 17,211,050 字节，统一紧凑按钮尺寸、原生与图文主题颜色、辅助页面宽度以及可滚动的居中弹窗。52 项相关浏览器场景验证完成（含一次浏览器夹具截图异常后的单项复测），签名、私密值与播放器排除检查通过；本轮未安装手机。见 [UI 一致化验收记录](UI_CONSISTENCY_2026_10_03.md)。

> 2026-10-03：已构建 **0.1.66 / versionCode 67**，ARM64 APK 17,212,226 字节，包含短横屏与深色样式修复、弹层减少动态效果支持、搜索收起过渡、大批次题号渲染优化与百题计数修复。同签名、私密值、播放器排除及实际包内图文资源检查通过；本轮未安装手机。产物、交互测试与性能观测见 [0.1.66 验收记录](MOTION_APK_0_1_66.md)。

> 2026-10-02：已构建0.1.64 / versionCode 65，加入ESAT、TMUA、TARA增强；签名与资源检查通过。用户当前不便手机测试，本轮未连接或安装到手机。官方依据、命令和产物哈希见[增强记录](UAT_UK_EXAMS.md)。

> 2026-09-30：0.1.62 / versionCode 63 已覆盖安装，17,147,954 字节。修复切题时旧页提前移走、新页正文出现前的白帧；目标完成首次排版后再滑入，快速连点不重置正在执行的动画。真机同组题逐帧复查、764 项离线测试及 52 项相关浏览器回归通过，见[切题白帧修复](PAGER_FLASH_0_1_62.md)。

> 2026-09-30：0.1.61 / versionCode 62 已覆盖安装，17,144,686 字节。题图长按系统分享通过真机检查；50 题批次连续切到第 25 题后为 3 个 WebView，快速冷切题仍有掉帧。764 项离线测试、14 项核心交互回归通过，见[修复与实测](IMAGE_SHARE_PAGER_0_1_61.md)。

> 2026-09-29：0.1.51 / versionCode 52 已覆盖安装，17,108,542 字节。题号每页四个且均分铺满、单题空历史简化，22 项界面回归与真机 9 项布局/历史断言通过，保留106张题图；见 [0.1.51 布局验收](PAGER_LAYOUT_0_1_51.md)。

> 2026-09-29：0.1.50 / versionCode 51 已覆盖安装，17,109,470 字节。点击题图全屏查看、原生双指缩放/拖动、双击还原及关闭/系统返回通过，保留 106 张题图；见 [图片查看验收](IMAGE_VIEWER_0_1_50.md)。

> 2026-09-29：0.1.49 / versionCode 50 已覆盖安装到 iQOO Neo9，保留 106 条记录和模型设置。17,109,006 字节，基础页面、历史搜索/阅读/返回、相机模式切换与预览恢复检查完成；真实拍题解答由用户手动测试。见 [0.1.49 真机记录](DEVICE_ACCEPTANCE_0_1_49.md)。

> 最新：用户已授权设备直连模型与本地存储，见[本地应用验收](LOCAL_APP_ACCEPTANCE.md)。当前安卓命令 `pnpm mobile:apk` 生成 `solveflow-arm64-local.apk`，启动后在设置页填写模型；不再需要 EXPO_PUBLIC_API_URL 或 SolveFlow 后端域名。下文较早的 API 缺失/编译检查包记录属于迁移前状态。iOS原生构建已暂停。

`pnpm build` 是三端代码和资源导出。真正的安装包还需要原生编译和签名；模型服务在设备设置页配置。生成APK与真机解题验收分别记录。

## 2026-09-21 默认考试与 Responses（0.1.38）

0.1.38（versionCode 39）已构建，ARM64 APK 为 **20,448,832 字节（20.45 MB）**，SHA256 `e5fc9a16aaaefdafd2d9a939ef19cd46f313429da929cec7126359636ec40eb9`。版本化产物 `.runtime/artifacts/solveflow-arm64-local-0.1.38.apk`，通用路径与相应 R8 mapping 同步归档。较 0.1.37 增加 28,172 字节；签名与既有包一致，Hermes、3 份本地 DOM 和私密配置扫描通过。本轮未安装手机。

首轮构建等待失效的 Kotlin 守护进程回环连接；线程诊断后停止本次 Gradle 进程。环境变量重试未对编译任务生效，再次停止后在生成的 `apps/mobile/android/gradle.properties` 临时设置 `kotlin.compiler.execution.strategy=in-process`，运行 `SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` 成功。该临时配置已移除，没有升级依赖或更改产品代码。构建策略依据 [Kotlin 官方说明](https://kotlinlang.org/docs/compiler-execution-strategy.html)；如同机再次发生该连接问题，可用这一显式项目属性诊断。

考试设置、协议回归与 48 次真实对比见[本轮验收](EXAM_PRELOAD_ACCEPTANCE.md)。

## Android 体积优化（0.1.31）

`apps/mobile/plugins/with-android-release-size.cjs` 在每次 Expo prebuild 中启用 R8、资源裁剪和锁定 AGP 8.12 的联合资源分析，使用 `proguard-android-optimize.txt`。不增加依赖，不修改解题协议或工具权限。

`pnpm mobile:apk` 继续只构建 ARM64，并通过 `-Pexpo.useLegacyPackaging=true` 压缩原生库，适用于直接分发 APK；安装时会展开这些库，下载体积下降不等于安装占用同比下降。EAS/AAB 保留 Expo 默认原生库打包方式。Hermes 主 bundle 不额外压缩，保留直接映射加载方式；相机、SQLite、SecureStore、WebView、公式字体和 Skill 继续随包保留。

R8 的 `mapping.txt` 在本地构建成功后按版本和 APK SHA256 前12位归档到 `.runtime/artifacts/`，用于该版本原生崩溃栈还原。不要把别的构建映射用于当前包。

同时修复增量构建的旧 DOM 脚本残留：生成解题资源后清理该 Gradle bundle 任务的完整 assets 输出目录，包括前次中断后遗留的目录；不能只删除 `index.android.bundle`。实际 APK 回归新增“包内 entry 脚本必须全部被当前 HTML 引用”的断言，已在含两份旧脚本的中间包上复现失败。

依据：[Android R8 配置](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)、[Expo 构建属性及压缩取舍](https://docs.expo.dev/versions/latest/sdk/build-properties/)。参数同时核对了当前锁定 Expo/RN 生成的 Gradle 模板。

### 2026-09-20 实际验证

最终 **0.1.31（versionCode 32）** 为 **20,382,136 字节（20.38 MB）**，相较已有 0.1.30 的 43,804,381 字节减少 **23,422,245 字节 / 53.47%**。以下为 ZIP 内实际压缩后大小，MB 按十进制；分类合计不含 ZIP 目录、对齐和签名开销。

| 内容 | 0.1.30 | 0.1.31 |
| --- | ---: | ---: |
| ARM64 原生库 | 22.44 MB | 8.42 MB |
| DEX | 11.28 MB（4份） | 3.09 MB（1份） |
| Android 资源及元数据 | 4.16 MB | 3.16 MB |
| JS、DOM、字体等 assets | 5.61 MB | 5.61 MB |

19 个原生库全部保留并压缩，解压后仍为 22,444,304 字节；Hermes 主 bundle 保持未压缩。连续两次完成修复后的增量打包，APK 字节数一致；新增旧脚本断言由中间包失败转为最终包通过。

- 最终 APK：`.runtime/artifacts/solveflow-arm64-local-0.1.31.apk`；SHA256：`46f98597b850c14cb76c192cb618dbaf9e638a6b19d998ced4670e4d65484626`。
- `pnpm lint`、`pnpm typecheck`、`pnpm exec vitest run tests/unit/native-build-config.test.ts tests/unit/dom-bootstrap.test.ts`（5项）通过。
- 实际编译：`GRADLE_OPTS=-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process pnpm mobile:apk` 通过。首次普通构建卡在旧 Kotlin daemon 的 socket 连接，终止本轮构建后使用临时进程内编译重试；未更改全局 Kotlin 配置。最终日志：`/tmp/solveflow-apk-size-build-repeat.log`。
- 构建自动检查签名有效且与旧包一致、版本正确、5个本地私密值未泄漏、Hermes/SQLite/3份 DOM 文档齐全；R8 映射已按版本和包哈希归档。明细：`.runtime/artifacts/android-local-build-report.json`、`android-size-comparison.json`。
- `node scripts/test-android-document.mjs` 对最终 APK 的实际资源检查通过：无旧 entry 脚本、启动桥接、公式、原图/图表、知识点、历史操作、窄屏、离线资源与注入防护。
- 未验证：真机安装/启动/相机/后台解题（本轮 ADB 查询无响应，已结束该查询）、真实模型调用、服务端集成和浏览器全套 E2E。本次没有修改模型或提示词。包内 Chromium 检查不代表 Android 原生运行已验收。

## 当前本地应用 APK

2026-09-20分页修复构建：**0.1.36（versionCode37）**，20,415,304字节，SHA256：`dda39ad425d8b76e9615fd2ca71a30fd94d4b9f9b3a797fb68e6025da65183a7`。在0.1.35基础上修复分页后停留列表底部；新增浏览器断言先复现失败，再通过10项相关交互复测，mobile typecheck/lint及最终APK资源检查通过。首次安装被系统取消；用户确认重试后，非流式覆盖安装返回Success，读回versionName0.1.36 / versionCode37。99条历史保留，第二页全部20个会话ID匹配原导出，翻页回到顶部、切页保留页码通过真机检查。详见[历史管理验收](LOCAL_HISTORY_MANAGEMENT.md)。

2026-09-20历史与原图更新：**0.1.37（versionCode38）**，20,420,660字节，SHA256：`29a234dd512ec1cd41226b3d1ac5f08591c6052d00c9537797e33f3e930213b6`。新增历史连续序号、当地秒级保存时间、完整原图1～4倍双指缩放和拖动。普通同签名覆盖安装Success，手机读回0.1.37/code38，99条历史保留；实际APK资源验证、686项离线测试、10项浏览器检查、真机时间核对和双指边界/复位通过，详见[本次验收](HISTORY_IMAGE_VIEWER_ACCEPTANCE.md)。

2026-09-20：**0.1.35（versionCode36）** 普通本地APK已构建并覆盖安装成功，**20,415,708字节（20.42 MB）**，较0.1.30的43,804,381字节缩小**53.39%**。SHA256：`47739b43fa229b52878cdf3c274ad33c526c0f13d69a7819e16a04716355ad9f`。包含本地完整导出、历史清空/手势/摘要性能优化；签名与旧版本一致，5项私密配置扫描和实际APK资源测试通过。680项离线测试、lint/typecheck、10项相关浏览器测试通过；真机验证见[历史管理](LOCAL_HISTORY_MANAGEMENT.md)，导出99条完整性验证见[本地导出](LOCAL_HISTORY_EXPORT.md)。没有改动模型/提示词或进行付费重答，不将本版本声称为1550分能力验证。

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

当前本地应用不需要 `EXPO_PUBLIC_API_URL`。不要复制根目录服务端 `.env` 到客户端；模型地址与密钥由用户在设备设置页填写。

```sh
pnpm mobile:doctor
```

它检查 JDK、锁定 RN 所需 Android SDK 和本地 Xcode。非零退出表示仍缺编译工具；iOS 原生构建当前暂停。

## Android 本地内部测试 APK

当前Linux已安装JDK17与项目专用Android工具链：SDK36、Build Tools36.0.0、NDK27.1.12297006、CMake3.22.1、platform-tools。SDK/Gradle缓存只放 `.runtime`，没有更改全局SDK路径。其他电脑可设置自己的 `ANDROID_HOME`；需要的SDK版本从已安装RN版本目录读取。

```sh
pnpm mobile:apk
```

该命令检查工具链、构建共享包与公式字体、按需生成原生工程，然后执行 Gradle `assembleRelease`。当前产物为 ARM64 内部测试 APK，使用 Expo 模板的测试签名；JS/Hermes 和本地 DOM 资源随包嵌入，不依赖 Metro。成功后写到 `.runtime/artifacts/solveflow-arm64-local.apk`，同时生成 SHA256、版本归档、签名/私密配置/资源检查报告和 R8 映射文件。这个签名不用于 Google Play 正式发布。

旧参数仍兼容，但当前同样生成可在设置页配置模型的本地应用：

```sh
pnpm mobile:apk --compile-only
```

命令不修改 `.env` 或代填模型地址。Gradle worker 数根据 CPU 数限制在 2–8 个，每条子命令最多30分钟，并传播中断信号。下方 `compile-check.apk` / `preview.apk` 和服务地址要求仅为旧服务端路径的历史记录。

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
# 当前本地模型应用不需要 EXPO_PUBLIC_API_URL；iOS 构建仍暂停
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

2026-09-21：0.1.39（versionCode 40）加入批量解题，ARM64内部测试包20,492,068字节。原生后台任务与计时器改为按runId隔离；已完成编译及APK资源检查，手机升级/连续速拍/息屏待实机验收。详见[BATCH_SOLVING_ACCEPTANCE.md](BATCH_SOLVING_ACCEPTANCE.md)。

2026-09-21：0.1.40（versionCode 41）精简拍摄与历史布局，批量入口移至相机，新增可命名批次、扁平分类切换及按需搜索。ARM64内部测试包20,519,000字节，SHA-256 `02cbfb870211f9b59caf9d998d772b14a35a0dcb2c41fc5533273736b19a796a`；同证书覆盖安装兼容性与打包资源检查通过，详见[批量验收](BATCH_SOLVING_ACCEPTANCE.md)。


### 0.1.41 历史手势与返回修复（2026-09-21）

ARM64内部测试包`.runtime/artifacts/solveflow-arm64-local-0.1.41.apk`，versionCode42，20,522,068字节；SHA-256 `9e521491f1b13d921493fbef399b33c679bc0402d85bcd7f877c2d9a43b4991c`。签名与前版一致，私密配置扫描、Hermes及3份本地DOM资源验证通过；`test-android-document.mjs`检查通过。iQOO Neo9覆盖安装成功并读回0.1.41/42，记录保留。构建临时使用进程内Kotlin编译，完成后已移除该本地配置。真机手势与返回检查见[历史管理](LOCAL_HISTORY_MANAGEMENT.md)。


### 0.1.42 固定题目字体与公式对齐（2026-09-21）

ARM64测试包`.runtime/artifacts/solveflow-arm64-local-0.1.42.apk`，versionCode43，23,858,088字节；SHA-256 `fa2b5ad0b74ad1bb12dbe8e44a76f94b26006969b2ce1f5dab1a031526472cc7`。正文复用KaTeX配套字体，中文新增OFL授权Noto Serif SC资源，随包保存一份，不访问在线字体；相较0.1.41增加3,336,020字节。签名、私密配置扫描、3份DOM及101份字体哈希/许可检查通过，实际APK本地渲染中的中文自带字体和数字基线断言通过。手机首次安装被系统取消；用户重新确认后覆盖安装返回Success，读回0.1.42/43，同题字体与基线目视核验通过。详情见[字体验收](READING_TYPOGRAPHY_ACCEPTANCE.md)。


### 0.1.43 跟随系统字体（2026-09-21）

ARM64测试包`.runtime/artifacts/solveflow-arm64-local-0.1.43.apk`，versionCode44，20,522,084字节；SHA-256 `801a67ac3c0c3ce42a0f9283f12dde144cb0d65bdde678012125ce723ffc3aaf`。按最新要求正文跟随手机字体，移除上一版固定中文资源，减少3,336,004字节；保留KaTeX数学字形、1em字号和基线对齐。14项相关浏览器回归、lint/类型检查/三端导出、实际APK资源及签名/私密配置检查通过，详见[字体验收](READING_TYPOGRAPHY_ACCEPTANCE.md)。

0.1.43已覆盖安装到iQOO Neo9并读回44，原题中英文字体跟随设备个性字体，99条单题及批次3张题图保留。无付费解题请求。

### 0.1.44 代码审阅修复（2026-09-22）

ARM64 内部测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.44.apk`，versionCode 45，20,530,520 字节（约 20.53 MB）；SHA-256 `c8db8860c990671feb63865e41837fd50dea4d95e4bf177b699b6446c84ea15c`。修复取消与保存竞态、时钟回拨导致的解答错序、初始化重试、删除后的导航引用、历史搜索分页及离开批次后的迟到相册回传，详见[代码审阅记录](CODE_REVIEW_2026-09-22.md)。

`SOLVEFLOW_GRADLE_NO_DAEMON=1 pnpm mobile:apk` 成功。本次仅在生成的原生工程临时启用 Kotlin 进程内编译，结束后已移除该临时设置。签名验证通过，与最新归档 0.1.43 的证书相同；现在证书变化会直接阻止归档，归档版本按数字排序。私密配置扫描、Hermes/SQLite 原生库及 3 份本地 DOM 资源检查通过。

`node scripts/test-android-document.mjs .runtime/artifacts/solveflow-arm64-local-0.1.44.apk` 通过：直接解包验证离线页面启动、桥接、历史、图像、公式、窄屏和注入防护，正文与行内数学基线差为 0 px（Chromium 测量）。构建阶段未连接手机；随后同日已非流式覆盖安装到 iQOO Neo9，读回 0.1.44 / 45。历史、真实多指缩放、相册及桌面后台对照见[真机回归](DEVICE_REVIEW_0_1_44.md)。手机“智能控制后台耗电”会冻结活动进程；仅对 SolveFlow 允许后台耗电后，后台解题、独立校验及服务释放通过。实际连续拍摄、息屏和稳定三并发仍未覆盖。


### 0.1.45 批量相机布局修复及锁焦复测（2026-09-23）

ARM64 测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.45.apk`，versionCode 46，20,531,900 字节；SHA-256 `78dfd327afdc5cd5be3ecbd822fe09f9dab73a553804a3bfcd656f4659a6594f`。修复快门忙碌文案导致预览高度跳变，安卓批量模式一次对焦后保持、点击预览重新对焦；相机依赖保持 57.0.5，使用受版本控制的 pnpm 补丁补齐 Android 锁焦行为。签名、私密配置、打包资源及实际 APK 文档渲染检查通过，iQOO Neo9 覆盖安装成功。真机发现 Expo 预编译 AAR 没有包含锁焦补丁，0.1.45 的锁焦未通过；后续 0.1.46 指定源码编译。行为、回归与真机证据见[相机稳定性记录](CAMERA_STABILITY_0_1_46.md)。


### 0.1.46 相机锁焦补丁源码打包（2026-09-23）

ARM64 内部测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.46.apk`，versionCode 47，17,091,870 字节（17.09 MB）；SHA-256 `d09ca633aa1af27d78b76a53016530eab60c3c20e2c01061b30b11f63b90a14c`。明确从源码编译 `expo-camera`，补齐绑定后的中心锁焦及关闭扫码时的可选依赖规则；未升级相机库或启用扫码。构建日志确认相机 Kotlin 编译，同签名、私密配置和 APK 资源检查通过。比 0.1.45 减少 3.44 MB。

最初按用户要求仅打包；用户恢复测试后，同日已覆盖安装并读回 0.1.46 / 47。批量静置锁焦、点击重新对焦、单题/批量切换、重开相机及连续两次快门通过本机检查，两张题图均完成解题与独立校验；用户确认静置已稳定。焦距元数据仍有变化，不能据此宣称镜头绝对静止或覆盖所有设备。详情见[相机稳定性记录](CAMERA_STABILITY_0_1_46.md)。


### 0.1.47 批量拍摄与校验说明（2026-09-23）

ARM64 测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.47.apk`，versionCode 48，17,097,754 字节（17.10 MB）；SHA-256 `fb5e4a3858b6e2cdcbe3a3183efd032f4266dbd7228920bbf70a55ae07b13e8e`。批量照片直接传递原生像素，去掉中间 JPEG 往返和 JS 字节编码；完成拍摄进入本次批次；校验说明区分超时、无效输出和具体疑点。

86 项相关单元/合约测试、34 项浏览器回归、lint、根与 mobile 类型检查、服务包/Web/Android 构建通过；签名连续性、私密配置和包内资源检查通过。`test-android-document.mjs` 已直接检查实际 APK 中的离线文档与新校验说明。用户明确选择先打包，本轮没有安装手机或新增真实模型调用；实际拍摄速度、清晰度和原生连拍待手机验收，见 [0.1.47 记录](BATCH_CAPTURE_0_1_47.md)。

### 0.1.48 真机采集与历史读取优化（2026-09-23）

ARM64 测试包 `.runtime/artifacts/solveflow-arm64-local-0.1.48.apk`，versionCode49，17,103,222字节；SHA-256 `bc16e6a87ab397d02434d17932cd70dcb74c2c2cbe9c15e5a88d1c7772d67797`。批量采集选择实际支持且不低于2048×1536的4:3尺寸，历史摘要/收藏改为有界SQLite批量读取，保留旧适配器兼容与原图规范化。

93项相关单元/合约测试、16项相机/批次浏览器回归、lint、类型检查、构建和实际APK离线文档检查通过。已覆盖安装到iQOO Neo9并读回版本49；三次保存耗时1737/1628/1634ms，三张结果已在后台保存，其中一张校验通过、两张明确显示校验超时。结束后服务释放，原记录保留。观测条件与限制见 [0.1.48 真机记录](DEVICE_CAPTURE_0_1_48.md)。
