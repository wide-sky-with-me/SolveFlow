# Web PDF 源码生命周期候选

日期：2026-10-17。范围：把[后页隔离实验](2026-10-17-pdf-lifecycle-parser.md)收敛为可重复生成、可审查的浏览器依赖候选；不是整批或生产验收。

## 状态与落点

候选 v6 留在 `.runtime/pdf-production-2026-10-16/r50-html2canvas-v6`。未登记 pnpm 补丁、未接下载器、未构建或替换服务产物；现有重试、画质与 UI 保持原状。

[生成器](../../scripts/generate-html2canvas-lifecycle.mjs)校验 html2canvas 1.4.1 原 UMD/源图哈希，从源图 TypeScript 重编主流程，并对未最小化 renderer 插入作用域检查。原同步 callable、parser 与 await/generator helper 保持原字节；移除 context 捕获及检查后，renderer 算法 token 与原版相同。UMD、ESM、min 及声明同步生成；MIT 许可保留，陈旧 browser sourceMappingURL 移除，直接 dist/lib 导入不在适配范围。

[独立句柄](../../apps/mobile/src/local/pdf-render-lifecycle.web.ts)使用该次真实检查闭包，不查询最新任务；[纯类型契约](../../apps/mobile/src/local/pdf-render-lifecycle.types.ts)隔离 NodeNext 测试与移动端 bundler 编译边界。取舍与限制见[提案](../../.agents/notes/proposed/storage/2026-10-17-pdf-render-lifecycle.md)。

## 本轮验证

[生成器契约](../../scripts/html2canvas-lifecycle.test.mjs)通过 7 项，检查原字节/算法、恢复分支范围、导出能力、确定生成、输入漂移与输出边界。[原生浏览器组件](../../tests/mobile-e2e/pdf-render-lifecycle.spec.ts)通过 66 项：桌面和窄屏 Chrome 各跑同组，不代表手机真机。

| 组件范围 | 项数 | 实际证据 |
| --- | --- | --- |
| 文档归属 | 28 | 导航、重接、保状态移动、同 Document 根替换、关闭与取消优先 |
| 协作等待 | 8 | 原生 scheduler.yield、定时器回退、恢复后失效与等待前失效 |
| 入口保真 | 6 | 三入口各比较原版、同步首路径、协作后路径；RGBA 差异 0，原生 JPEG 一致 |
| 资源恢复 | 16 | 图片、SVG、背景和列表资源挂起；取消/期限后 B 先完成，再释放 A，原错误保留、主画布绘制增量 0、失败画布归零 |
| 克隆清理 | 8 | onclone 同步抛错、异步拒绝、取消与期限回调失效；保留父 frame，克隆数 0，错误对象不变 |

保真样本为合成文字、边框、PNG 与 SVG，scale=2、JPEG=0.94；此处 JPEG 用原生 toDataURL 对照，不是整批下载编码验收。资源测试通过真实 renderer 的 cache 端口注入等待；期限使用缩短时钟或回调失效注入，不冒充完整 30/60 秒期限。待完成资源 Promise 仍会等待，验证的是恢复后拒收迟到结果，并非立即中止底层解码。

根 `tsc --noEmit`、移动端 typecheck 均退出 0。纯类型拆分前后，浏览器句柄 IIFE 字节完全一致；未据此重跑或宣称新的产品成绩。组件无产品页面、存储或业务模型请求。

## 失败与修正

恢复检查最初误入普通 CSS switch；收紧后又发现背景图降级循环的 this 不属于 renderer。现在方法入口捕获 context，内部生成器使用该绑定，结构计数锁定 12 方法、95 检查点。文档对象不变但根已替换的两例曾失败，补根身份后回归通过。

独立只读审查发现 toIFrame await 在 try 外，onclone 失败后克隆残留。保留父 frame 的四例先复现失败，再将克隆创建句柄记入同一 context、try 前移，并由 finally 清理；正常成品和资源失败也在父 frame 移除前检查克隆数。未增加 renderer Promise 包装。契约测试自身的函数声明查找及排版比较错误也保留失败日志，修为 token 对照而非放宽行为断言。

## 复现与边界

在工作区根使用新目录：

```bash
pnpm generate:pdf-render-lifecycle apps/mobile/node_modules/html2canvas .runtime/pdf-render-replay
SOLVEFLOW_TEST_PDF_RENDER_PACKAGE=.runtime/pdf-render-replay pnpm test:pdf-render-lifecycle
```

不传候选环境变量时，依赖候选用例明确跳过。原始失败、复测、源码快照与哈希在 `.runtime/pdf-production-2026-10-16/r50-*`，不复制真实题图或模型原文。

尚待下载器真实取消/期限接入、能力核对、pnpm 登记、整批 27 页保真与取消恢复、顺序 CPU 对照。shadow/slot/嵌套 iframe 的协作 DFS 原生对照、foreignObject 错误路径、完整期限、长负载、跨浏览器及实体打印仍未验。64 节点不是时间上限，根构造和嵌套同步岛仍存在；本轮组件结果不升级整体完成状态。
