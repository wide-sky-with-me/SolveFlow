# H5 相机拍摄流程

2026-09-15。用户反馈电脑浏览器“拍一张”没有打开摄像头，并明确产品面向手机 H5。

## 原因与改动

旧按钮只点击 `<input type="file" capture="environment">`。`capture` 是交给浏览器/操作系统的拍摄提示，不等于网页相机预览；桌面通常仍显示文件选择框。依据：[MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)。修复前新增相机浏览器测试，在找不到“拍摄题目”预览窗口处实际失败。

- `apps/web/components/camera-capture.tsx`：用户点击后调用 `getUserMedia`；优先后置摄像头，只请求视频；`muted`、`playsInline` 页面内预览。可拍摄、检查照片、重拍；确认后进入既有裁切流程。发现多个视频设备后可请求切换前后摄像头，实际选择取决于浏览器和设备支持。
- `apps/web/lib/camera.ts`：30秒授权等待限时、取消及迟到流清理；画面就绪后以原始视频尺寸读取完整一帧，长边最多2560px，输出JPEG且不超过10MB。预览显示完整画幅，拍摄不偷偷裁掉边缘。
- 预览无可播放画面另有15秒限时。关闭、Escape、拍摄完成、切后台、页面离开、切换摄像头以及组件卸载时停止流；取消后才获授权的流也会停止。照片Blob URL在重拍/关闭后释放。
- 拒绝权限、无设备、设备占用、超时、非安全地址及不支持API分别给出可操作提示；保留“从相册选择”和“使用系统相机”。后者仍由原生capture输入负责，不承诺所有浏览器都能调起原生相机。
- `apps/web/components/workspace.tsx`：接入拍照→确认→裁切；确认照片本身不发起上传或解题，仍需用户点击开始解题。
- `apps/web/app/globals.css`：相机竖屏/窄屏适配；短横屏将拍摄按钮放在画面旁边，减少滚动。
- `apps/web/next.config.ts`：沿用 `Permissions-Policy: camera=(self), microphone=()`；CSP明确允许本源及Blob媒体，未授权外部视频来源。

没有新依赖、后端接口、数据库迁移或模型行为改动。

## 访问条件

网页实时相机要求安全上下文和用户授权，参见[MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。电脑可用 `http://127.0.0.1:3100` 或 localhost 测试；手机访问开发机的普通局域网HTTP IP不满足要求，需使用手机信任的HTTPS地址。localhost只代表访问设备自身。

拒绝后需在浏览器站点设置中允许相机，再点重试；还需操作系统授权和可用设备。内嵌App浏览器受宿主权限/实现限制，可转系统浏览器或用原生相机/相册。当前服务仍只绑定本机，未在本次改动中部署公网、修改监听地址或签发证书。

## 实际验证

- `pnpm --filter @solveflow/web typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`：通过。
- `pnpm build`：全仓生产构建和产物边界检查通过。最后修正横屏布局后，`pnpm --filter @solveflow/web build`再次通过。
- `pnpm exec vitest run apps/web/lib`：11/11通过，覆盖既有公式、裁切与分题逻辑。
- `pnpm test:e2e`：54/54通过（44.7秒），包含新增桌面/手机各10项相机场景及既有34项浏览器回归。

相机测试使用Chromium生成的虚拟视频设备，实际调用浏览器媒体API，校验无音轨、后置优先请求、拍摄像素不是空白、确认后可裁切、照片确认前没有上传、拍摄/关闭/离开/迟到授权的轨道停止、重拍、超时、原生相机备用入口及各失败提示。未使用开发机或用户的物理摄像头，未调用付费模型。非安全地址与设备错误使用明确的浏览器测试替身，真实硬件拍摄体验仍须设备实测。

截图保存在忽略目录 `.runtime/screenshots/camera-*.png`，画面中的绿色图案是Chromium虚拟摄像头生成内容。首帧截图需等待浏览器合成完成；已核对可见预览和实际拍摄像素。

最后视觉复查发现横屏视频实际高度412.5px超过270px取景框，新增断言实际复现后，改用受取景框约束的绝对定位和contain缩放修复。最终横屏布局追加画面不超出取景框、按钮位于844×390视口内的检查，`pnpm exec playwright test tests/e2e/camera.spec.ts` 20/20通过（12.0秒）；该轮仅相机测试，在已恢复的live服务上验证本地拍摄，不创建上传或解题任务。服务已恢复到 `http://127.0.0.1:3100`，进程和日志见 `.runtime/app-session.json`。

## 待设备验收

真实iOS Safari、Android Chrome及微信内置浏览器的权限交互、前后摄像头、清晰度和方向仍需在HTTPS环境实测；本地桌面/移动模拟通过不等于所有H5宿主均已验收。
