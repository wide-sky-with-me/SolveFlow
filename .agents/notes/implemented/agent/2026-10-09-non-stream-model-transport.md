# 备用与校验的非流式传输

日期：2026-10-09。状态：implemented。范围：设备模型传输与Pi兼容适配。

## 背景

用户要求检查备用模型输出，并优先使用非流式。当前锁定Pi SDK按流式事件解析两种OpenAI协议，直接改请求参数会让完整JSON无法被SDK消费。

## 决定

[适配器](../../../../packages/agent/src/pi/non-stream-response.ts)将已受限的完整JSON转换为同一SDK已有事件解析入口。[设备传输](../../../../packages/agent/src/pi/mobile.ts)只在实际HTTP边界发送stream=false，保留Pi拥有的工具/模型循环、调用计数和取消。备用、核验默认非流式，主解题默认流式；显式profile.streaming优先，手工设置及.env可逐组覆盖。

Chat保留工具调用与usage；Responses保留完整output、加密推理签名及真实终态。incomplete/failed不改成completed，queued/in_progress不能作为最终答案。服务忽略请求仍返回SSE时沿既有解析器处理，诊断同时记录请求方式与实际JSON/SSE。

默认[备用/核验预设](../../../../apps/mobile/src/components/settings.tsx)改为gpt-6-sol、Responses、low、非流式；当前localhost的.env两组同配置，既有手工配置不迁移覆盖。三道已授权实图完整流程约66/32/33秒，选项均与核对结果一致，只有两题PASS；不据此保证教学解释或全科正确。供应商同路由的6.1高强度非流式首轮超180秒、5.6中/低强度第16题各300秒超时，比较存在模型与强度同时变化，不能归因于模型固有速度。

## 放弃的方案

直接onPayload修改stream会让SDK尝试迭代JSON；另建模型循环会破坏Pi边界。依赖浏览器Response构造流在RN旧polyfill不可用，因此保留Expo响应并仅替换已验证的body/headers。

## 后果与限制

非流式仍受1MiB JSON、有限阶段与取消约束，内存转换有界；不保存响应正文、题图或内部推理。完整结果到达前没有增量，非流式不保证推理或供应商排队更快。模型选择按本次有限实测调整，不能据少量样本声称全科准确率。

## 验证

[验收](../../../../docs/postmortem/2026-10-09-batch-retry-and-timeouts.md)记录两种协议工具续接、校验、签名、异常终态、大小限制与实际调用；原生真机尚未执行。
