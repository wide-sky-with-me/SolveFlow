# 本地 M1：数据库、上传、API 与移动 Web

最新补充：自动科目与图文答案已实现，二次函数综合题真实链路约62.7秒PASS，独立面积真值32/3、图示及移动渲染通过，见[本次验收记录](RICH_ANSWER_ACCEPTANCE.md)。用户明确续额的新窗口剩余19.836160元保守预占空间，旧历史完整保留。

2026-09-10。依据用户要求完成本地M1最小纵切验收，决策见 [ADR 0001](adr/0001-local-m1.md)。真实清晰代数题已从网页上传经Solver/Verifier得到PASS，约6.8秒；详见[M1真实验收](M1_LIVE_ACCEPTANCE.md)。M0全部安全门槛与公网发布验收仍未完成。

最新回归：488项离线测试、23项隔离DB/S3/Pi集成、16项桌面/移动E2E通过，lint/typecheck/build通过。已实现自动识别/纠正科目、Markdown/公式/本题授权图片、可独立校验的坐标图与手机放大，见[ADR 0003](adr/0003-automatic-subject-rich-answers.md)。下文458/12/4为首次交付历史记录。用户明确续额的新预算窗口见[ADR 0004](adr/0004-explicit-budget-renewal.md)；旧7次请求27.499072元预占完整保留。

## 实现

- `packages/contracts/src/http.ts`：version 1 HTTP/SSE、上传、会话和任务契约，拒绝客户端owner/远程图片字段。追问沿用原图，最多9条既有答案/澄清作为历史（定向追问的历史上限4KiB，完整机制见ADR 0008），优先最近记录，总UTF-8 JSON最多12KiB；单条问题/答案最多500/2000字符，截取会标注节选。
- `packages/db/`：Drizzle schema与不可变初始SQL迁移，迁移校验hash/事务锁。签名匿名owner；同题一个活动run，幂等键持久化；owner锁串行校验每日30次上限，会话最多10次。run结果、终态与final/done事件同一事务落盘。
- `apps/api/`：Hono API和独立worker入口。Cookie HttpOnly/SameSite=Strict，HTTPS下Secure，写操作检查Origin；会话、上传绑定、图片、run/SSE、取消、删除均验证owner。安全错误码不透传内部异常。
- 上传真实解码JPEG/PNG/WebP，拒绝动画（含APNG），PNG最多4096块；输入10MiB/2000万像素，自动方向、白底、缩至2048px、转JPEG并剥离EXIF，输出最多4MiB。只允许multipart单文件；正文10秒/字节上限，上传并发2、图片读取并发4、SSE全局32/owner3；速率表最多1024项。无远程URL读取。
- 私有S3桶不接受已有桶策略；预览通过同源授权接口读取，浏览器不拿S3凭据/签名URL。未绑定图片1小时、已绑定7天，删除立即停止API访问；worker每30秒批量清理对象/题干/答案/事件，存储删除最多5次，超过后保留待运维处理记录。SSE事件保留24小时，过期返回410，GET任务仍能恢复结果。
- worker领取任务使用SKIP LOCKED和30秒租约，每秒心跳，过期标WORKER_LOST且不重放外部调用。总120秒包含排队；取消先入库，再经心跳/进度传播，迟到结果不能覆盖终态。模型阶段仍使用既有Pi循环，受监督线程在finally回收。
- `apps/web/`：Next.js/React/Tailwind/KaTeX。拍照文件选择、相册、拖放、预览/旋转、自动科目和补充说明、保存/提交、阶段进度、取消/重试、答案步骤和校验标记、同题追问、历史与删除。KaTeX trust=false/maxExpand=100/maxSize=20；正文支持受限Markdown、表格、行内/独立公式、本题授权图片与结构化图示；不执行raw HTML或活动Markdown链接。
- 手机底部导航、安全区、16px输入框、主要44px触控目标、窄屏公式独立横向滚动。无Service Worker，无私有响应缓存。交互裁切已在2026-09-14可用性增量实现（ADR 0008）；PWA、搜索/外部MCP和隔离SymPy仍属于后续阶段。

## 本机启动

Node 24.19.0、pnpm 11.25.0、Docker Compose。PostgreSQL镜像17.9-alpine3.23（PostgreSQL许可），MinIO RELEASE.2025-09-07T16-13-09Z（AGPL-3.0，仅此开发组合使用）。本轮创建的容器仅为`solveflow-local-postgres-1`与`solveflow-local-minio-1`，不依赖或改动其他项目服务。

```sh
pnpm install --frozen-lockfile
pnpm local:setup
pnpm infra:up
pnpm db:migrate
pnpm dev:demo
```

