# 补图缩略图与独立编辑入口验收

日期：2026-10-27。范围：本机Web批量补图卡片，不含远程部署。

## 改动

[补图卡片](../../apps/mobile/src/components/batch-material-workbench.tsx)改为原比例缩略图、编号角标和绑定数量，完整文件名保留在图片操作弹窗及缩略图可访问名称中。单击缩略图只切换绑定对象，不打开弹窗；卡片底部新增透明“编辑图片”小按钮，明确打开对应补图的查看、裁剪和旋转操作。编辑未选中的卡片会同步选择该补图，关闭弹窗后仍在其绑定上下文。

右上角小叉单独移除补图并清除绑定。保持110px卡片宽度、118px横向步长和原有虚拟列表，继续添加自动定位不变；缩略图直接复用现有草稿URI，不新增图片处理、持久化或模型调用。卡片高度增加以容纳预览及独立按钮，主体继续滚动，标题和提交区固定。同步更新[当前说明](../subsystems/batch-materials.md)及应用内使用说明。

## 验证

Node24.19.0、pnpm11.7.0；隔离端口45194禁用模型转发，Chrome桌面/触屏视口使用合成JPEG、独立IndexedDB和假模型。

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`：均退出0。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-material-thumbnails-2026-10-27/web`：退出0。

- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45194 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-materials.spec.ts --output .runtime/batch-material-thumbnails-2026-10-27/browser`：47项通过、3项鼠标专用场景在触屏项目跳过，退出0，2.1分钟。
- `pnpm lint`：退出0，含边界及文档检查。

新增场景验证反复点击只切换、透明编辑按钮独立打开对应图片、关闭后保持当前绑定、删除不弹窗以及取消不写入或调用模型。现有回归覆盖裁剪旋转后继续追加、共享补图自动重答、事务失败重试、PDF、键盘和鼠标扫选。样式覆盖5种尺寸及浅色/深色主题，并人工查看桌面与320px深色截图；视口测试不等同于原生验收。

本机3100服务261661保持运行，原子替换入口前先复制静态资源，保留旧哈希资源及浏览器数据。首页及11项JS/CSS均200且与新构建哈希匹配；45194自建测试服务已核对身份并停止。

私有日志、截图和修改前源码保存在`.runtime/batch-material-thumbnails-2026-10-27/`。本次未连接真实模型、未验原生真机、未部署远程Mac。
