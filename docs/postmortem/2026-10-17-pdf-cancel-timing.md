# 2026-10-17 PDF 取消时序与观测纠正

## 范围与结论

继续本地3100的[绘制让步实验](2026-10-17-pdf-cooperative-yield.md)，不变更产品源码、按钮行为、依赖或服务器产物。仅在隔离浏览器增加有界诊断代理，原控制/候选绘制响应仍按精确SHA与唯一入口校验；保留完整27页恢复及JPEG门禁，不把诊断运行当作清洁性能基线。

先确认旧观测定义有歧义，而非已证实取消退化。旧`cancelToCleanMs`从Python monotonic起点包住整个mouse.click、取消按钮名称计数、打印iframe计数、隐藏渲染根计数等串行断言，再停表。它包含输入派发、协议返回和断言观测开销，不是单独abort或持久化耗时。见[旧驱动证据](2026-10-17-pdf-cooperative-yield.md)；其数据保留，不用新解释改旧原始值。

## 已核实的语义

前台按钮在signal.aborted后从“取消导出”改名“正在取消…”并禁用；旧exact-name count0可因改名满足，不代表按钮卸载、busy解除或落盘。真正的前台可操作状态需另看忙碌按钮消失且下载动作恢复；footer恢复仍不证明生成槽释放或底层第三方工作终止。

前台经独立工作控制器、已接受任务的取消桥接、Execution控制器及渲染根控制器传播；记录页则直接按任务id调用cancel，是另一入口。Core先同步标记取消并abort执行，再等串行存储锁；打印frame在signal监听中同步移除，挂起绘制的bounded随后reject，隐藏根在上层finally中unmount/remove。cancel本身不等待active.done，界面、存储与执行槽不是同一终点。实现见[前台入口](../../apps/mobile/src/components/batch-pdf-export.web.tsx)、[任务核心](../../packages/client/src/local-export-tasks.ts)、[打印挂载](../../apps/mobile/src/local/print-batch.web.ts)和[渲染根](../../apps/mobile/src/local/batch-export-root.web.tsx)。

落盘应按同任务的cancelled记录关联IDB transaction complete；put请求成功不是事务完成。commit存储失败时也可能发布内存cancelled并保留pending，故footer/终态显示不是持久化证明。旧records/files核验在墙钟停表之后，最多与计时窗口重叠，没有被该终点强制等待。

前次最长任务来自完整恢复导出窗口，取消墙钟来自另两次20份取消试验；取消试验自身的longTasks又包含启动与生成到第5页之后的时间。三种窗口不互相替代，不能由最长任务变化推出取消事件排队变化。当前RN Web的onClick调用onPress，不据此改为按下即取消。

## 分段诊断

私有探针记录同一performance.now()时钟下的可信pointer/mouse/click捕获与冒泡、各controller abort起止、自有打印frame/隐藏根移除、导出库记录put与事务完成，以及MutationObserver交付时的名称/归属/下载footer状态。只保存有界元数据与身份，不记录题图或模型正文。旧墙钟原样保留，新增可再次导出断言，不用新断言替换失败证据。

事件timeStamp到监听器时刻只描述相应事件的派发间隔；MutationObserver是变更交付时刻，不是实际屏幕呈现。诊断有额外开销，跨时钟的Python墙钟和浏览器相对时刻不能直接相减。当前探针不直接观测存储锁排队、Core active释放或全部第三方保留引用，缺口继续保留。

## 回放结果

三个独立浏览器回放分别在CPU1/4取消、再恢复单份27页。共六次取消保持终态且无成品/下载；恢复的81页实际PDF逐页抽出JPEG并匹配黄金，源题快照及7份产品源码指纹不变，真实执行VM的SHA与捕获脚本一致，业务模型调用和页面错误均为0。以下是未对取消窗口启用CPU采样的CPU4诊断，不把它们当作稳定总体分布：

| 样本 | 点击派发间隔/ms | abort同步/ms | abort至自有容器归零/ms | abort至footer恢复/ms |
| --- | --- | --- | --- | --- |
| 控制 | 21.9 | 18.5 | 80.0 | 203.2 |
| 候选 | 359.0 | 21.1 | 72.1 | 194.2 |

本次差异主要在点击处理前，后两列为MutationObserver交付时刻；不据单次小差异宣称清理提速。观察到原忙碌按钮节点还会复用为“导出记录”，所以连通性亦不是按钮语义身份。取消记录事务分别约44/51ms完成，footer晚于事务完成，不能把put当作完成点。

另一次候选回放只采取消CPU4窗口，并用console.profile启停前后的performance.now()区间校准。时钟偏移仍有104.312ms不确定性；枚举覆盖区间的全部分段临界点后，534.5ms派发间隔内有约370至435ms采样覆盖DOM解析入口jB。已从实际执行源码核对jB→递归遍历_B→容器工厂qB→读取computed style的Rr，包含CSS声明与词法解析热点。采样启停调用本身约1658/105ms，不用该运行的墙钟比较性能，也不给单点精确归因百分比。

因此仅在整页绘制前让步仍留下解析长任务。下一项私有实验应在遍历节点边界按预算让步，保持节点顺序、flag、slot/shadow和根样式语义，继续保留每份首屏原序；尚未实现或接入，不改成按下即取消。以进度可见后点击也可能采到不同阶段，后续还需独立到达时刻采样，不能将本组触发点外推为总体退化。

独立核验脚本退出0，覆盖81页JPEG、六次取消链、同任务事务完成、真正footer恢复、源码及VM指纹和采样校准。`pnpm docs:check`与`git diff --check`退出0，新增文档另通过空白复核；Node版本告警保留，未改环境。未跑新产品单元、构建或全套UI回归。证据与驱动保存在忽略目录`.runtime/pdf-production-2026-10-16/`的`inspect-cancel-*-r28.py`、`cancel-timeline-r28.js`、`verify-cancel-timeline-r28.py`和`r28-cancel-verification.json`，原始记录、PNG、PDF及VM源码不提交。
