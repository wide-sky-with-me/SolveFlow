# 0.1.8 底栏图标过渡（2026-09-16）

## 设计与实现

按用户反馈替换0.1.7的整体缩放弹跳与外置蓝色高亮块。参考[Apple SF Symbols](https://developer.apple.com/sf-symbols/)的关联图标过渡和[Material Navigation](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md)的选中状态表达；使用项目自己的RN图形实现，不引入平台专属图标资源或新增依赖。

- 题目：同一28dp画布上的线框纸张与填充纸张交叉淡入淡出；背页轻微展开，两行文字依次显现。
- 我的：轮廓头像过渡为双色填充头像，头部与肩部协同显现。
- 拍照：按下镜头转动并收合，松开复原；按钮底色同步加深，触发相机不等待动画结束。
- 选中颜色沿图标自身轮廓呈现，移除外置高亮底块；文字仅做颜色层过渡，不改变位置或字重。侧栏按压使用轻微透明度反馈，不再缩放整个按钮。
- 选中过渡280ms，非弹簧缓动；使用RN Animated原生驱动的透明度与变换。新输入中断旧动画并从当前进度继续，卸载停止动画、移除监听。
- 保留三个入口、至少44dp触控高度、约53dp底栏高度。尊重系统减少动态效果，启用时直接显示最终图标；相机禁用时无动作。

实现：`apps/mobile/src/components/app-navigation.tsx`；版本：`apps/mobile/app.config.ts`；回归：`tests/mobile-e2e/navigation.spec.ts`。

## 验证

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`通过。
- `pnpm --filter @solveflow/mobile build:web`通过。
- `node /tmp/solveflow-web-regression.mjs tests/mobile-e2e/navigation.spec.ts`：桌面/移动共12项通过（34.1秒），临时本机服务退出后关闭。
- 覆盖可观测的图标中间过渡帧、连续切换的最终状态、图标居中、触控区、快门按压/松开、减少动态效果，以及原有的相机取消回原页、草稿保留、解题中切页与禁用相机。
- 已人工查看390px宽的选中纸张、选中头像、快门按压截图，截图仅存本机忽略目录。
- `JAVA_HOME=/home/yhr/.sdkman/candidates/java/current pnpm mobile:apk`通过（1分48秒）；`node scripts/test-android-document.mjs`通过，验证实际APK内答案/历史DOM资源、桥接、公式、图像、窄屏布局、离线及注入防护。
- APK版本0.1.8/versionCode9，43,233,240字节；与旧版签名一致，包内无服务器环境文件或已配置秘密值。SHA-256：`a7c88417c319524dd3bd775335fabd942c5d539325efcfaf88fa3eb42bd5ed2e`。
- 产物：`.runtime/artifacts/solveflow-arm64-local-0.1.8.apk`。原云盘文件已更新为`solveflow-0.1.8-arm64.apk`，回读名称与大小一致：[下载APK](https://drive.google.com/file/d/1CUh5WOK_MBiUDdFfCcJjBgmpl279YcMZ/view?usp=drivesdk)。
- 用户解锁后，同签名覆盖安装成功，手机读回0.1.8/versionCode9。iQOO Neo9/Android16真机验证：当前题目和历史记录保留、题目/我的连续切换、相机打开与关闭后返回原页均通过。检查实际录屏中的过渡帧，轮廓/填充图标自然衔接，无外置高亮块或位置跳动。未改动模型设置、未提交模型请求，结束时停留在当前题目页。
- 真机脚本首次误点与底栏同名的题干标题，改为精确匹配底栏可访问标签后通过；这是验收脚本定位修正，未改动应用实现。本地记录见`.runtime/device-navigation-motion/result.json`与`/tmp/solveflow-v18-device.log`。

本轮只修改底栏，未更改Agent、存储、提示词或模型配置；没有新增模型调用。未重跑Agent/数据库测试，iOS构建继续暂停。
