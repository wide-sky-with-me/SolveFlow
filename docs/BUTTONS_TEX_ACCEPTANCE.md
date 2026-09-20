# 0.1.13 按钮与题干公式编辑（2026-09-16）

## 范围

- `question-thread.tsx`、`answer-panel.tsx`、DOM `answer-document.tsx`/`problem-statement.tsx`：将重新解答移到题目标题旁，仅当前最新可重做结果显示入口；历史版本不重复显示。原图入口保留，多题各自定位原题，忙碌/未配置时禁用，原生文字降级也有对应入口。
- `ui.tsx`统一RN操作按钮：蓝色主按钮、浅蓝辅助按钮、浅红危险操作，圆角14px（紧凑按钮12px），点击背景反馈和键盘焦点；至少44px点击高度。`answer.css`统一解答中的图示/追问按钮和刷新图标；个人页入口、历史操作补充按压反馈。原有底栏多层图标过渡保留。
- `formula-editor.tsx`在更正题干中保留原始TeX编辑，`math-preview.tsx`实时使用原有安全MathText/KaTeX渲染；支持行内/块级公式，未完成语法退回源码显示。禁raw HTML、危险链接与远程图片，延续trust=false和展开限制。
- `tex-edit.ts`按当前选区插入公式/分数/根号/上下标，选中可修改部分；在已有美元或括号TeX公式内不嵌套分隔符，超2000字符时不插入。更正提交仍发送原始源码，不将预览HTML存储或传给模型。
- 新增预览本地DOM资源，TeX源码以URI编码字符串跨Android初始props桥接；`showRegenerate`为答案显示payload可选布尔字段，旧payload可读取，不改持久化/模型协议。

## 验证

- `pnpm build:server`、移动端与根目录TypeScript检查、lint、Web导出通过。
- `pnpm exec vitest run packages/client/src/tex-edit.test.ts packages/client/src/answer-payload.test.ts`：5项通过，覆盖选区插入、已有公式分隔符、输入限制及Android注入安全。
- 桌面/手机浏览器相关36项首轮35项通过；新TeX预览、源码提交、危险语法、重做位置与同题范围均通过。横屏裁切失败复现后定位到操作栏增高使竖图缩小、合成触摸位移低于浏览器阈值；横屏改为单行操作栏，辅助按钮紧凑化，增加预览空间，不修改裁切断言。
- 本轮不调用真实供应商。最终构建与复测结果追加如下。

- 修正后裁切/历史/TeX编辑8项桌面与手机回归全部通过（36秒）。连同首轮其他通过用例，本轮相关36项全部取得通过结果；日志`/tmp/solveflow-v113-e2e.log`与`/tmp/solveflow-v113-final-e2e.log`。没有降低触摸或布局断言。
- 最后补齐历史收藏/移除按钮悬停时的对比色；Web重新导出，APK在相同原生工程中增量编译。
- 未修改Agent执行、模型提示词与数据库，本轮没有重复完整Agent/数据库集成套件；不调用真实供应商，iOS构建继续暂停。

- 最终APK原生增量构建通过（20秒，前序完整`pnpm mobile:apk`已通过）；包内3个DOM资源、公式预览、题目旁重新解答桥接、公式/图示/历史、240px布局、离线与注入防护通过。日志`/tmp/solveflow-v113-apk-release.log`、`/tmp/solveflow-v113-apk-dom-final.log`。
- 最终0.1.13/versionCode14，43,688,310字节，SHA-256 `09b10755ecbe36c5cc953c556979b1f5afc182ca0360ca224bb121eceb1ec727`，产物`.runtime/artifacts/solveflow-arm64-local-0.1.13.apk`。签名与前版一致，私密配置扫描通过，新增公式预览资源约增加0.45MB，不增加依赖。
- 已覆盖安装到iQOO Neo9，原云盘文件更新为`solveflow-0.1.13-arm64.apk`并回读名称/大小，未改变共享权限。
- 真机已读回14/0.1.13，截图确认重新解答位于题目标题旁，TeX公式预览正常；分数插入、取消编辑、重新打开原题源码未改变均通过，记录`.runtime/device-buttons-tex/result.json`。首轮测试脚本把Android Escape关闭弹窗误当成仅隐藏键盘，修正脚本后完整通过；产品未绕过取消断言。未点击解题提交按钮。
