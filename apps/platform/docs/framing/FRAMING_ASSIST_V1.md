# Framing Assist v1

## 目标与边界

Framing Assist v1 复用现有 Pose landmarks，为不同动作提供入镜要求、提前出框预警和具体站位提示。它是 setup/guidance 状态，不参与 Scoring v2.1、routine matcher、动作完成或 detector 推理。

**Framing Assist 无法恢复摄像头未捕获的身体区域。** 本版不自动平移、缩放或裁切 Camera feed，也不调用 PTZ、光学变焦或 camera zoom constraints。预览与识别继续使用同一个原始视野；UI 只叠加提示和 safe zone。

## Profiles

| Profile | 必需区域 | 当前用途 |
| --- | --- | --- |
| `UPPER_BODY` | 头、肩、肘、腕、躯干 | 预留给真正只关心上肢的动作 |
| `UPPER_BODY_WITH_HIPS` | 上述区域及髋部 | 肩部环绕、双臂上举、侧平举 |
| `FULL_BODY` | 头、肩、腕、髋、膝、踝 | 侧步开合、徒手深蹲、交替提膝及四套跟练 |

上肢 profile 不因膝盖或脚踝不可见而失败。双臂上举与侧平举仍要求手腕可见。

## 判断规则

- 只读取已经过 PoseFilter 的 landmarks；每帧复杂度为 O(landmarks)，不运行第二次 detector。
- landmark 的 visibility 和 presence 均需达到 `0.55`。
- bbox 使用当前 profile 的稳定关键点，并在点数足够时去掉横纵坐标各一个极端值，再用 `alpha=0.24` 的 EMA 平滑。
- safe zone 的归一化预警边距为 `0.045`，明确出框判断边距为 `0.012`。这些是 FormPilot 工程校准值，不是人体工程学标准。
- 距离仅为视觉启发式：结合 bbox height、shoulder width 和 torso length，输出 `TOO_CLOSE / GOOD / TOO_FAR`，不声称测量了真实米数。
- FULL_BODY 宁可人物略小并提示“可以靠近一些”，也不以放大预览换取裁切风险。

提示优先级为：必需区域缺失、太近、边缘预警、太远、正常。同一时刻只显示一条主提示，可附一条短说明。

## 稳定与空间不足

异常需持续 `350ms` 才显示，恢复需稳定 `600ms` 才清除。bbox 独立平滑，避免提示框随单帧抖动。

FULL_BODY 的膝/脚持续无法稳定识别 `6000ms` 后，提示升级为“当前镜头范围可能不足以完整拍到全身”，并建议将摄像头放高或后移、调整设备角度。它不会无限重复“请后退”，也不会假装扩大了 FOV。

## PREPARING 与 ACTIVE

PREPARING/COUNTDOWN 显示当前 profile 要求、safe zone、主提示，并保持既有手势和 countdown gate。ACTIVE 隐藏骨架的既有规则不变，safe zone 可继续以较弱方式显示；本版不移动预览，只更新低干扰文本提示。

## 已知限制与后续方向

- 单目 2D landmarks 无法确定真实距离，也无法严格区分遮挡、低可见度和物理出框，因此低 visibility 文案使用“暂未稳定识别”。
- 极端侧身、宽松衣物和弱光可能使 bbox 或 visibility 暂时不稳定。
- 后续可单独研究摄像头真实 FOV 元数据、多机位或用户手动构图选项；任何预览级 centering/zoom 必须证明不影响识别输入且不制造虚假视野。
