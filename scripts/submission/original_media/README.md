# 原创展示素材生成

`generate_original_media.py` 在2026-11-17为公开分发整改编写，只读取相邻兼容清单中的文件名、尺寸和格式；不读取原图片、视频或姿态数据。生成的18份图像/循环视频已作为静态文件提交，安装、运行和构建不需要Python图形依赖。

需要重新生成时，在Windows安装Pillow、NumPy、imageio-ffmpeg后运行该脚本；它使用系统微软雅黑进行栅格化，不分发字体，输出到脚本旁的 `files/`，不会自动覆盖产品素材。原文件与替代文件的Git blob和SHA-256见 `docs/submission/original-media-manifest.json`。生成环境差异可能影响编码字节，请对新输出重新验收和记录哈希，不冒充既有校验值。
