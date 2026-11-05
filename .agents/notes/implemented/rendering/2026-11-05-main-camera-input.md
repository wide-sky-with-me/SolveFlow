# main保留网页相机与HEIC输入修复

日期：2026-11-05。状态：implemented。范围：main的完整版网页图片输入，不合入中心考试或公网精简应用。

## 背景

原main临时工作树已消失，但保留的Mac发布清单记录了尚未提交的相机修复。用户要求将main与功能分支分别提交远程；不能把已部署修复遗漏，也不能把中心考试整体合入main。

## 决定

依据本机保留的发布清单核对文件哈希，在独立main工作树恢复同源的[图片转换](../../../../packages/image-input/src/browser.ts)、[格式与高像素预览](../../../../packages/image-input/src/formats.ts)、[Web选择器](../../../../apps/mobile/src/platform.web.ts)及[相机](../../../../apps/mobile/src/components/camera-preview.web.tsx)。构建入口、锁文件、源码边界及测试分类按main现有包图适配。

继续采用本地可终止Worker和固定libheif-js，不增加远程转换服务。依赖许可LGPL-3.0，codec按需独立加载，随[生成器](../../../../scripts/prepare-image-codec.mjs)分发许可及源码获取说明；不进入普通图片的首屏JS。高像素图先生成等比预览，再沿原裁切约束处理，不能直接提高持久化图片上限。

## 放弃的方案

直接合入功能分支会带入整套中心考试和公网应用，不符合main边界。仅复制accept或相机约束不能解决HEIC解码、大图进入编辑器和资产遗漏。旧临时目录已不存在，不能宣称直接提交了原工作树；新main适配与旧Mac产物逐字节一致未验证。

## 后果与限制

新增受锁文件管理的图片依赖和约2MB的独立codec，解压依赖约9MB。系统权限、对焦、低内存和iCloud原图仍需iPhone真机；本轮不修改原生后台策略，不更新远程Mac或公网服务。长期语义归[图片输入](../../../../docs/subsystems/image-input.md)。

## 验证

执行命令、首次失败、复测和未验范围归[本次报告](../../../../docs/postmortem/2026-11-05-main-camera-input.md)。使用生成色块图片及假相机，无真实题图或模型费用；不以旧Mac验收代替当前main检查。
