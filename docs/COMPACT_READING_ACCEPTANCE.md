# 0.1.7 阅读、空页面与导航反馈（2026-09-16）

> 底栏缩放反馈已在0.1.8改为分层图标过渡，见[最新动效验收](NAVIGATION_MOTION_ACCEPTANCE.md)。本页保留0.1.7历史记录。

## 本次调整

- 收藏页移除“返回我的”按钮；点击底栏“我的”返回个人页，Android硬件返回仍可返回个人页。
- 当前题目移除删除入口；历史和收藏列表继续通过左滑/更多操作移除，保留确认弹窗。
- “查看原图”移至题目标题右侧，直接打开既有原图查看器，支持放大和关闭。解题中、失败及取消状态仍有原图入口；DOM故障的文字降级页也保留入口。
- 详细步骤默认折叠，按题独立展开/收起；教学图示随步骤展开，原题插图、答案、知识点和未验证警告始终在折叠区外。展开不请求模型，不修改已保存的结果。DOM高度通过既有ResizeObserver同步原生页面。
- 当前题目、历史和收藏的空页面增加纸张主题插画、柔和背景及相机/相册/历史入口。图形用原生View绘制，离线、无新增图片或依赖。
- 底栏按下缩至88%，松手弹回；选中背景约180ms淡入。沿用RN Animated原生驱动，保留44dp触控区及紧凑栏高。尊重系统减少动态效果，组件卸载清理监听及动画。

## 实现与验证

主要文件：`apps/mobile/src/components/empty-state.tsx`、`app-navigation.tsx`、`app.tsx`、`question-thread.tsx`、`answer-panel.tsx`、`dom/problem-statement.tsx`、`answer-document.tsx`、`answer-content.tsx`及`answer.css`。

- `pnpm lint`、`pnpm typecheck`、移动端独立typecheck、Web导出和Android原生构建通过。
- 完整桌面/移动Playwright64项通过，含默认折叠/展开、按题追问、原图查看器、空页操作、导航按压缩放/复原和减少动态效果。最终补充失败/取消状态原图入口后重建Web，14项状态回归再次通过。
- `node scripts/test-android-document.mjs`通过：实际APK的本地DOM启动、原图按钮跨桥调用、展开步骤后原生测量高度增大、公式/图示/知识点、历史收藏动作与离线注入防护。
- 手机第一次安装被系统取消，第二次成功；读回0.1.7/versionCode8。iQOO Neo9/Android16真机验证默认折叠、展开/收起、题目旁原图打开关闭、移除当前删除入口、收藏空页背景、无返回按钮及底栏返回个人页。真实记录与设置保留，没有发起模型调用。
- 新APK43,229,600字节，SHA-256 `da937b4f4f1db2ab6fd2d317f2e2d8c77a03e52fb6a18081c4faad9097fccecd`，签名一致、私有配置扫描通过。
- 原云盘文件更新为 `solveflow-0.1.7-arm64.apk` 并回读名称/大小：[下载APK](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。

本轮仅UI与其桥接回调变更，没有重跑Agent单元/数据库集成测试；上一轮594项单元测试记录不计为本轮新执行。

不改变模型提示词、Agent循环、存储协议或供应商配置；本轮不新增付费解题，iOS原生构建仍暂停。
