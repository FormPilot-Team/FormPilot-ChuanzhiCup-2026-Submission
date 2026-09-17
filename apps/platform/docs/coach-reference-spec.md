# Coach Reference Pose 规格

## 1. 四层概念

### Canonical Target

教学动作的理想几何基准，用于制作教练资产、设计关键帧和比较动作方向。它不是用户必须逐帧命中的判定区间。

### User Acceptance Threshold

真实用户训练时的可接受范围。它考虑人体差异、摄像头视角、衣着和关键点抖动，因此必须比Canonical Target宽。运行时Rule Engine使用这一层。

### Coach Asset Acceptance

AI Coach图片发布前的视觉门槛。它通常比用户判定严格，用来保证教练展示的是标准动作。素材必须由真实Pose Landmarker检测后才能验收，不允许用CSS拉伸或旋转整张图片伪装修正。

### Detected Pose

Pose Landmarker从某张正式图片实际返回的关键点与置信度。它是观测结果，不是Canonical，也不能手工改成理想值。Debug中实线是Detected Pose，虚线才是Canonical Target。

## 2. Canonical Pose

| 动作/姿势 | Canonical Target |
|---|---|
| Lateral Raise START | shoulder 10°；elbow 170°；symmetry 0°；torsoLean 0° |
| Lateral Raise TOP | shoulder 90°；elbow 170°；symmetry 0°；torsoLean 0° |
| Step Jack CENTER | arm 10°；openRatio 1.0；torsoLean 0° |
| Step Jack LEFT_OPEN | arm 145°；arm difference 0°；openRatio 1.8；torsoLean 0° |
| Step Jack RIGHT_OPEN | 与LEFT_OPEN使用相同指标，并通过左右关键点交换与`x = 1 - x`严格镜像 |
| Squat STANDING | hipDrop 0；hipKneeSeparation 1.0；kneeSpreadRatio 1.0；kneeHeightDiff 0；torsoLean 0° |
| Squat BOTTOM | hipDrop 0.35（教学目标）；hipKneeSeparation 0；kneeWidth/shoulderWidth 1.40；ankleWidth/shoulderWidth 1.25；knee-ankle水平偏移 0.08；kneeHeightDiff 0；torsoLean 0° |
| Knee Raise CENTER | 双膝自然低于髋；torsoLean 0°；身体居中 |
| Knee Raise LEFT_TOP | leftKneeHeight 0；支撑腿稳定；torsoLean 0° |
| Knee Raise RIGHT_TOP | LEFT_TOP关键点交换并执行 `x=1-x` 的确定性镜像 |

源数据位于`src/features/referencePose/definitions.ts`。LEFT_OPEN与RIGHT_OPEN使用同一Canonical指标数组；右侧锚点可由`mirrorReferencePose()`确定性生成。

## 3. User Acceptance

### Lateral Raise TOP

- shoulder：80°–100°
- elbow：>=150°
- symmetry：<=15°
- torsoLean：<=10°

### Step Jack OPEN

- arm：>=130°
- arm difference：<=20°
- openRatio：>=1.60
- torsoLean：<=12°

### Squat BOTTOM

- hipDrop：>=0.30
- kneeSpreadRatio：>=0.75
- kneeHeightDiff：<=0.08
- torsoLean：<=10°

### Knee Raise TOP

- raised knee height：>=-0.10×torsoLength
- 左右 peak difference：<=0.12×torsoLength
- hip shift：<=0.20×shoulderWidth
- torsoLean：<=10°

这些值与动作配置中的Rule Engine阈值一致，不应为了让教练图片通过而收紧或放宽。静态图无法测量 standing baseline 上的 hipDrop，因此Coach资产层改用 hipKneeSeparation。

## 4. Coach Asset Acceptance与实测

| 资产 | Pose Landmarker实测 | 结论 |
|---|---|---|
| `coach-lateral-raise.png` | shoulder 87.2°/86.5°；elbow 172.6°/172.9°；diff 0.7°；torso 0.2° | 通过TOP门槛 |
| `camera-lateral-raise-demo.png` | shoulder 90.2°/88.1°；elbow 170.1°/165.1°；diff 2.1°；torso 0.1°；confidence 0.99 | 稳定，可用于Demo |
| `coach-step-jack.png` | arm mean 142.6°；openRatio 1.78；torso 3.1°；confidence 0.98 | 通过OPEN门槛 |
| `camera-step-jack-demo.png` | arm mean 139.7°；arm diff 2.5°；openRatio 1.97；torso 0.9°；confidence 0.99 | 检测稳定；步幅比Canonical上限高0.07，作为Demo已知偏差保留 |
| Phase 3 旧 `coach-squat.png` | confidence约0.97；kneeSpreadRatio 3.17；kneeWidth/shoulderWidth 1.82；kneeHeightDiff 0.025；torso 2.3° | 旧 0.80–4.00 门槛过宽；未通过新Canonical Similarity，已替换 |
| Phase 3 静态 `camera-squat-demo.png` | confidence约0.97；kneeSpreadRatio 3.19；kneeWidth/shoulderWidth 1.88；hipKneeSeparation -0.308 | 只保留为poster；不再作为动态动作证据 |
| Phase 3.1 `coach-squat.png` | confidence 0.975；required visibility 0.975；kneeSpreadRatio 2.479；kneeWidth/shoulderWidth 1.449；ankleWidth/shoulderWidth 1.262；hipKneeSeparation -0.053；kneeHeightDiff 0.016；torso 2.15° | Detectability与Canonical Similarity均通过 |
| Phase 4 `coach-knee-raise.png` | confidence 0.975；required visibility 0.957；leftKneeHeight约+0.035；rightKneeHeight约-0.85；torso 1.59°；hip shift约0.016×肩宽 | Detectability与Canonical Similarity均通过 |

