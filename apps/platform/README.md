# FormPilot Web V1.2.1 平台

本目录是传智杯独立提交版的完整平台源码。安装、比赛模式、游戏服务、Qwen、媒体恢复和测试均以[仓库根 README](../../README.md)为准。

- `pnpm install --frozen-lockfile` 安装本目录锁定依赖。
- `pnpm competition:build` 构建 M1/M2 ACTIVE 比赛版。
- `pnpm competition:preview` 在本机 4175 预览；游戏服务需在 5181 独立运行。
- `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm test:e2e` 为本目录检查入口。
- 视频需有权使用的本地素材；没有模型时自由问答正常降级。

旧技术文档保留其原始研究结论与限制，当前版本声明以[一致性核对](../../docs/submission/VERSION_CONSISTENCY.md)为准。
