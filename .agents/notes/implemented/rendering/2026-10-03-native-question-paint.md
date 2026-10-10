# 切题等待原生绘制且保持页面层级稳定

日期：2026-10-03。状态：implemented。依据同日 0.1.69 真机记录回溯整理。

## 背景

浏览器就绪后，Android 快速切题仍出现白帧。测试过程和中间失败包见 [真机记录](../../../../docs/DEVICE_ACCEPTANCE_0_1_69.md)。

## 决定

[绘制桥](../../../../apps/mobile/src/components/document-paint.ts) 等待 Android 文档绘制确认；[分页器](../../../../apps/mobile/src/components/question-pager.tsx) 保留旧内容并保持 Android 页面层级稳定。只预绘制当前/请求目标，有时间和面积限制，卸载取消。

## 放弃的方案

仅依赖 React effect 或两次 RN 帧无法证明 WebView 已合成；仅补浏览器双帧的中间包仍命中白帧。额外 GPU 纹理缓存与 elevation 候选也未通过真机逐帧检查，已撤回；不是所有“开硬件加速”建议都适用于此路径。

## 后果与限制

DOM 完成、原生布局和可见像素是不同证据。不能让页面数量随题目数增长，也不能把无白帧的少量样本宣称为全部设备流畅。仍保留失败回退和慢帧待办。

## 验证

上述记录包含候选失败、最终包、逐帧和帧耗时观察。对应单元见 [绘制测试](../../../../apps/mobile/src/components/document-paint.test.ts)。本次管理改造未连接手机复测。
