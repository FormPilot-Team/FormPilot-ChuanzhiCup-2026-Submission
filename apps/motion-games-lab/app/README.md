# Motion Games Lab — app

一个独立的体感小游戏应用（React + TypeScript + Vite + Phaser 3 + MediaPipe Pose）。本轮完成 Stage A（工程底座）和 Stage B（摘苹果）。不依赖、也不导入 `FormPilot_v3`。

## 运行

```powershell
Set-Location E:\FormPilot\motion-games-lab\app
pnpm install          # 首次运行
pnpm dev              # http://127.0.0.1:5180
```

用 Edge 或 Chrome 打开，首页 → 摘苹果 → 开始，并允许摄像头权限。画面只在本机处理，不录像、不上传。

## 检查命令

```powershell
pnpm typecheck        # TypeScript
pnpm lint             # ESLint
pnpm test             # Vitest：动作识别、摘苹果逻辑、姿势代偿、合成回放、文案检查
pnpm build            # 生产构建 → dist/
pnpm test:e2e         # Playwright（系统 Edge）：先构建并在 :5181 预览，再从首页一路跑到结果页，截图存到 ../docs/stage-ab/screenshots
pnpm perf -- --video <fake-camera.mjpeg> --headed   # 性能测试，需先运行 pnpm preview
```

## 隐藏开关（正式界面里不出现）

| 地址参数 | 作用 |
|---|---|
| `?debug=1` | 开发面板：FPS、推理耗时与置信度、追踪 / 姿势 / 取景状态、目标状态机、阈值、动作事件，场景中显示关键点和舒适范围 |
| `?source=synthetic` | 用脚本控制的合成玩家代替摄像头（仅用于自动测试） |
| `?duration=40` `?seed=5` `?missEvery=6` | 测试用：每局时长（秒）、苹果位置的随机种子、合成玩家每隔 N 个苹果故意放过一个 |
| `?delegate=cpu` / `?fpsLimit=60` | 性能对比用：强制 CPU 推理 / 限制渲染帧率（默认 GPU 优先、不限帧） |

## 目录结构

- `src/motion/`：唯一的动作管线。游戏层只能通过 `contracts.ts` 使用它；`vendor/` 是从 FormPilot_v3 复制的文件，每个文件头部注明来源路径。
- `src/games/apple/`：规则（`round.ts`、`reach.ts`、`config.ts`）、控制器（`controller.ts`）、渲染（`AppleScene.ts`）、游戏界面（`ApplePlay.tsx`）。
- `src/games/boating`、`src/games/archery`：只有预留说明，没有逻辑。
- `src/shared/`：三款游戏共用的结果模型、程序化音效、世界画家函数、Phaser 宿主、设置、性能监控。
- `src/ui/`：首页、流程各步骤、镜像画面、结果页、开发面板。
- `scripts/`：从本应用自己的依赖中复制 MediaPipe WASM 的脚本，以及性能测试脚本。
