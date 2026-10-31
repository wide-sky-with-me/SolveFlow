# SolveFlow 公网手机拍题

独立精简入口：访问密钥登录、考试选择、单张拍照/相册、简洁答案和当前浏览器历史。没有模型设置、批量或导出页面。单题沿用简答模式，结果标明未校验。

浏览器复用客户端引擎与本地历史；服务端执行固定模型流程，访问Cookie、图片校验、并发/每日额度和重复提交保护均在后端。模型密钥不进入浏览器，开发资源不进入学生提示。

界面沿用完整版的蓝灰主题、纸张插画和紧凑按钮。考试选择使用带选中标记的浮层，支持方向键、Home/End、Enter、Esc及点击外部关闭；解题时锁定选择，历史保留题目原有考试快照。主题跟随系统，兼容320宽及短横屏。答案尚未保存时禁用退出，先重试保存。

- 构建：根目录`pnpm build:photo-web`。
- 检查：`pnpm --filter @solveflow/photo-web typecheck`、`pnpm test:photo-web`；后者需要先构建并有Chrome，只用合成题/假模型。
- 打包：`pnpm package:photo-web`；从当前锁定依赖离线收集Sharp运行库和Node，不打包配置、历史或真实图片。
- 运行：`SOLVEFLOW_PHOTO_CONFIG`指向0600的服务端配置，`pnpm start:photo-web`。

部署、签名证书续期、访问密钥交付及回滚见[操作指南](../../docs/cookbook/public-photo-web.md)；边界原因见[决策](../../.agents/notes/implemented/architecture/2026-10-31-public-photo-web.md)。
