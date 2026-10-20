# PDF 源码级绘制生命周期适配

日期：2026-10-17。状态：proposed。范围：Web PDF 的 html2canvas 浏览器入口与绘制文档归属。

## 背景

[隔离实验](../../../../docs/postmortem/2026-10-17-pdf-lifecycle-parser.md)中，后页 64 节点切片保真并缩短最长任务，但私有最小化响应补丁不是产品接口。首屏仍保持同步解析；取消闭包、单份期限和文档归属必须来自实际绘制，不用“最近任务”推断。

## 决定

[生成器](../../../../scripts/generate-html2canvas-lifecycle.mjs)锁定 1.4.1 原 UMD/源图哈希，从精确 `../../src/index.ts` 重编主流程；原同步解析与 ES5 await/generator helper 保持原字节。renderer 捕获 context，恢复检查不依赖内部回调或降级循环的 `this`，不增加 renderer await；catch 保留失效检查，避免图片容错吞掉取消。克隆创建即记入同一 context，try 覆盖 toIFrame 等待，finally 清理克隆和非成品画布。v2 注册该次绘制的同步释放回调；正常结束先解除，不提前清空成品。

协作 DFS 改用单个遍历生成器和 WALK/ASSIGNED 续帧，外层驱动不动，避免移动检查及让步边界；不是改成异步逐节点循环。保留 nextSibling 快照后的 yield、原处理主体及初始 root，assigned 子树逐项延迟进入；批量预推会提前读取兄弟和属性，故未采用。关闭时清空帧栈，不宣称所有原生工作结束。数组长度/洞沿旧协作候选语义，与原库 forEach 的差异另列，避免把兼容修复混入性能实验；新增独立 oracle 与证据见[扁平解析复核](../../../../docs/postmortem/2026-10-17-pdf-flat-parser.md)。

覆盖 UMD、ESM、min 浏览器入口与公开类型，移除失效的浏览器源码图引用；不支持直接导入 `dist/lib`。Expo Web 使用 `browser` 指向的 UMD。已沿用 pnpm 原生补丁登记机制，不引入安装后改写或手改已安装目录。[独立基线](../../../../scripts/pdf-render-baseline.mjs)在独享临时副本反向应用已登记补丁，验证五项固定 SHA 后才供保真测试使用；显式基线同样校验，避免自比与额外下载。

[独立句柄](../../../../apps/mobile/src/local/pdf-render-lifecycle.web.ts)捕获源/克隆文档、documentElement 和 frame/parent/current-document 身份。捕获时复用已有归属，仍遍历父链保留原 16 轮限制；观察仅覆盖祖先边的 childList，不扫描整文档 subtree。移除记录保留失效状态，`takeRecords` 补同步检查，覆盖同任务移除重接与保状态移动。同 Document 根替换另比对根身份。断言仅合并 owner 末尾相邻的窗口读取，仍保留前置短路及队列后 root 复查；整轮身份快照跨越可重入的队列读取，故未采用，见[窗口读取复核](../../../../docs/postmortem/2026-10-17-pdf-lifecycle-window.md)。取消/期限由真实闭包优先检查。正常库清理后只释放克隆观察，结束时断开全部观察。协作等待优先 scheduler.yield，缺省定时器，恢复时重查。

## 放弃的方案

继续修改最小化状态机难以审阅和升级，故仅保留历史实验。统一 async 化首屏或增加 renderer Promise 包装可能改变首屏调度，本候选不采用。直接修改 node_modules 不可复现，使用独立候选目录验证。

2026-10-18 补充：字体度量保留同主文档及原位置。测量容器布局隔离或脱流会改变包含块/坐标语义，原方法前后稳定而候选出现数值反例，故放弃，不用布局缩小换度量容差。画布尺寸前置仅为单变量隔离候选；吞吐信号未伴随输入尾改善，正式 pnpm/Expo 接入及对象级归属复核尚未完成，故暂不写入原生补丁。取舍证据见[绘制成本复核](../../../../docs/postmortem/2026-10-18-pdf-drawing-cost.md)。

## 后果与限制

[下载器](../../../../apps/mobile/src/local/download-batch-pdfs.web.ts)启动前检查 v2 能力，每次绘制传入真实取消、资源/单份期限和文档句柄；每份首绘同步解析，后续题页才分段，原始记录仍是整本绘制。源码与锁文件已接入，隔离构建已生成；服务未替换，未通过整体生产验收。64 节点不是墙钟上限，根构造、单节点和嵌套 iframe 仍有同步岛。同步释放不代表挂起 Promise 已结束、解码已中止或物理内存已回收。

## 验证

原型见[源码复盘](../../../../docs/postmortem/2026-10-17-pdf-source-lifecycle-adapter.md)，依赖与下载链路的整批保真及性能回退见[接入复核](../../../../docs/postmortem/2026-10-17-pdf-lifecycle-integration.md)，观察去重及跨窗口边界见[监听复核](../../../../docs/postmortem/2026-10-17-pdf-lifecycle-observers.md)。[原生组件测试](../../../../tests/mobile-e2e/pdf-render-lifecycle.spec.ts)覆盖身份、深度门禁、调度、三入口像素/JPEG、挂起资源及克隆失败，清理在移除源 frame 前断言；组件成绩不证明生产验收。
