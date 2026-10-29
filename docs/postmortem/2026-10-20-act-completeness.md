# ACT 功能完备性核查

日期：2026-10-20，Asia/Shanghai。基线：main `4f7f8d7`；本轮继续在该分支开发，不自动提交、推送或部署。

## 范围与结论

按当前设备端单题/批次辅助解题范围核查，不把题库、整卷批改、总分预测或正式模考计时视为已承诺功能。已有 ACT 五科方法、默认考试与题目/批次快照、原标签、同题材料、按需学习/核验及备份/PDF通路；不等于全科真实准确率验收完成。

确认一项通用缺陷：历史答案辅助请求混入后续更正，同时仍用旧图片与候选。已修复，并补专项覆盖。ACT 原有顶栏选择及 F/G/H/J 通用布局测试存在，缺的是 ACT 实际求解/核验/材料/正文的组合行为证据，不表述为“完全没有 ACT 测试”。

## 实现与证据

[考试契约](../../packages/contracts/src/exam.ts)包含ACT；[设备适配](../../packages/agent/src/pi/mobile.ts)完整预加载受审通则及ACT参考，其余学科按需。原有五科方法保留原标签/NO CHANGE、必要材料和完整成文。本轮按官方依据补充Reading双篇分别取证、观点归属与图文联读；这属于方法明确化，不声称已复现或消除模型跨篇误判。

[客户端](../../packages/client/src/local-engine.ts)保存题目与批次考试，旧记录缺字段用general；修改默认值不回写历史。导入/导出保留原记录、选项、答案及材料。[源版本决定](../../.agents/notes/implemented/agent/2026-10-20-auxiliary-answer-context.md)解释本轮问题及取舍：三类辅助请求绑定源作答时的历史与更正，普通追问/重做仍用当前条件。保存顺序不依赖墙钟，多题仍按原题号投影；不迁移或重写数据。

只读内存探针另验证ACT合成记录的批次重开、NDJSON roundtrip及打印投影；不代替JPEG实际解码、浏览器或真实模型验收。首次因自建JPEG夹具不完整退出1，改明确的合成结构后通过，非产品故障。

## 本轮验证

Node24.19.0、pnpm11.7.0；隔离合成图片、Map/IndexedDB与fake供应商，无真实调用。日志留 `.runtime/act-review-2026-10-20/`，不分发用户图或原始模型输出。

| 检查 | 实际结果 |
| --- | --- |
| 源版本回归，修复前 | 1文件，4失败/7通过，退出1 |
| 源版本/重做/完整上下文/引擎，修复后 | 4文件61项通过，退出0；新增多题投影后2文件17项通过，不累计样本 |
| `pnpm typecheck` | 工作区构建、根与移动类型入口通过，退出0 |
| `pnpm lint` | 初次笔记标题/反链及文档超长失败；按原门槛修正后退出0 |
| 资源源文件/embedded门禁 | 8项中1失败/7通过：源Reading更新、尚未生成；prepare后通过，未用同一快照互比 |
| 全量Vitest首次 | 1989通过/3失败，退出1；新服务夹具漏显式not_requested，修正夹具未放宽契约 |
| `pnpm exec vitest run --maxWorkers=2`复验 | 168文件1992项全部通过，退出0；含ACT设备56项与资源同步8项，不重复累计 |
| `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build` | Web、Android/iOS JS/Hermes导出通过，退出0；无原生二进制 |
| `node scripts/check-build.mjs` | 资源与普通Node加载通过，退出0 |
| ACT组合浏览器首轮 | 74项中62通过/10失败/2原有跳过，退出1；新增fixture入口与保存返回页不符，尚未到业务断言 |
| ACT fixture入口修正后 | 只改测试入口，不改产品/断言；desktop5通过（11.5秒）、mobile5通过（10.6秒），均退出0 |

浏览器以with_server.py在127.0.0.1:53812运行，使用系统Chrome、1440×1000及390×844视口。首轮选择ACT流程、考试设置、材料、布局、校验、按需、重做、更正、批次与备用等15文件。后续仅对仍失败的[ACT流程](../../tests/mobile-e2e/act-flow.spec.ts)分别执行 `pnpm exec playwright test tests/mobile-e2e/act-flow.spec.ts --project=desktop --reporter=line` 与 `--project=mobile`。72个不重复用例分批通过，2项既有窄屏顶栏跳过；不宣称一次新的74项矩阵全绿。首轮及两次复验日志分别为browser.log、act-desktop.log、act-mobile.log。

构建后的298份实现/资源指纹保持一致，修正fixture不触发重建或重跑已通过的62项。各轮临时服务退出、端口释放，未操作已有3100服务、真实配置/记录或`.env`。

## 官方依据与未验范围

核对[ACT结构页](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/act-exam-sections-and-structure.html)、[Science说明](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/description-of-science-test.html)和[Writing说明](https://www.act.org/content/act/en/products-and-services/the-act/test-preparation/description-of-writing-test.html)。Science涵盖数据、实验与观点，考场禁用计算器；Writing要求建立自身立场并分析与一个或多个给定观点的关系。官网不同页有旧结构表述，方法不写死题数/时长或科学必考性，不将TARA的750词上限套给ACT。

当前缺口：本轮没有ACT官方固定题集的真实模型复评、长文/跨页视觉质量及真机验收。保留服务路径的考试资源提供方式不同，未同步设备预加载能力；共享历史封包的修复不等于该服务全链验收。后续真实调用须明确opt-in，旧版样本成绩只作历史证据。

不包含APK/Xcode编译、真机后台、Firefox/Safari、PostgreSQL集成、远端CI或部署。本轮未重跑依赖审计/更新依赖；上轮留有node-forge/braces两项high，本地合并例外不代表审计通过。
