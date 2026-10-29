# 批量重答隔离与提示反馈验收

日期：2026-10-27。范围：本机Web重答入口、图文按钮状态和补图提交回执。

## 原因与改动

批量补图的队列已只替换接收者，但题目页和线程仍以全局queueBusy拒绝“重新解答”；DOM按钮却按辅助请求的禁用状态渲染，因此看似可点击而处理提前返回。补图成功提示只写入页面字符串，没有清理路径。

[批量题页](../../apps/mobile/src/components/batch-question.tsx)的重答改走[运行时](../../apps/mobile/src/runtime.ts)专用入口，复用原有有界队列和并发上限；只锁定本题并防止重复提交。空余槽位立即派发，满额时显示“本题已排队，等待可用的答题名额。”。源版本、图内题号及备用配置沿原请求，其他题不取消、不改图、不重排等待项。辅助请求与重答的按钮禁用字段分开，旧图文载荷保持兼容，文字回退和备用重答一致。

[补图成功提示](../../apps/mobile/src/components/batch-workspace.tsx)5秒后收起，重复相同提示重新计时，切换批次或页面清除；它不控制解题任务寿命。未改持久化、队列算法、模型设置、费用或并发值。当前行为见[批量补图](../subsystems/batch-materials.md)，原因见[决定](../../.agents/notes/implemented/architecture/2026-10-27-batch-regeneration-admission.md)。

## 复现与验证

Node24.19.0、pnpm11.7.0；45195隔离服务禁用模型转发，Chrome独立存储、合成JPEG及假模型。

旧构建以1/2个solver名额均复现：保持第2题补图重答运行，第1题按钮可点但不入队，没有新解答。新场景同时验证空位立即执行、满额排队、两次快速点击只请求一次、第2题不中断、第3题记录不变、提示5秒后消失仍不取消第2题。

首次测试夹具误以为学生请求携带内部identity，修正为按合成请求图片数量识别；该次不算产品复现。载荷单测首次使用了非安全目录错误文案，改用共享安全构造器；移动类型检查指出不支持的status角色，改为已有的polite实时反馈。保留失败日志，不放宽断言。

- `pnpm --filter @solveflow/client build`：退出0。
- `pnpm exec vitest run packages/client/src/answer-payload.test.ts packages/client/src/local-batch.test.ts packages/client/src/local-batch-materials.test.ts --maxWorkers=2`：45项通过，退出0。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`：均退出0。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-regeneration-2026-10-27/web`：退出0。
- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45195 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-materials.spec.ts --grep 'manual regeneration works'`：专项4项通过，退出0。
- 同源完整运行`batch-materials.spec.ts`、`regenerate.spec.ts`、`batch-learning.spec.ts`：57项通过、3项鼠标专用场景在触屏项目跳过，退出0，3.0分钟；包含专项4项，不重复累计。
- `pnpm lint`：退出0，含边界及文档检查。生命周期页初次2272单位超限，精简重复准入描述后通过，没有调整门槛。

本机3100服务261661保持运行，先复制静态资源再原子替换入口，保留旧资源和浏览器数据。首页与11项JS/CSS均200且与新构建哈希一致；模型请求0。旧版复现与新版复测的45195自建服务均核对身份并停止，未停止用户服务。

私有证据在`.runtime/batch-regeneration-2026-10-27/`。未发起付费请求、未验原生真机、未部署远程Mac。
