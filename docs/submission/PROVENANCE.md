# 源码来源与开发历史

作品Web V1.2.3的正式开发基线为 `4bf15bf1c71b19f9674703f5816d19fb246d7b3f`。本仓库保留作品相关路径的四条分支、143条真实开发提交，并在submission后追加公开准备记录；当前精确提交以 `git rev-parse HEAD` 为准。

首次从包含其他项目的Private单仓按路径导出，SHA与原仓库不同；本次在独立副本中进一步替换个人邮箱、展示素材并抽离真人测试夹具。作者名、作者/提交者日期、提交说明及父子顺序逐条核验保留，不伪造旧开发者使用新素材的事实；2026-11-17整改覆盖层及范围单列。原始历史已完整Private备份，正式开发仓库未变。

[commit-map.txt](commit-map.txt) 将正式仓库原始提交映射到当前公开历史；[publication-commit-map.txt](publication-commit-map.txt) 将整改前比赛143提交映射到当前公开历史。路径导出不等同于正式私有单仓的所有应用历史，旧签名不被当作过滤后签名有效。

[source-files.json](source-files.json) 固定原产品基线文件mode/blob；[publication-files.json](publication-files.json) 精确列出18展示素材、1测试文件与1夹具移除的旧/新blob和SHA-256。`python scripts/submission/verify_baseline.py` 同时验证未改原文件和这些明确覆盖项，不能用白名单忽略任意产品变化。模型、Agent、三游戏与训练运行源码未改。

公开仓库：https://github.com/FormPilot-Team/FormPilot-ChuanzhiCup-2026-Public。运行步骤见[RUNNING.md](RUNNING.md)，素材来源见[ASSETS_AND_LICENSES.md](ASSETS_AND_LICENSES.md)。
