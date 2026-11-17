# 素材、数据与许可

团队原创源码尚未声明开放源码许可证；仓库公开可见不等于授予任意再分发许可。第三方组件和素材遵循各自权利与条款。

| 资源 | 公开源码处理 | 来源与决定 |
| --- | --- | --- |
| 四标准MP4、四海报、六热身MP4 | 14份精确原媒体不在当前树或任何四分支历史 | 清单见assets-manifest/platform.json；自行恢复须有权使用，克隆不会下载原视频 |
| 四套标准参考pose及既有衍生研究工件 | 保留原始字节，不改评分、M1/M2和冻结实验 | 源自历史参考示范。负责人2026-11-17明确决定现阶段继续使用并随参赛源码保留，后续换为数字人；该决定不冒称已取得第三方视频许可证或授权公开原MP4 |
| 蓝色运动服Family A教练、动作示范与五个历史头像/欢迎版本，及六姿态锚点 | 保留 | 开发记录已有内置生成和位图来源；负责人在查看完整图组后确认整组为团队AI生成、允许公开。锚点为这些生成图片的真实MediaPipe检测，不是患者记录；纠正此前笼统“真人画面衍生”描述 |
| public/web-v1全部18份展示媒体 | 全历史替换 | 2026-11-17新编原创几何绘图/数学粒子循环，无原像素或参考pose输入；原图和旧光球不再存在于公开可达对象。精确映射见original-media-manifest.json |
| 真人比赛片段派生手势测试夹具 | 全历史抽离 | 原始真实Lite/Full验收证据只在Private备份保留；公开测试明确使用程序合成骨架，不冒充真实模型对比 |
| MediaPipe模型与WASM | 保留 | Apache-2.0，全文与来源见third-party/mediapipe，保留上游版权与通知 |
| Qwen/Ollama | 不分发权重与运行时 | Qwen Apache-2.0；版本/digest与本地配置见RUNNING.md |
| React/Vite/Phaser等依赖 | 锁定安装 | 遵循各依赖LICENSE/NOTICE；react-remove-scroll-bar@2.3.8补附MIT许可和精确上游出处 |

取得有权使用且匹配清单的本地媒体后，可从仓库根执行 `python scripts/submission/restore_media.py --source-package '<本地解压包根目录>'` 和 `--check`。工具仅按哈希复制，不联网、不赋予许可；缺视频不影响构建或非视频功能。

详细整改日期、新旧Git/blob映射和方法见[PUBLICATION_REMEDIATION.md](PUBLICATION_REMEDIATION.md)。本轮未改既有Windows测试包、视频或PDF，也不据仓库公开宣称这些交付物获得新的素材许可。
