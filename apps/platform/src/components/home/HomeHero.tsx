import { AudioLines, BookOpen, ChartLine, ScanLine, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/cn'
import { COACH_NAME, COACH_WELCOME_ASSET, COACH_WELCOME_FALLBACK, type CoachImageAsset } from '../coach/coachIdentity'

/** Three light hints next to the coach (wide screens only); the tagline already names them on every screen. */
const CAPABILITIES: ReadonlyArray<{ icon: LucideIcon; title: string; detail: string }> = [
  { icon: ScanLine, title: '实时动作识别', detail: '摄像头识别身体姿态' },
  { icon: AudioLines, title: '动作纠正', detail: '语音提示，边练边调整' },
  { icon: ChartLine, title: '训练复盘', detail: '练完看报告，对比上次' },
]

/**
 * The coach from COACH_WELCOME_ASSET and her welcome, in one box with the picture's own aspect ratio, so the bubble
 * stays beside her at every size. A file that fails to load falls back to the Family A cut-out.
 */
function CoachWelcome() {
  // null once both the asset and the fallback failed: the box keeps the fallback's shape and the bubble stays.
  const [asset, setAsset] = useState<CoachImageAsset | null>(COACH_WELCOME_ASSET)
  const frame = asset ?? COACH_WELCOME_FALLBACK
  return (
    <div className="relative ml-auto h-full max-w-full sm:mx-auto lg:ml-auto lg:mr-6 xl:mr-0" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
      <span className="fp-coach-halo absolute left-[16%] top-[20%] aspect-square w-[68%] rounded-full" aria-hidden="true" />
      {asset ? (
        <img
          src={asset.src}
          width={asset.width}
          height={asset.height}
          alt={`${COACH_NAME}举起双手向你打招呼`}
          draggable={false}
          onError={() => setAsset((current) => (current && current !== COACH_WELCOME_FALLBACK ? COACH_WELCOME_FALLBACK : null))}
          style={{ objectPosition: asset.focus }}
          className={cn('absolute inset-0 size-full object-cover', asset.background === 'light' && 'mix-blend-multiply', asset.fadeBottom && 'fp-fade-bottom')}
          data-testid="home-coach-image"
          data-asset={asset.src}
        />
      ) : null}
      {/* A speech bubble, not a card: rounded, light, with a tail curling up towards her. One drop shadow covers the
          bubble and the tail together, so they read as one shape. */}
      <p
        style={frame.bubble}
        className="fp-speech-bubble absolute z-10 w-max max-w-[11.5rem] rounded-[1.35rem] bg-white px-3.5 py-2.5 text-[13px] leading-5 text-slate-700 sm:max-w-none sm:px-4 sm:py-3 sm:text-sm sm:leading-6"
        data-testid="home-coach-welcome"
      >
        <svg viewBox="0 0 22 20" aria-hidden="true" focusable="false" className="absolute -right-[15px] top-1 h-5 w-[22px] fill-white" data-part="bubble-tail">
          <path d="M0 9C7 8.5 15 6 22 0C19 8 13 14 1 19Z" />
        </svg>
        <span className="sr-only">{COACH_NAME}：</span>
        <span className="block font-bold text-slate-900">你好！</span>
        <span className="block">今天想练什么？</span>
        <span className="block">我会陪你一起完成训练。</span>
      </p>
    </div>
  )
}

/** Soft motion trails behind the coach: the welcome gesture traced as trajectories, with two pose keypoints. */
function MotionTrails() {
  return (
    <svg viewBox="0 0 900 520" fill="none" aria-hidden="true" focusable="false" className="pointer-events-none absolute -bottom-6 left-1/2 -z-10 h-[118%] w-[210%] -translate-x-1/2 sm:w-[190%]">
      <defs>
        <linearGradient id="home-trail-a" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset=".45" stopColor="#38bdf8" stopOpacity=".55" />
          <stop offset="1" stopColor="#2563eb" stopOpacity=".1" />
        </linearGradient>
        <linearGradient id="home-trail-b" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2dd4bf" stopOpacity="0" />
          <stop offset=".5" stopColor="#22d3ee" stopOpacity=".4" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M40 500 C230 470 300 300 450 250 S700 150 880 40" stroke="url(#home-trail-a)" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 440 C210 430 290 250 470 214 S720 190 900 120" stroke="url(#home-trail-b)" strokeWidth="10" strokeLinecap="round" opacity=".45" />
      <path d="M140 520 C300 420 420 380 560 330 S760 300 900 250" stroke="#7dd3fc" strokeOpacity=".45" strokeWidth="1.6" strokeDasharray="2 9" strokeLinecap="round" />
      <circle cx="450" cy="250" r="5" fill="#fff" stroke="#38bdf8" strokeWidth="2.5" />
      <circle cx="775" cy="95" r="4" fill="#fff" stroke="#60a5fa" strokeWidth="2" />
    </svg>
  )
}

const UTILITY_BUTTON = 'inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_6px_16px_-12px_rgb(30_64_175/0.5)] ring-1 ring-slate-200/80 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

/**
 * Home hero: the brand on the left, FormPilot's coach welcoming you on the right, and a few light capability hints
 * on wide screens. Full-width band; its content lines up with the sections below. 使用说明 and 评分依据 are two small
 * utility entries on the same level.
 */
export function HomeHero({ onOpenGuide, onOpenScoringBasis }: { onOpenGuide: () => void; onOpenScoringBasis: () => void }) {
  return (
    <section className="fp-home-hero relative isolate overflow-hidden" aria-labelledby="home-title" data-testid="home-hero">
      <div className="mx-auto grid min-w-0 max-w-[1200px] px-4 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,46%)] sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:px-8 lg:pt-6 xl:grid-cols-[minmax(0,1fr)_468px_196px]">
        <div className="relative z-10 min-w-0 self-center pb-2 pt-7 sm:py-10 lg:py-14">
          <h1 id="home-title" className="fp-wordmark pb-1 text-[2.75rem] font-extrabold leading-none tracking-tight sm:text-6xl lg:text-[4.25rem]">FormPilot</h1>
          <p className="mt-3 text-balance text-xl font-semibold text-slate-700 sm:mt-4 sm:text-2xl lg:text-[1.75rem]">你的专属动作教练</p>
          <p className="mt-2 text-pretty text-sm text-slate-500 sm:text-base">实时动作识别 · 动作纠正 · 训练复盘</p>
          <div className="mt-5 flex flex-wrap items-center gap-2 sm:mt-7">
            <button type="button" onClick={onOpenGuide} className={UTILITY_BUTTON} data-testid="home-guide">
              <BookOpen size={16} aria-hidden="true" />使用说明
            </button>
            <button type="button" onClick={onOpenScoringBasis} className={UTILITY_BUTTON} aria-haspopup="dialog" data-testid="home-scoring-basis">
              <ShieldCheck size={16} aria-hidden="true" />评分依据
            </button>
          </div>
        </div>

        <div className="relative h-[196px] min-w-0 sm:h-[270px] md:h-[320px] lg:h-[430px]" data-testid="home-coach">
          <MotionTrails />
          <CoachWelcome />
        </div>

        <ul className="relative z-10 hidden min-w-0 flex-col gap-5 self-center pl-2 xl:flex" aria-label="FormPilot 能做什么" data-testid="home-hero-capabilities">
          {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/85 text-blue-600 shadow-[0_8px_18px_-12px_rgb(30_64_175/0.55)] ring-1 ring-white">
                <Icon size={19} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{title}</span>
                <span className="block text-xs text-slate-500">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
