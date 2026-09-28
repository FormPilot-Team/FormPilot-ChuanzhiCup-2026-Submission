import { Footprints, Hand } from 'lucide-react'
import { FRAMING_PROFILES } from '../../features/framing/framingProfiles'
import type { FramingAssistState } from '../../features/framing/FramingAssist'
import { cn } from '../../lib/cn'

type Tone = 'good' | 'warn' | 'idle'

interface RoutineCameraStatusProps {
  cameraMode: 'idle' | 'requesting_permission' | 'model_loading' | 'live' | 'demo' | 'error'
  /** Framing Assist v1's own state; this strip only restates it next to the requirement. */
  framingAssist: FramingAssistState
  poseUnavailable: boolean
  paused: boolean
}

const DOT: Readonly<Record<Tone, string>> = { good: 'bg-emerald-500', warn: 'bg-amber-500', idle: 'bg-slate-300' }

function framingItem({ cameraMode, framingAssist, poseUnavailable }: RoutineCameraStatusProps): { text: string; tone: Tone } {
  if (cameraMode !== 'live' && cameraMode !== 'demo') return { text: '启用摄像头后检测', tone: 'idle' }
  if (poseUnavailable) return { text: FRAMING_PROFILES.FULL_BODY.poseLost, tone: 'warn' }
  if (framingAssist.isReady) return { text: `${FRAMING_PROFILES[framingAssist.profile].label}入镜 ✓`, tone: 'good' }
  return { text: framingAssist.primaryHint, tone: 'warn' }
}

function recognitionItem({ cameraMode, framingAssist, poseUnavailable, paused }: RoutineCameraStatusProps): { text: string; tone: Tone } {
  if (cameraMode === 'requesting_permission' || cameraMode === 'model_loading') return { text: '正在启动识别', tone: 'idle' }
  if (cameraMode === 'error') return { text: '摄像头未就绪', tone: 'warn' }
  if (cameraMode === 'idle') return { text: '未开始', tone: 'idle' }
  if (poseUnavailable) return { text: '未识别到人体', tone: 'warn' }
  if (paused) return { text: '训练暂停', tone: 'idle' }
  return framingAssist.isReady ? { text: '姿态识别正常', tone: 'good' } : { text: '等待稳定识别', tone: 'warn' }
}

/** Under 我的画面: what the routine needs in frame, whether the user is in frame now, and whether the pose is tracked. */
export function RoutineCameraStatus(props: RoutineCameraStatusProps) {
  const profile = FRAMING_PROFILES[props.framingAssist.profile]
  const items = [
    { key: 'requirement', label: '入镜要求', text: `本课程需要${profile.label}入镜`, tone: 'idle' as Tone },
    { key: 'framing', label: '入镜状态', ...framingItem(props) },
    { key: 'recognition', label: '识别状态', ...recognitionItem(props) },
  ]
  return (
    <div className="mt-2 flex min-w-0 flex-1 flex-col gap-2">
    <dl className="grid min-w-0 gap-2 sm:grid-cols-3" data-testid="routine-camera-status" data-framing-ready={props.framingAssist.isReady ? 'true' : 'false'}>
      {items.map((item) => (
        <div key={item.key} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2" data-testid={`routine-camera-${item.key}`} data-tone={item.tone}>
          <dt className="text-xs text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 flex min-w-0 items-start gap-1.5 text-sm font-semibold leading-5 text-slate-800">
            {item.key === 'requirement' ? null : <i className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[item.tone])} aria-hidden="true" />}
            <span className="line-clamp-2 min-w-0 text-pretty" title={item.text}>{item.text}</span>
          </dd>
        </div>
      ))}
    </dl>
    <ul className="grid min-w-0 gap-1.5 rounded-xl border border-slate-100 px-3 py-2 text-xs leading-5 text-slate-600 xl:mt-auto" aria-label="跟练操作提示" data-testid="routine-camera-guide">
      <li className="flex min-w-0 gap-2"><Footprints size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="min-w-0 text-pretty"><b className="font-semibold text-slate-700">站位</b> 离屏幕约 2.5 米，正对摄像头，头到脚都留在取景框内</span></li>
      <li className="flex min-w-0 gap-2"><Hand size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="min-w-0 text-pretty"><b className="font-semibold text-slate-700">手势</b> 双手在胸前合拢并保持：开始跟练，暂停后继续</span></li>
    </ul>
    </div>
  )
}
