# Motion Games Lab — app

一个独立的体感小游戏应用（React + TypeScript + Vite + Phaser 3 + MediaPipe Pose）：摘苹果、林间划船、林间射箭。不依赖、也不导入 `FormPilot_v3`。

## 运行

```powershell
cd apps/motion-games-lab/app  # 从提交仓库根目录执行
pnpm install --frozen-lockfile  # 首次运行
pnpm dev              # http://127.0.0.1:5180
```

用 Edge 或 Chrome 打开，首页选一款游戏 → 开始，并允许摄像头权限。画面只在本机处理，不录像、不上传。

## 检查命令

```powershell
pnpm typecheck        # TypeScript
pnpm lint             # ESLint
pnpm test             # Vitest：动作检测器、三款游戏规则、合成回放、光标平滑、文案检查
pnpm build            # 生产构建 → dist/
pnpm test:e2e         # Playwright（系统 Edge）：先构建并在 :5181 预览，三款游戏从首页跑到结果页，截图存到 ../docs/stage-c-e/screenshots
pnpm preview          # 然后：node scripts/perf.mjs --game boating --video <fake-camera.mjpeg> --headed
```

## 隐藏开关（正式界面里不出现）

| 地址参数 | 作用 |
|---|---|
| `?debug=1` | 开发面板（FPS、推理耗时、追踪 / 姿势 / 取景、各检测器状态机、阈值、动作事件）；场景里显示人物描边、骨架、关键点和手掌判定点；摄像头小窗显示骨架 |
| `?source=synthetic` | 用脚本控制的合成玩家代替摄像头（仅用于自动测试） |
| `?game=apple\|boating\|archery` | 直接进入某款游戏的说明页 |
| `?duration=40` `?seed=5` `?missEvery=6` | 测试用：每局时长（秒）、随机种子、合成玩家每隔 N 次故意做不好一次 |
| `?stroke=down` | 划船改用方案 B（向下划），仅供对比 |
| `?delegate=cpu` / `?fpsLimit=60` | 性能对比用：强制 CPU 推理 / 限制渲染帧率（默认 GPU 优先、不限帧） |

## 目录结构

- `src/motion/`：唯一的动作管线。游戏层只能通过 `contracts.ts` 使用它。检测器：`targetTracker.ts`（摘苹果）、`strokeDetector.ts`（划船）、`drawDetector.ts`（射箭）。`vendor/` 是从 FormPilot_v3 复制的文件，每个文件头部注明来源路径。
- `src/shared/play/PlayController.ts`：三款游戏共用的控制器（倒计时、暂停、追踪丢失、姿势提示、休息提醒、延迟统计）。
- `src/shared/handCursor.ts` + `shared/world/hands.ts`：共用的小手光标（张开 / 半握 / 握紧）。`shared/smoothing.ts`：只用于显示的 One Euro 平滑。
- `src/ui/GamePlay.tsx`：三款游戏共用的游戏界面外壳（HUD、倒计时、暂停、追踪丢失、提示条、摄像头小窗）。
- `src/games/<game>/`：每款游戏的 `config.ts`、`round.ts`（规则）、`controller.ts`、`*Scene.ts`（Phaser 渲染）、`*Play.tsx` 和测试；`games/registry.tsx` 把三款游戏接到共用流程。
- `src/shared/world/`：程序化美术（果园 `painters.ts`、河流 `river.ts`、靶场 `range.ts`、小手 `hands.ts`）。
- `src/ui/`：首页、流程各步骤、摄像头识别与校准、结果页、开发面板。
- `scripts/`：复制 MediaPipe WASM 的脚本、性能测试脚本。
