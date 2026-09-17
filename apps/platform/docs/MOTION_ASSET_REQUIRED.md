# Motion Asset Required

以下三个动作当前继续使用已验证的静态 Coach 资产。正式 Motion 不得引用其他动作帧、未经审核的新人物或不合理镜像。

## Shoulder Rotation

- 需要 5–8 个循环关键姿态。
- 至少表达前下、侧平、头顶、后侧回落与回到起点。
- 所有帧必须为同一人物、同一画布、同一视角，并能明确看出真实双臂绕环。
- 现有 `shoulder-rotation-demo-*` 与双臂上举资源重复，只是占位，不得用于正式 Coach Motion。

## Lateral Raise

- 最小序列：`START → 45° → TOP → 45° → START`。
- 与 `coach-lateral-raise.png` 保持同一人物、服装、道具、画布和相机视角。
- TOP 可复用当前 canonical 图；新增 START 与 45° 帧需重新做人物一致性和动作真实性目检。

## Step Jack

- 最小序列：`CENTER → OPEN_LEFT → CENTER → OPEN_RIGHT → CENTER`。
- 左右打开都必须是独立、合理的真实姿态；不得仅用 CSS 镜像现有单侧图。
- 与 `coach-step-jack.png` 保持同一人物、画布和视角，双手与双脚在每帧完整可见。

## 接入门

新素材只有在尺寸/构图一致、动作真实性、人物一致性、完整入镜和 canonical/anchor 安全均通过后，才可加入 `motionFrames`。素材不足时静态 fallback 是正式行为，UI 不显示错误或“动画不可用”。
