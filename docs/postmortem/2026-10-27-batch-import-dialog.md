# 编号网格插入弹窗验收

日期：2026-10-27。范围：本地Web导入确认和已有批次新增位置选择，不含远程Mac部署。

## 调整

根据用户反馈，将全屏工作台改为带遮罩的居中弹窗，最大宽度760，标题和操作栏固定，中部内容独立滚动。取消、关闭和忙时停止保留原有保存守卫。

工作台不展示、读取或解码原图/补图。待加入图用编号条和当前文件名识别；已有题图改为与快捷跳转一致的52×48编号格。“新1”等标记插在预览顺序中，蓝色光标跟随当前新图。点击原编号选择其前方位置，点击“末尾”追加；支持逐张设置、整组放置及全部追加。

原先重复的图片列表、位置表单和顺序条合并，移动/移除只保留当前新图的一组操作。新建空批次仍按文件名列表确认，也不显示图片。位置投影、逐图事务、双图预处理、保存后入队及停止续传没有改变。

实现：[弹窗容器](../../apps/mobile/src/components/batch-import-dialog.tsx)、[编号工作台](../../apps/mobile/src/components/batch-import-workbench.tsx)、[导入确认](../../apps/mobile/src/components/batch-import.tsx)。此前功能与事务验证见[工作台验收](2026-10-27-batch-import-workbench.md)。

## 检查与结果

环境：Node24.19.0、pnpm11.7.0；独立45187服务禁用环境模型，Chrome使用合成JPEG和假模型。桌面1440×1000、手机视口390×844，并在单张插入时切换844×390横屏。

| 命令与范围 | 实际结果 |
| --- | --- |
| `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit` | 退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-import-dialog-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45187 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts` | 首轮30通过、2失败，退出1；旧取消测试仍点击已换为“关闭导入”的“返回”，更新到实际控件后定向复测通过 |
| 同一URL，两个测试文件按`cancelling selection preview\|camera gallery queues`筛选 | 两个关闭测试及两个连续相册新增测试共4项通过，退出0；不同场景合计34项，不累计重复预跑 |
| `pnpm lint` | 退出0；包含边界与文档检查 |

交互验证包括单图默认末尾/中部插入、取消不保存不发请求，多图分别插入和整组放置、停止后继续不重复、旧题session保留；原有自然/时间/手动排序、存储失败恢复、容量边界与离开后迟到保存的回归继续通过。连续相册新增测试区分空批次顺序确认与后续工作台，保留原来的解题和历史断言。

布局断言要求弹窗四周留出空间、宽度不超过760、确认按钮处于窗口内；手机横屏也满足。窗口内图片元素为零，单张光标唯一且随所选位置显示。人工核对浅色桌面/手机和深色多图截图；截图等待入场动画结束。

本次仅界面调整，未重跑未修改的核心单元套件，未进行付费模型请求。未验Android/iOS原生、Firefox/Safari或大批量实际性能，不以手机视口替代真机。

日志、截图、源码前快照在私有`.runtime/batch-import-dialog-2026-10-27/`。验收后停止45187测试服务；本机3100保留。更新先复制静态哈希资源，最后原子替换入口并保留旧资源，不重启用户服务，不清理已有数据。
