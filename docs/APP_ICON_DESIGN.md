# SolveFlow 图标设计记录

2026-09-16，按用户反馈重做 0.1.5 图标：去掉旧版 S 字母和取景框，采用书页轮廓与负形勾的组合。蓝色方形背景、白色主体，留出系统图标裁切空间；开屏只保留小图标、名称和细加载线。

使用内置 `image_gen.imagegen`，没有使用 CLI/API 备用路径。最终项目资产：`apps/mobile/assets/app-icon.png`；Android adaptive icon、Web favicon 和开屏共用该资产，由 Expo 生成平台尺寸。生成原图保留。

最终提示词：

```text
Use case: logo-brand. Asset type: final production square mobile app icon for a camera homework learning app, not a mockup. Primary request: a sophisticated minimalist icon with a distinctive folded open-page motif, two interlocking softly curved paper leaves forming a subtle checkmark in the negative space, suggesting understanding unfolding. No letters or text. One strong compact silhouette, optically balanced, generous negative space, meticulously rounded edges. Pure warm-white mark on rich cobalt blue full-bleed square background with an extremely subtle blue tonal depth. Restrained contemporary graphic design, flat vector-like finish, no 3D plastic, no thick outline, no scan corners, no camera glyph, no sparkles, no busy decorative elements, no frame, no outer rounded-square container or white margins. Mark fits central 60% so Android adaptive circular masking remains safe. Deliver one 1024x1024 icon image, not a presentation sheet.
```
