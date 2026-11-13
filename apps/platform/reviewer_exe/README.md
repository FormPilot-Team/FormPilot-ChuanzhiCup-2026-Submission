# 原版本图标回归测试依赖

此处仅保留 `tests/app-icon.test.ts` 实际读取的四个原始文件：`build/icon.svg`、`build/icon.ico`、`package.json`、`src/main.cjs`，逐字节取自参赛基线。

它们用于证明 Web 标识与原 Windows 图标来源一致，**不是完整 Electron 项目，不可从本目录安装/启动/打包**。比赛运行方式是仓库根 README 中的 Web 平台和独立游戏。原 Electron 其余源码、锁文件、依赖与安装包不属于本次提交范围。
