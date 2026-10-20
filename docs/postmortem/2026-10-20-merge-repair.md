# 预合并阻断修复与复验

日期：2026-10-20，Asia/Shanghai。

范围：用户在[首次预合并验收](2026-10-20-branch-premerge.md)后授权解决阻断并合并。继续保留 `pre-merge/main-2026-10-20` → `886e009`，修复从 `feat/batch-pdf-unified` 的 `b9044c2` 及现有工作区继续；不推送、不部署。初始门槛为审计全绿，后续用户明确确认仅本次本地合并接受下述两项high；不添加忽略项或修改审计/CI。

结论：浏览器原13项失败已消除；完整738案例中736通过、2项按既有宽屏条件跳过，退出0。其余完整离线、类型与三端导出通过。审计仍有两条尚无发布补丁的high、退出1；用户在确认卡明确选择“接受这两项 high，合并到 main”，允许本次本地合并，不代表审计通过或生产放行。

## 修复范围

本轮处理七组浏览器场景及八项依赖通告，原有成果全部保留。PDF 数量输入只在非法草稿时消费Esc并恢复有效值；有效输入或恢复后下一次Esc交给外层关闭弹窗。保留列表优先关闭、忙时关闭不取消后台任务、历史不变与零隐式模型调用。补充份数/逐份错题数及两种动效下的两阶段键盘回归。

其余六组修复过时夹具/选择器：补图明确当前选择与请求图片顺序；派生摘要迁移与原件不变分开验证；已准备的合成paper缓存仍核对四张当前图及替换像素；导航区分品牌与相机；逐题追问按用户动作及有界HTTP重试建模；图示缩放限定目标。未增加跳过、任意first或超时，不将静态定位当成修复通过。

依赖定向更新及两项阻断详见[安全决策](../../.agents/notes/implemented/security/2026-10-20-premerge-dependencies.md)。安装、离线冻结安装均退出0；实际审计从八项降为两项high，退出1。原样审计、完整路径和已发布候选父版本均核对，未忽略通告、伪造版本或整体升级SDK。

## 验证

固定 Node 24.19.0、pnpm 11.7.0，合成图片、隔离 IndexedDB 与假模型；独立静态服务 `http://127.0.0.1:53792` 不加载根.env或用户模型配置。临时日志和产物位于 `.runtime/merge-repair-2026-10-20/`，不随Git分发。首次失败成绩保留在前述报告。

旧Web导出上的Escape两项桌面回归先复现失败（退出1）：有效输入/非法值恢复后仍被字段截断；未用新源码冒充旧构建。新增五项实际消费方回归（共8项）通过，涵盖MCP Express信任边界、RN开发工具引用、PostCSS索引偏移、sharp实际像素及remark-math KaTeX原型信任。

首轮类型检查退出2：测试直接引入Web缓存模块，把移动CJS/JSX链带入根Node配置。恢复独立的版本化缓存夹具后，完整类型检查通过，未放宽规则。

| 本轮命令/范围 | 实际成绩 |
| --- | --- |
| `pnpm lint` | 源码边界、文档通过，退出0 |
| `pnpm docs:test` | 20项通过，退出0 |
| `pnpm typecheck` | 修正后退出0，含工作区构建及两处类型入口 |
| `pnpm test:web-container` | 13项通过，退出0 |
| 三份PDF/render生命周期Node专项 | 49项通过，退出0 |
| `pnpm exec vitest run --maxWorkers=2` | 167文件、1962项通过，退出0；包含8项实际消费方检查，不重复累加 |
| `CI=1 EXPO_NO_TELEMETRY=1 pnpm --filter @solveflow/mobile build` | Web、Android/iOS JS/Hermes导出通过，退出0；无原生二进制 |
| `node scripts/check-build.mjs` | 包内资源及普通Node加载通过，退出0 |
| 完整 `pnpm exec playwright test --reporter=line` | 736通过、2既有跳过、0失败，738案例，38.1分钟，退出0 |
| `pnpm deps:audit` | 两项high，退出1；用户明确接受仅本次本地合并例外，CI检查不放宽 |
| `node scripts/package-web-container.mjs .runtime/merge-repair-2026-10-20/release` | 本地发布目录生成成功，退出0；无凭据/数据库，未构建或部署容器 |

首次消费方补验有一项测试误读sharp未导出的package.json，改用已公开的 `sharp.versions.sharp` 后8项通过。定向浏览器执行到22/30时被宿主终止，无终态，不计入通过；后续完整单worker矩阵独立通过，不重复累计。两项跳过为[既有宽屏考试入口](../../tests/mobile-e2e/quick-exam.spec.ts#L7)，本轮未改跳过条件。

全量浏览器命令为 `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:53792 pnpm exec playwright test --reporter=line --output=.runtime/merge-repair-2026-10-20/full-results`；使用独立静态服务及Chrome154。本次服务PID77151，结束后确认进程退出、端口释放；辅助脚本使用exec启动以避免遗留shell子进程。未操作原3100服务或用户数据。

## Git 与未验范围

合并准备时HEAD为 `b9044c26945afe54db691f56096fc58220a66f68`，main及保留标签指向 `886e009ff08da57d6214dd5b2b3c5ad42bc01c46`。与首次源码副本逐文件比对，本轮14个已存在文件及2个新增文档变化；其中一个测试只清除末尾多余空行，语义不变。未覆盖其他原有成果。提交/本地合并后再核对refs、工作区及标签，不推送、不部署。

暂存检查识别历史CSV的CRLF及补丁上下文空白：保留CSV和补丁原字节，补丁SHA与锁文件一致。文本空白检查启用CRLF识别，仅排除已核对SHA的vendor补丁；未全局改变Git检查配置或改写历史数据。

末轮原样审计仍为两项high；node-forge 1.4.1、braces 3.0.4精确注册表查询各退出1。用户本轮明确接受的例外仅涵盖这两条；其他通告不豁免，完整锁文件审计与CI保持原样，未设置ignore或continue-on-error。风险待办继续公开，不把工具链通告说成零风险。

不包含真实付费模型、APK/Xcode编译、Android/iOS真机、其他浏览器、远端CI或生产部署；JS/Hermes导出不等于原生二进制验收，浏览器移动视口不等于手机。旧版式实图与性能成绩不作为本轮完成证据。
