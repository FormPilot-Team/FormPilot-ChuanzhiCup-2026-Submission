# AI 电子教练 Demo — Human Smoke UX Fix

工程目录固定为 `E:\电子教练\demo_dev`。产品文档、UI概念图和参考视频保留在父目录，不属于构建产物。

Phase 5 已形成完整六步课程：肩部环绕、双臂上举、侧平举、侧步开合、徒手深蹲、交替提膝。六者复用同一 Camera → Pose → Filter → Exercise Plugin → Feedback → Session 管线；课程顺序、目标类型、准备、倒计时、暂停、过渡与完成状态由独立课程定义和控制器管理。

Phase 6A 在不重做人物和三栏布局的前提下，将左侧 Coach Card 固定为 `PREPARING / ACTIVE / CORRECTING / POSITIVE / TRANSITION` 五态。它只消费 `CoachCardViewModel`：纠错来自 FeedbackPolicy 已确认的 primary，恢复反馈使用约 1200ms 薄荷绿 positive，局部 Halo 从现有 `*.pose.json` normalized anchor 推导。Speech cooldown 不控制 Coach UI。

Phase 6B 新增基于已保存 Session 的 Training Report。完成课程后通过“查看训练报告”进入 `/report/:sessionId`；页面刷新从本地 Repository 恢复。报告区分 complete/incomplete，以显式五维 mapping 汇总能力，只聚合 confirmed correction feedback，并生成最多三条纯规则建议。Shoulder Rotation 继续作为 guidance，不显示或参与 numeric overall score。

Phase 6C 补齐正式 Home → Training → Report → Home 闭环，完善 500ms No Pose 去抖、骨架清除、Camera/Model 中文异常与重试，并清理正式 UI 的开发态假入口。空的 stale active Session 会在新记录保存时清理；用户主动结束形成的 incomplete 报告永久按合法记录保留。

Human Smoke UX Fix 为前三个上肢动作启用“上半身 + 髋部”取景，后三个动作保持全身取景；增加事件驱动中文语音与训练区静音开关；Coach 为双臂上举、徒手深蹲、交替提膝播放低帧率关键姿态循环，其余动作继续使用已验证静态图。Camera preview 使用 contain，关键训练提示针对远距离阅读放大。验证与真人复核项见 `docs/human-smoke-ux-fix-validation.md`。

## 运行

```powershell
cd E:\电子教练\demo_dev
pnpm install
pnpm dev
```

- 正式首页：`http://localhost:5173/`
- 正式六步训练：`http://localhost:5173/train`
- 训练报告：`http://localhost:5173/report/:sessionId`（需存在对应本地 Session）

开发与验收入口（不会在正式无参数页面显示）：

- 兼容四动作演示：`http://localhost:5173/?demo=1`（保留 Phase 1–4 验收入口）
- 六步课程演示：`http://localhost:5173/?demo=1&course=1`
- 校准模式：追加 `&debug=1`
- 直接检查侧步开合（内部 ID `step_jack`）：`http://localhost:5173/?demo=1&exercise=step_jack&debug=1`
- 直接检查深蹲：`http://localhost:5173/?demo=1&exercise=squat&debug=1`
- 直接检查交替提膝：`http://localhost:5173/?demo=1&exercise=knee_raise&debug=1`
- 直接检查肩部环绕：`http://localhost:5173/?demo=1&exercise=shoulder_rotation&debug=1`
- 直接检查双臂上举：`http://localhost:5173/?demo=1&exercise=overhead_raise&debug=1`
- 快速 E2E 状态机夹具：`http://localhost:5173/?demo=1&fast=1&fixture=synthetic`（仅开发测试使用）

## 验证

```powershell
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:e2e
```

永久验收截图位于 `screenshots/phase1/` 至 `screenshots/phase6c/`。普通 E2E 回归截图写入 `test-results/regression-screenshots/`，不会覆盖历史证据。Phase 6C 验收见 `docs/phase6c-validation.md`；Phase 6B 报告规格与 Phase 6A Coach Card 合同继续见 `docs/training-report-spec.md`、`docs/report-data-contract.md`、`docs/coach-card-state-spec.md`。
