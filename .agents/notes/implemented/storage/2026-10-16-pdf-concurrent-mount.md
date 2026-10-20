# PDF 并发挂载与根故障收口

日期：2026-10-16。状态：implemented。范围：Web 后台/前台下载的隐藏 React 根和文档就绪等待。

## 背景

`run-batch-export.web.tsx` 在阅读、纯题和每份作答分支使用 `flushSync` 挂载整份文档，React 可中断的 render 被强制塞入同步任务。既有取消用例卡住的是绘图库导入，并未覆盖已经开始的 React 挂载。异步 JPEG 只改善后续编码，未处理这个边界。

## 决定

- 新增[隐藏根实现](../../../../apps/mobile/src/local/batch-export-root.web.tsx)，保留原有离屏固定宽度、inert 容器；用 `startTransition` 调度 `root.render`。无 DOM 包装的父 `useEffect` 在首轮子效果之后确认当前代次，原 main 继续直接传给打印 frame，保持直属题页稀疏绘制与旧几何。
- 每次 render 以独立 pending 身份和回调确认，重叠调用失败，旧/重复/释放后的确认不领取新份等待。就绪仅说明提交与首轮效果，字体、图片和最终版式仍由原 frame 等待、适配与校验负责。
- 根持有与用户取消联动的子信号。`onUncaughtError` 使用静态 `ExportTaskFailure` 中止子信号，即使元素已交付也停止后续绘制；根错误不依赖 commit 与错误回调的微任务先后。用户原信号先复核，根故障不会伪装成主动取消，也不透传第三方消息/组件堆栈。
- 下载元素工厂兼容同步和 Promise，统一延后纳入原 `bounded`，避免工厂同步取消并返回 rejected Promise 时失去消费者。兑现后、图源校验/建 frame 前重新检查取消。就绪沿用资源等待期限，不重复计时；单份绘制预算仍从原 frame 完成处开始。
- finally 先停止 pending 并移除监听，再 unmount/remove；创建失败和 unmount 异常均移除容器。同步卸载异常及清理期间 React 上报的错误使用静态失败；即使清理抛错也再次让原用户取消优先。

## 放弃的方案

- 仅删除 `flushSync` 后立刻取 `firstElementChild`：React 不保证同步提交，可能拿到空节点或上一份。
- 仅以 layout effect 兑现、只 reject 当前 pending：子布局效果异常可能在父确认后才进入根错误回调；也早于已有公式的 passive 测量。
- 新增 DOM 包装：会破坏根类名/直属题页判定，静默退回整本绘制。
- helper 和下载器各加一套期限：重复计时与错误归属不清，沿用下载器阶段边界。

## 后果与限制

可中断的是 React render，不是单个 Markdown/KaTeX 函数、DOM commit、passive 效果、clone/测量、Canvas 绘制或序列化；计时器也依赖事件循环。此改动不承诺全链路无长任务或真机流畅。容量、清晰度、页数、单页字号、回答完整性门禁、缓存和模型重试策略均不改变。

## 验证

定向单元覆盖受控 commit、逐份代次、晚确认、pending/兑现后取消、根故障在交付前后中止、失败脱敏、监听与异常清理；下载器另覆盖同步/异步工厂、真实资源计时器、晚兑现/拒绝、取消竞态与绘制预算起点。runner 覆盖三种模式、逐份 copy 与纯题不传答案字段、用户取消优先。实测证据单独记录于 `docs/postmortem/2026-10-16-pdf-concurrent-mount.md`。

依据：[React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[startTransition](https://react.dev/reference/react/startTransition)、[useEffect](https://react.dev/reference/react/useEffect)。
