# HTTP IP 与默认端口域名试用

日期：2026-11-05；工作从11月4日深夜开始。分支`feat/public-photo-web`未提交工作区。用户明确指定18443，并要求原域名HTTP不带端口；保留原HTTPS、全部账号与考试数据。

## 实现与边界

独立HTTP API配置显式启用试用，精确放行IP来源及配置中的HTTP域名别名；Cookie另命名，HTTPOnly/SameSite、权限与CSRF检查保留。前端UUID优先原生实现，缺失时用getRandomValues生成v4，不用弱随机数。私有存储和模型继续HTTPS。

试用Compose不启动第二个worker，不改迁移或初始化；服务名使用`http-trial-api`，避免同一外部网络的`api`DNS别名影响原HTTPS入口。默认80域名通过网关转入试用API，原443后端不变。当前语义与停止步骤见[指南](../cookbook/managed-exam-http-trial.md)。

## 隔离验证

单元覆盖默认HTTPS、回环兼容、HTTP显式开关、精确域名别名、私有S3不降级及安全UUID。Chrome/WebKit在真实非安全上下文验证登录、图片上传、切题、教师人工回复、学生通知、域名80入口登录及真实WS鉴权；假模型终态，不调用付费服务。

初次新场景的Chrome通知断言失败：夹具把题目直接取消，未先建立待处理问题。补上明确的假失败后保留通知断言。WebKit的Playwright路由转发没有保留二进制文件体和Cookie；改用仅监听回环的HTTP代理，真实转发浏览器网络请求后通过，未放宽应用的大小限制或登录校验。

实际命令均退出0：

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/exam-web/src/server/transport.test.ts apps/exam-web/src/browser/request-id.test.ts apps/exam-web/src/server/config.test.ts apps/exam-web/src/browser/api.test.ts` | 18项通过 |
| `pnpm --filter @solveflow/exam-web typecheck`、`pnpm --filter @solveflow/exam-web build` | 类型及构建通过 |
| `pnpm lint` | 源码边界与文档检查通过 |
| `node scripts/test-managed-exams.mjs --image=postgres:17.11-alpine3.23` | 129项通过：基础44、交互38、边界16、临时拍题5、计时18、分配8；含两项HTTP浏览器回归 |

分组筛选所示skipped是其他组稍后运行的测试，不是整轮漏验。隔离浏览器使用回环HTTP代理构造公网非安全上下文，不能代替iPhone相机真机验收。

## 腾讯云部署

新增独立试用镜像`solveflow/exam-web:20261105-http-trial`，ID为`sha256:cf2256ffa76a34815059adb689f49c6483e7eb483f8488e04475cd43b0a8e153`。发布来自507份文件的工作区快照，源清单SHA-256为`220d5c5053d5b4fd6b109972d5a978c952edbc4394812d7777ec24007162403e`；不是已提交版本。

原HTTPS仍运行`20261104-progressive-images`，主配置摘要、current链接、schema7及除gateway外的原容器ID和启动时间不变。部署前导出191745字节PG逻辑备份，并用pg_restore列出目录验证格式；未执行恢复演练，也未把该备份视为对象存储备份。仅新增HTTP API及更新网关，未重启worker、数据库或存储，未创建/删除账号或考试。

回环IP18443、带域名Host的80及严格TLS域名443健康检查均200。最终八个考试容器运行，带健康检查的均healthy；无关beacontower保留。本次新增付费调用0。私有回执、日志、截图保存在忽略目录，不公开配置或凭据。

## 公网与Mac实测

| 入口与网络 | 实际结果 |
| --- | --- |
| `http://110.40.227.224:18443/`，本机公网 | 首页及健康检查200；Chrome/WebKit中管理员、老师、学生六组登录/退出通过，老师WS打开，学生相机文件入口可启动 |
| `http://solveflow.widesky.top/`，本机公网 | 默认80，无端口；首页及健康检查200，同样六组浏览器登录/退出与老师WS通过 |
| IP18443，远程Mac直连 | 健康检查200；原生WKWebView登录、教师监控与WS通过，JavaScript错误0，确认为非安全上下文且原生randomUUID缺失 |
| 域名默认80，远程Mac直连 | 仍302到腾讯云备案阻断页；不是应用重定向，未宣称已恢复该网络路径 |

Mac临时探针首次因SDK的同步方法标签应为`in:`而编译失败，按实际SDK签名修正后通过；只影响验收脚本。探针、临时凭据与目录已清理，未修改Mac3131应用。

公网浏览器检查只登录/读取/退出，不选择题图、不启动考试或模型。隔离测试覆盖上传和人工回复，公网没有用真实题图重复验证；iPhone系统相机、移动运营商网络、明文HTTP长期可用性未验。域名仍可能受备案拦截、HSTS或HTTPS优先影响；当前可用于Mac测试的是显式HTTP IP入口，不能把一条网络200概括成所有设备均通。

## 文档与PDF

运行指南补充双入口配置、会话隔离、网关恢复及停止顺序；项目状态区分HTTPS原版本与HTTP试用版。原17页图文手册和一页账号清单同步更新临时访问地址及域名限制，保留十个新增账号、四个原测试账号和截图；复核页数、A4尺寸、凭据及HTML页面无溢出。PDF仍只在私有交付目录保存。