Lateral Raise Coach门槛：shoulder 85°–95°、elbow 160°–180°、左右肩差<=5°、torso<=5°。

Step Jack Coach门槛：arm约140°–150°、openRatio 1.7–1.9、torso接近0°；左右OPEN必须是镜像，而不是两套独立手调数据。

Squat Coach门槛拆成两个独立布尔结果，不再使用单个 `passed`：

- Detectability：pose confidence >=0.95、所有必需关键点visibility >=0.95、全身位于2%安全边界内、左右对应点visibility差 <=0.08。
- Canonical Similarity：hipKneeSeparation -0.35–0.20、kneeWidth/shoulderWidth 0.90–1.50、ankleWidth/shoulderWidth 0.75–1.40、平均knee-ankle水平偏移/肩宽 <=0.30、kneeHeightDiff <=0.10、双腿长度差 <=0.12、躯干中心偏移 <=0.12、torso <=5°。

旧图的 `kneeSpreadRatio` 3.24/3.39 不是可靠的“过宽”量尺：正面深蹲时髋点受手臂遮挡、衣服和透视影响，MediaPipe估计的hipWidth会显著缩小，分母不稳定，ratio便被放大。`kneeSpreadRatio`仍保留为Detected诊断并继续服务用户下限 `kneeSpreadRatio < 0.75`（明显膝内收），但不再充当Coach上限。Coach改用较稳定的肩宽归一化膝宽/踝宽，并增加膝踝对齐、腿长对称、居中和全身入镜检查。这里没有修改 `SQUAT_V1` 用户阈值。

## 5. Pose Anchor

- `public/assets/coach-lateral-raise.pose.json`
- `public/assets/coach-step-jack.pose.json`
- `public/assets/coach-squat.pose.json`
- `public/assets/coach-knee-raise.pose.json`

锚点由当前正式图片经过MediaPipe Pose Landmarker Lite实测生成，记录nose以及双侧shoulder、elbow、wrist、hip、knee、ankle。坐标归一化到原始图片，不是手工绘制的理想骨架。

Debug Mode中的`Show Coach Reference Skeleton`会读取这些JSON并在`object-fit: contain`坐标系中叠加两层：青色实线为正式资产真实检测到的Detected Pose，橙色虚线为内部Canonical Visual Reference。旁边分别显示`Detectable PASS/FAIL`与`Similarity PASS/FAIL`及失败检查。它们用于资产验收，不参与用户评分。

## 6. Demo数据链

普通`?demo=1`严格走：

`Demo Image → PoseDetector → PoseFilter → PoseNormalizer → FeatureExtractor → Rule Engine → PoseOverlay`

Overlay使用检测器返回的实际关键点，并根据图片原始宽高与`object-fit: cover`计算裁剪偏移。不得再把图片与无关的手工PoseFrame组合。

Squat在Phase 3.1使用真实图片序列 `STANDING → DESCENDING → BOTTOM → ASCENDING → STANDING_RETURN`，每帧仍进入同一个PoseDetector实例。序列先从真实站立帧建立baseline，然后由实测帧驱动状态机完成一次rep；旧静态图只作poster。

Knee Raise在Phase 4使用 `CENTER → LEFT_RAISING → LEFT_TOP → LEFT_RETURNING → CENTER → RIGHT_RAISING → RIGHT_TOP → RIGHT_RETURNING → CENTER` 图片序列。右侧帧由左侧帧确定性镜像，所有帧仍逐帧通过真实PoseDetector；实测完成2个单侧rep与1个cycle。

`fixture=synthetic`仅用于回归完整动态状态机；它不是普通Demo入口，也不用于视觉验收。

## 7. 资产处理规则

当教练素材不能满足Reference Pose时，必须重新生成素材或在后续阶段迁移到2D rig。禁止使用CSS旋转、拉伸、非等比缩放整张图片来硬修动作。本阶段不构建完整角色动画系统。
