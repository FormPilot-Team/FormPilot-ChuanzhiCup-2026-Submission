# FormPilot Web V1 — 使用与技术集成说明

正式比赛入口：`apps/platform`（Vite + React），根路由 `/`。设计来源：`docs/design/chuanzhi-web/formpilot-web/`（PR #52，已获负责人审阅）。

## 1. 启动

```powershell
# 平台（正式构建 + 生产预览，http://127.0.0.1:4175）
pnpm --dir apps/platform install
pnpm --dir apps/platform competition:build
pnpm --dir apps/platform competition:preview

# 体感游戏（可选；游戏中心需要它才能真正启动游戏，http://127.0.0.1:5181）
pnpm --dir apps/motion-games-lab/app install
pnpm --dir apps/motion-games-lab/app build
pnpm --dir apps/motion-games-lab/app preview
```

- 游戏服务地址默认 `http://127.0.0.1:5181/`，构建时可用 `VITE_MOTION_GAMES_URL` 改为部署地址。
- 功法标准视频 `public/assets/routines/*-standard.mp4` 不进 Git（`.gitignore`），需按 `assets-manifest` 放到本机；缺失时详情页显示“示范视频暂时无法播放”。
- 开发服务器：`pnpm --dir apps/platform dev`。

## 2. 六大板块与路由

| 板块 | 路由 | 实现 | 数据来源 |
| --- | --- | --- | --- |
| 首页 | `/` | `pages/Web/HomeV1Page.tsx` | 本机热身 / 功法 / 我的动作记录（`features/web/webHistory.ts`） |
| 训练中心 | `/training` | `pages/Web/TrainingCenterPage.tsx` | 6 个标准动作（`FREE_TRAINING_OPTIONS`）、动作工坊动作库 |
| 功法训练 | `/routines`、`/routines/:id`、`/routines/:id/train` | `pages/Web/RoutinesV1Page.tsx` + 既有 `RoutineEntryPage`/`RoutineTrainingPage` | `ROUTINE_PROGRAMS`、功法跟练记录 |
| 游戏中心 | `/games`（`?game=apple\|boating\|archery` 直接打开准备弹窗） | `pages/Web/GamesCenterPage.tsx` | Motion Games Lab（独立应用，新窗口运行） |
| AI Coach | `/coach`（`?view=profile` 跳过开场页） | `pages/Web/CoachPage.tsx` | `recommendCoachDecision`（fp-coach-decision/v1） |
| 我的 | `/me`、`/me/settings`、`/history`、`/report/:id`、`/workshop` | `pages/Web/MePage.tsx`、`SettingsPage.tsx` + 既有历史 / 报告 / 动作工坊 | 本机记录 |

保留的既有路由：`/smart-training`、`/train`（含 `/?demo=1…` 诊断入口）、`/history`、`/report/:id`、`/workshop`、`/workshop/new`、`/workshop/:id`、`/workshop/:id/train`。未知路径显示“没有找到这个页面”。

## 3. 设计还原方式

- `scripts/build-web-v1-styles.mjs` 把 #52 的 `styles.css` **逐条复制**为 `src/styles/web-v1.css`：选择器加 `.fpw` 作用域、关键帧加 `fpw-` 前缀、素材路径改为 `/web-v1/…`，放在 Tailwind 的 `components` 层。不手改生成文件；设计源更新后重新运行脚本。
- 素材复制到 `public/web-v1/`（海报、AI Coach 球体、游戏卡图、首页背景）。
- 游戏中心原型是 iframe 内的独立页面，类名与主原型冲突，因此在 `src/styles/web-v1-platform.css` 中以 `gc-` 前缀移植，视觉不变；正式产品不使用 iframe。
- 既有功能页（训练、功法详情 / 跟练、报告、历史、动作工坊）沿用原有页面，顶部导航 `AppHeader` 换成设计稿顶栏与六板块；训练进行页不显示手机底部导航，避免遮挡控制按钮。
- 唯一文案修改：「动作工作坊」→「动作工坊」。

## 4. 演示数据与真实数据

- 原型中的睡眠、心率、步数、卡路里、“200+ 训练者”、“林同学”等演示数字全部移除。首页浮动卡片改为本机真实训练事实（今日 / 本周 / 连续 / 累计次数、最近训练、我的动作数）或目录事实（4 套功法、6 个动作、3 款游戏）；没有记录时显示 0 与首次使用文案。
- 趋势图只用“可靠的热身完整训练”综合评分（与历史页相同规则），不少于 2 次才显示；功法、我的动作和游戏不并入。
- 游戏成绩不写入训练记录，“我的 → 游戏”筛选明确说明。

## 5. AI Coach 与决策模型

- 调用：`runCoachDecision`（`pages/Web/CoachPage.tsx`）= `collectLocalDecisionInput(profile, {consent})` → `recommendCoachDecision(input, { mode })`。不传 `allowExperimentalModel`。
- 模式开关 `src/app/coachDecisionConfig.ts`：默认 `off`；`shadow` 仅在 `VITE_COACH_DECISION_MODE=shadow` 构建或 DEV 下 `?coachMode=shadow` 时启用；任何输入都不会得到 `active`（有单测）。
- 流程：画像（目标 / 困难 / 部位 / 偏好）→ 风险确认 → “我已了解”→ 数据授权（默认仅画像；勾选后才读取本机功法记录）→ 推荐。
- 展示：`display.result` 的章节 / 功法 / 游戏、每项理由与依据、固定五问（`display.answers`）、推荐计划、下一步建议；章节直接跳转 `/routines/:id/train?form=…`，游戏跳转 `/games?game=…`（体感赛车未接入游戏中心，显示“尚未接入”）。
- `safety_hold` 只显示暂停与专业咨询提示；`profile_required` 引导补全画像；模型弃权回退规则并提示。
- SHADOW 开发面板：模型排序、适配度、前 6 个特征贡献条形图、置信度、回退 / 弃权原因、模型发布号；日志写入 `localStorage['formpilot.coach-decision-shadow-log:v1']`（`toShadowLogEntry`，只含内容 ID、结果和耗时），可导出 / 清空，不上传。
- 模型身份始终标注「实验性模型，AI 标注训练，未经人工验证」。决策模型目录（`features/coachAgent/decisionModel/**`）、权重、契约、Guard 未改动。

## 6. 游戏中心

- 三张卡片（摘苹果、林间划船、林间射箭）沿用设计稿文案与图片。
- 打开页面时用 `no-cors` 请求检测 Motion Games Lab 是否在运行：在运行 → “开始游戏”在新窗口打开 `…/?game=<id>`，关闭该窗口后弹窗自动回到游戏中心；未运行 → “尚未接入”，只提供“重新检查 / 返回游戏中心”。
- 平台不模拟游戏、不记录游戏成绩；摄像头与识别全部在游戏应用内完成。

## 7. 测试

```powershell
pnpm --dir apps/platform typecheck
pnpm --dir apps/platform lint
pnpm --dir apps/platform test                        # 含 tests/web-v1.test.ts
pnpm --dir apps/platform build
pnpm --dir apps/platform competition:build
pnpm --dir apps/platform exec playwright test tests/e2e/web-v1.spec.ts   # 游戏启动用例需先运行游戏预览，否则自动 skip
# 视觉证据（生产预览 :4175，四个视口）
$env:WEB_V1_SHOTS="<输出目录>"; pnpm --dir apps/platform exec playwright test -c playwright.web-v1-visual.config.ts
```

E2E 中的摄像头、DEV 合成姿态（`fixture=synthetic`）和本机记录都是模拟输入，不等于真实摄像头或真人验收。