浏览器访问 **http://127.0.0.1:3100**；API **http://127.0.0.1:3101/api/v1/health**。页面“试试示例题”使用项目自制`2x+3=7`图片，经过真实上传、数据库、存储、队列和SSE；Solver/Verifier为明确标记的演示夹具，其他图片返回澄清，不冒充真实识图。

`pnpm dev`按`.env`的`SOLVEFLOW_APP_MODE`运行，默认disabled，仅上传保存。`dev:demo`只覆盖子进程模式，不改变模型配置、账本或`.env`。Ctrl+C停止本次web/API/worker；数据库/MinIO数据卷保留。`pnpm db:migrate`限定本项目127.0.0.1:54329/solveflow，不自动迁移其他环境。不要对已有卷更改数据库密码后期待容器自动同步。

生产编译用`pnpm build`，本地启动产物用`pnpm start`或明确演示的`pnpm start:demo`。这里只提供本地运行入口，实际手机通过局域网/公网访问需后续可信HTTPS部署；不声称已在iOS/Android实机验收。

## 验证记录

确定性离线测试不加载真实凭据。旧协议测试会监听localhost，受限沙箱需允许运行；一次普通沙箱运行因EPERM失败，随后在允许localhost的环境回归通过。E2E需要先启动`pnpm dev:demo`；使用本机Chrome，路径可由`SOLVEFLOW_TEST_CHROME`指定。浏览器测试只创建自身匿名会话并通过API删除。

- `pnpm test`：458项通过（42个文件），见 [PI_COMPATIBILITY.md](PI_COMPATIBILITY.md)。覆盖既有Pi/MCP/预算与新增HTTP契约、图片、身份、进度持久化。
- `pnpm test:integration`：12项通过；随机创建`solveflow_test_*`数据库和`solveflow-test-*`桶，退出只删除自身测试资源。覆盖真实迁移重复应用、私有S3匿名403、所有资源跨owner、并发幂等/日上限、演示worker与追问、终态事件原子性、SSE重放/断线、取消传播/迟到结果、WORKER_LOST、游标过期、删除与有限清理重试。
- `pnpm test:e2e`：桌面1440×1000、触摸模式390×844及320×700检查，开发与生产构建下均4项通过。上传→SSE→答案→追问→刷新→删除，关闭相机选择器后相册仍可用，伪JPEG显示错误；无页面脚本异常、无横向页面溢出。截图保存在忽略的`.runtime/screenshots/`，全部为自制示例。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`已通过，包括Next生产编译和纯Node加载；最终服务端改动又通过全包编译与严格类型检查。`pnpm install --frozen-lockfile --offline`通过，浏览器10个JS产物未包含本机私有配置值。`pnpm probe:offline`通过，3个本地模拟请求均含图片，read/calculate/无工具Verifier正常。
- 修复启动器经pnpm退出后遗留Next子进程的问题，改为直接监督Next CLI；已实测停止后3100/3101均释放，再成功启动生产演示。

## 历史配置改造与后续验收

通用供应商改造已移除型号锁定：本机deepseek-flash-guan通过config:check，模型/供应商/容量/报价来自.env，见[ADR 0002](adr/0002-configurable-model-providers.md)。配置改造阶段为476项离线回归；后续真实网页链路现已通过。

M1真实验收前旧账本预占19.368元。核实新型号报价及总输出限制后，本机按每请求2.032768元预占，并完成4次模型请求，累计27.499072元；历史记录全部保留。额度不足时在入队前返回SPEND_LIMIT，不以未授权错误混淆，也不重复执行已存在的幂等请求。真实追问未追加付费验收，确定性追问测试已通过；实际账单仍需核对，不自动释放预占或提高预算。

公网需要正式身份/配额风控、跨进程限流、存储非root与更完整隔离/监控、清理失败处理、HTTPS与真机相机/键盘验证。当前配置型号失效时停止，不自动换模型。M0剩余兼容性门槛继续见兼容记录；本地M1最小纵切通过不表示M0全部安全验收、M2/M3或生产发布就绪。

## 自动科目与图文回归（2026-09-10）

新增集成场景验证旧math提示被结果physics纠正、取消后的迟到纠正被忽略；图示在实际Pi本地合成提供商中经历Skill正文→参考资料按需读取、无工具Verifier的diagram检查、最终事件和DB保存。浏览器夹具验证$…$/\\(…\\)/\\[…\\]、表格、原题图片解码、外部图片零请求、危险链接/raw HTML不执行、320px无页面溢出和图示放大滚动。修复独立数学分隔符缺少内侧换行导致误按行内公式解析的问题。
