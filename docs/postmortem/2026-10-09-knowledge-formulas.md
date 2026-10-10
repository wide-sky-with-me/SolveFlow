# 知识点公式渲染修复

日期：2026-10-09。范围：知识点标题与讲解的公式展示，使用合成三角恒等式记录及隔离浏览器存储。

结论：行内反引号中的明确数学片段已能渲染，当前 localhost:3100 网页已更新；已有记录无需重新答题。

## 变更与处理

截图中的公式被模型写成 Markdown 行内代码。原有规范化函数正确保留代码片段，导致知识点公式显示原始 TeX。新增仅由知识点组件启用的格式兼容，在展示时识别明确公式并交给已有 KaTeX；普通代码、代码块、保存名称及追问引用保持原样。不改变公式安全限制或学习请求流程。运行语义见[阅读与绘制](../subsystems/rendering.md#学科结构)。

## 验证结果

先增加回归：单元测试首次1失败、3通过，浏览器桌面和移动视口各1失败，均复现公式未生成 KaTeX 元素。修复后以下命令退出码均为0：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run packages/client/src/math-delimiters.test.ts apps/mobile/src/dom/math-render.test.ts` | 2文件8项通过；覆盖格式识别、代码保留及已有公式安全限制 |
| `pnpm typecheck` | 工作区与移动端类型检查通过 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/knowledge-math-2026-10-09/web` | Web 导出成功 |
| `pnpm exec playwright test`，knowledge-math/knowledge-on-demand/math-rendering/learning-content/conversation-math | 12项通过；公式、按需讲解、追问引用、刷新及旧记录正常。截图改为完整知识点区域后，单独复测2项通过，不重复累计 |
| `pnpm lint`、`pnpm docs:check` | 源码边界与文档检查通过 |

知识点截图覆盖320与1440像素、深浅主题，人工核对完整公式与讲解。当前3100服务返回HTTP200并提供新构建，隔离存储合成记录的公式展示通过，模型POST为0。静态资源先复制、入口最后替换，保留旧哈希资源与入口备份。首次失败、复测日志和截图保留在忽略目录`.runtime/knowledge-math-2026-10-09/`；两个隔离静态服务已关闭，保留用户3100服务。

## 未验证项与剩余风险

本轮未调用真实模型，未检查用户实际知识点记录全文；回归使用截图中的公式形式。共享组件修改可随下一次原生打包生效，但本轮未执行APK安装或iOS原生验证。格式兼容只处理明确数学片段，非法公式仍使用现有可读回退。
