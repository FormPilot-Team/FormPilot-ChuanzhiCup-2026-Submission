# 素材与许可

团队原创源码未声明开放许可证。第三方组件和素材的版权归各自权利人，需按相应许可及授权范围使用。

| 资源 | 源码中的处理 | 使用边界 |
| --- | --- | --- |
| 四套功法标准 MP4、四张海报、六个热身 MP4 | 不纳入 Git，14 个文件的路径、大小与 SHA-256 见 [platform.json](../../assets-manifest/platform.json) | 来源和评审分发权限尚待权利确认；克隆源码不能完整复现视频 |
| 四套功法 `.pose.json` | 保留，供识别、对齐、评分与研究使用 | 从上述参考视频提取，衍生数据许可仍需复核 |
| `public/assets/coach` 教练形象 | 保留 | 真人画面衍生，肖像与素材权利仍需复核 |
| `public/web-v1` 页面素材、光球 WebM/PNG | 保留，[素材来源](../../apps/platform/public/web-v1/ASSET_SOURCES.md)可追溯 | 负责人提供的生成素材获授权用于 FormPilot 团队演示与比赛作品；未声明开放许可证，不能扩大解释为任意再分发许可 |
| MediaPipe 模型与 WASM | 保留，游戏 WASM 在构建时从锁定依赖复制 | Apache-2.0；[许可全文与来源](../../third-party/mediapipe/README.md)，保留上游版权和通知 |
| Qwen / Ollama | 不随源码分发模型或运行时 | Qwen Apache-2.0；安装者分别核对模型和运行时许可，版本与 digest 见[运行说明](RUNNING.md) |
| React、Vite、Phaser 等 | 按各应用锁文件安装 | 遵循各依赖 LICENSE/NOTICE；封包工具从实际安装的依赖收集许可 |
| `react-remove-scroll-bar@2.3.8` | 补附固定上游 MIT 许可 | npm 包缺单独 LICENSE；精确来源与版本限制见[许可来源](../../third-party/react-remove-scroll-bar/README.md) |

取得有权使用且匹配清单的媒体后，从仓库根目录恢复：

```powershell
python scripts/submission/restore_media.py --source-package '<已授权的解压包根目录>'
python scripts/submission/restore_media.py --check
```

恢复工具只按明确清单和哈希复制，不联网，也不赋予许可。缺少媒体时界面提示无法播放，其他功能可运行。替换参考视频时需同步重做匹配姿态轨迹、记录校验值并验证时间对齐。

Windows 封包保留已安装依赖的许可全文、通知及清单。仍有未随 npm 包附全文的工具链条目，不能据此宣称所有第三方许可均已关闭。Private 托管或离线交付不改变以上权利边界。
