# 0.1.51 题号导航与单题历史空态

2026-09-29 用户要求：批量题号不足四个时均分轨道，超过四个顺延下一页；单题历史为空时隐藏清空按钮与零条计数。

## 调整

- `apps/mobile/src/components/question-pager.tsx`：题号按显示顺序四个一组，每组使用完整轨道宽度，组内等宽；末组不足四个也均分。切到跨组题目时自动滚到对应组，横向滚动按组吸附；补充记录继续保留在编号题目后。
- 题号轨道的横向拖动交给原生分页 ScrollView，移除会抢夺该滚动的父级 PanResponder。正文原有上一题/下一题手势、两侧逐题箭头、选中动效和草稿保留逻辑不变。
- `apps/mobile/src/components/batch-workspace.tsx`：只有一张题图的批次也显示铺满轨道的题号。单题阅读器默认仍仅多题时显示导航。
- `apps/mobile/src/app.tsx`：单题历史工具栏与列表依据单题记录是否存在渲染，只有批量记录时不显示“0 条记录”、清空按钮或重复的空列表。
- 不改变模型调用、存储结构与删除范围，不新增依赖。

## 验证

- 新增 `tests/mobile-e2e/pager-layout.spec.ts`：覆盖 1/2/3/4/5/9 张题图的等宽满行、四题分组、跨组选择与回退、320px 窄屏，以及只有批量记录时的单题空态；这些检查不发送模型请求。
- 在旧构建上复现三题未铺满的几何断言失败；调整后 `pager-layout`、`question-pager`、`history-management` 在桌面与手机尺寸共 22 项通过，包括补充记录、手势避让、草稿、有记录时清空/取消和返回来源。
- `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm --filter @solveflow/mobile build:web` 通过。

- `pnpm mobile:apk` 成功；0.1.51 / versionCode 52，17,108,542 字节，签名一致、私密配置扫描、Hermes 与 3 份 DOM 资源检查通过；临时 Kotlin 进程内编译配置已移除。
- APK：`.runtime/artifacts/solveflow-arm64-local-0.1.51.apk`，SHA256 `17ee79800224e320dd4f4403a3c8d19b683e20d42c2d72056bd4132ccb94d07c`。
- `adb install --no-streaming -r` 保留数据覆盖安装，普通外部来源确认后返回 Success；手机读回 0.1.51 / 52。没有卸载、清数据或更改系统安全设置。

## 真机验收

设备 iQOO Neo9 / V2338A。`.runtime/device-051/layout-checks.json` 中 9 项布局/历史断言通过：

- 单题记录为空时，只有空态和拍题入口；没有清空历史或零条记录提示。
- 3 题批次题号等宽铺满，切到第2题仍保持均分。
- 5 题批次首页为1～4题，切到第5题自动进入第二页，第5题独占整行；横向滑回第一页后可点击第4题，再次下一题能回到第二页。
- 原有106张题图和6个批次保留（3/5/22/22/27/27）。截图与原生节点几何信息一致，没有新增、删除、重新作答或改变模型配置。

手机停在已有五题批次的第5题。截图、安装与测试日志只保存在忽略目录 `.runtime/device-051/`；临时手机检查工具已清理。未运行服务端全量测试或付费模型评测，本次没有服务端、模型或存储协议修改；iOS 未做原生构建/真机测试。
