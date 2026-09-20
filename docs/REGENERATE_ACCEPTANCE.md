# 0.1.10 每题重新解答（2026-09-16）

## 使用与范围

每道题解答下方增加“重新解答”。点击后根据原图、该题范围、原始补充说明和已保存的更正/补充条件重新完整求解，再进行独立校验；不是仅解释上一条步骤。无需重拍或重新上传。未配置模型或存在进行中任务时不可提交，复用当前设备配置、既有取消/超时与轮次限制，不自动重放请求。

新结果追加到同一道题的对话中，标题标为“重新解答”。旧版本可通过“查看之前的解答”展开；重新生成失败或取消不会删除旧记录，失败后仍可“重新尝试”。未发送追问草稿保留。多题图片只重新解答所点击的一题，其他题目不变。

个人中心同步精简：移除题目卡片副文案、模型设置副说明和页底长段文字，只保留题目数量、历史、收藏、模型设置与使用说明入口。数据保留/模型请求说明统一放在“使用说明”内。

## 实现与兼容

- `RunContextSchema`增加`regenerate`类型（sourceRunId、可选number）；引用必须解析到本会话有效题目，歧义、不存在题号、循环及跨会话祖先继续失败关闭。
- 客户端`regenerationContext`使用最近有效解答定位原题；`resolveLearningContext`生成`focus.kind=regenerate`的整题范围提示，保留已有明确题干更正，并结合受限同题历史保留补充条件。旧答案不作为已经确定的事实。
- Solver/Verifier增加明确的重新解答模式：覆盖所选题的全部小问、完整答案、教学步骤与知识点，避免套用局部追问的精简规则；校验器重新检查完整性和原题依据。
- UI复用LocalEngine追加run，仍由Pi求解和强制Verifier校验；没有新增模型循环、工具、依赖或数据库表。
- 这是现有schemaVersion1上下文联合类型的增量扩展；新客户端可读取旧记录，无数据重写。写入regenerate记录后，旧客户端不认识该类型，因此不支持降级读取这些新记录；APK同签名升级保留原数据。

主要文件：`packages/contracts/src/run-context.ts`、`question-thread.ts`、`packages/client/src/question-conversations.ts`、`learning-history.ts`、`packages/agent/resources/SYSTEM.md`、`VERIFIER.md`、`apps/mobile/src/components/question-thread.tsx`、`profile.tsx`。

## 验证

- lint、完整typecheck、Web导出通过。
- `pnpm test`：599项通过（包含重新解答经过FAIL→修正→PASS时每阶段仍携带原图、条件和独立校验的回归）。首次受沙箱本机端口限制失败；允许本机测试端口后全套通过，无真实模型调用。
- 新增5项单元/编排测试覆盖题号范围、整题提示、最新更正、重做后继续同题对话、旧记录保留、失败/取消、无效引用不调用模型。
- 新增桌面/移动浏览器单题、多题重新解答回归：重复点击只发起一次Solver与Verifier；旧答案、未发送草稿、别题结果保持；重新打开与失败重试。
- 浏览器全套首轮74项中70项通过；新用例先修正RN只读输入的断言（不可编辑而非HTML disabled），再补齐模拟生成答案必需的knowledgeDetails，并直接用生产schema校验fixture。最终受影响范围34项均取得通过结果：个人页/导航/状态/更正30项通过，单题/多题重新解答4项重测通过（18.6秒）。未修改生产校验门槛、未跳过断言。日志`/tmp/solveflow-v110-e2e-final.log`、`/tmp/solveflow-v110-regenerate-final.log`。
- 最终`pnpm mobile:apk`构建通过（1分52秒）；`node scripts/test-android-document.mjs`实际APK本地DOM、公式、图示、桥接、离线与安全检查通过。
- 0.1.10/versionCode11，43,238,876字节，同签名与私密配置扫描通过，SHA-256 `a1c277bbd40b5b7ab11f715fe551ceead47db88f5e66e1c695c3c358a4f3eb80`。产物`.runtime/artifacts/solveflow-arm64-local-0.1.10.apk`。
- 已覆盖安装到iQOO Neo9/Android16，读回版本11/0.1.10。真机重新解答按钮可见可用、原有题目保留、个人页冗余文案移除、使用说明打开返回通过；已查看实际截图。没有在手机上提交真实模型请求，模型流程用模拟供应商验证。
- 原云盘文件已更新为`solveflow-0.1.10-arm64.apk`并回读名称/大小：[下载APK](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。

没有新增真实供应商调用；模型流程通过确定性fixture验证。保留旧服务路径的数据库集成未重跑，iOS原生构建暂停。

## 0.1.11 个人页标题精简

按用户要求，`apps/mobile/src/components/profile.tsx`删除顶部“我的”与数量卡片“我的题目”两个标题，同时收紧对应间距。底部“我的”导航、题目数量和全部功能入口保留。`apps/mobile/app.config.ts`版本更新为0.1.11/versionCode12。

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm lint`、`pnpm --filter @solveflow/mobile build:web`通过；390px浏览器截图确认新布局。
- `JAVA_HOME=/home/yhr/.sdkman/candidates/java/current pnpm mobile:apk`通过（1分44秒）。仅标题与间距变更，未重复运行上一版本的完整模型/E2E套件，无真实模型调用。
- APK 43,238,740字节，SHA-256 `b127981cacf79b207367e3f2c5e779e881f7f135ddfe1221dc71e01a61376239`；版本、同签名、必要资源及私密配置扫描通过。产物`.runtime/artifacts/solveflow-arm64-local-0.1.11.apk`。
- 已覆盖安装到iQOO Neo9；原云盘文件已更新为`solveflow-0.1.11-arm64.apk`并回读名称/大小。
- 真机版本读回12/0.1.11，两个顶部标题均已移除；收藏/设置/使用说明、原有题目与重新解答入口保留，使用说明打开返回通过。记录`.runtime/device-profile-clean/result.json`，未点击真实解题请求。
