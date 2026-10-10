# 知识点公式隐藏控制字符复核

日期：2026-10-09。范围：用户指定的127.0.0.1:3100题目记录、共享公式渲染入口及浏览器展示。

结论：实际知识点公式含不可见ESC字符，导致KaTeX拒绝解析并显示橙色原文。已修复并更新当前网页版；已有记录不需要重新答题。

## 变更与处理

[前一轮](2026-10-09-knowledge-formulas.md)覆盖了截图所示反引号格式，但未读取实际记录中的隐藏字符，不能解释本次故障。本轮只读对应应用origin和用户指定session的Chrome IndexedDB日志完整快照，提取知识点字段到忽略目录，不读取其他站点、不改写原浏览器存储。两条问题公式均含U+001B。

共享渲染入口仅在展示前删除非空白C0和DEL控制字符，保留换行、制表、原始名称及追问引用。不降低KaTeX语法、信任或资源限制，也不重写保存结果。当前语义见[阅读与绘制](../subsystems/rendering.md#学科结构)。

## 验证结果

新增控制字符单元回归首次1失败、4通过，退出码1；使用实际知识点字段在隔离浏览器复现旧构建无法生成两条公式，退出码1。修复后：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run apps/mobile/src/dom/math-render.test.ts packages/client/src/math-delimiters.test.ts` | 2文件9项通过，退出码0；普通公式、化学式及安全限制保持 |
| `pnpm typecheck` | 工作区与移动端通过，退出码0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/knowledge-math-controls-2026-10-09/web` | 导出成功，退出码0 |
| `pnpm exec playwright test`，knowledge-math/knowledge-on-demand/math-rendering/learning-content/conversation-math | 桌面和移动视口共12项通过，退出码0；含320/1440像素、深浅主题、控制字符、代码格式和追问引用 |
| `pnpm lint`、`pnpm docs:check` | 源码边界和文档检查通过，退出码0 |

实际知识点字段在隔离新构建与当前3100入口均渲染通过；当前入口响应与新构建一致，刷新后仍正常，保存的原始知识点名称未变化，模型POST为0。人工核对完整知识点截图。入口最后替换、旧哈希资源保留；本轮随机端口测试服务已关闭，用户3100服务保持运行。

## 未验证项与剩余风险

证据保留于忽略目录`.runtime/knowledge-math-controls-2026-10-09/`，不向仓库保存题图、完整题目记录或模型原文。测试重放仅含实际知识点字段，其余会话与图片为合成数据；未调用真实模型、未重新安装Android或验证iOS原生。非法TeX仍提供原有可读回退。
