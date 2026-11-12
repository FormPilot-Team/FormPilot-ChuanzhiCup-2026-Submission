import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { PROFILE_BOUNDS } from '../../features/workshop/recognition/templates'
import { captureContinuousVideo, capturePoseFromVideo, videoFileProblem, videoFrameProblem } from '../../features/workshop/videoCapture'
import type { ContinuousSuggestion } from '../../features/workshop/recognition/continuous'
import type { CapturedPose, RecognitionProfile } from '../../features/workshop/types'

type Target = 'start' | 'finish'

/** Local file preview and optional pose capture. No video bytes are persisted or uploaded. */
export function VideoDemonstrationInput({ profile, onCapture, onSuggestion, onUseCamera }: {
  profile: RecognitionProfile
  onCapture: (target: Target, pose: CapturedPose) => void
  onSuggestion: (suggestion: ContinuousSuggestion) => void
  onUseCamera: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const urlRef = useRef<string | undefined>(undefined)
  const generationRef = useRef(0)
  const [url, setUrl] = useState<string>()
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<ContinuousSuggestion>()

  useEffect(() => () => { generationRef.current += 1; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    generationRef.current += 1
    setSuggestion(undefined)
    const problem = videoFileProblem(file)
    if (problem) { setError(true); setMessage(problem); return }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(file)
    setFileName(file.name)
    setDuration(0)
    setError(false)
    setMessage('正在检查视频能否播放…')
    setUrl(urlRef.current)
  }

  const capture = async (target: Target) => {
    const video = videoRef.current
    if (!video) return
    const problem = videoFrameProblem(video.currentTime, video.duration)
    if (problem) { setError(true); setMessage(problem); return }
    const generation = generationRef.current
    setBusy(true)
    setError(false)
    setMessage('正在识别当前画面附近的姿势…')
    try {
      const pose = await capturePoseFromVideo(video, PROFILE_BOUNDS[profile])
      if (generation !== generationRef.current) return
      onCapture(target, pose)
      setMessage(`已从视频记录${target === 'start' ? '开始' : '完成'}姿势。请继续选择另一段或进入测试。`)
    } catch (error) {
      if (generation !== generationRef.current) return
      setError(true)
      setMessage(error instanceof Error ? error.message : '分析失败，请换一个清晰、稳定的片段。')
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }

  const scan = async () => {
    const video = videoRef.current
    if (!video) return
    const generation = generationRef.current
    setSuggestion(undefined)
    setBusy(true)
    setError(false)
    setMessage('正在分析连续示范…')
    try {
      const result = await captureContinuousVideo(video, PROFILE_BOUNDS[profile], (done, total) => {
        if (generation === generationRef.current) setMessage(`正在分析连续示范… ${Math.round(done / total * 100)}%`)
      }, () => generation === generationRef.current)
      if (generation !== generationRef.current) return
      setSuggestion(result)
      setMessage('找到一次完整往返。请检查建议，再决定是否采用。')
    } catch (caught) {
      if (generation !== generationRef.current) return
      setError(true)
      setMessage(caught instanceof Error ? caught.message : '分析失败，请手动记录两个姿势。')
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="workshop-video-demonstration">
      <h4 className="font-bold text-slate-950">从视频记录姿势</h4>
      <p className="mt-1 text-sm leading-6 text-slate-600">① 选本机视频；② 暂停在开始姿势并记录；③ 拖到完成姿势再记录。视频只在本机预览，保存动作时只记录关键点。</p>
      <button type="button" className="secondary-button mt-3" disabled={busy} onClick={() => inputRef.current?.click()}>选择视频</button>
      <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-label="选择示范视频" onChange={selectFile} data-testid="workshop-video-input" />
      <p className="mt-2 text-xs leading-5 text-slate-500">文件选择不限后缀，也没有上传大小限制。MP4、MOV、WebM 等可尝试；能否播放取决于当前浏览器和设备。</p>
      {url ? (
        <div className="mt-3">
          <p className="mb-2 break-all text-sm font-semibold text-slate-700">{fileName}</p>
          <video ref={videoRef} key={url} src={url} controls playsInline preload="metadata" className="max-h-80 w-full rounded-xl bg-black object-contain" aria-label="本地示范视频预览" data-testid="workshop-video-preview"
            onLoadedMetadata={(event) => { const length = event.currentTarget.duration; setDuration(Number.isFinite(length) ? length : 0); const problem = videoFrameProblem(0, length); setError(Boolean(problem)); setMessage(problem ?? '可以播放视频并拖动到想要记录的姿势。') }}
            onError={() => { setDuration(0); setError(true); setMessage('当前设备无法播放这个视频。可以换一个文件，或在本机把它转换为 MP4（H.264）后重试。原文件没有上传。') }} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="secondary-button" disabled={!duration || busy} onClick={() => void capture('start')}>记录当前片段为开始姿势</button>
            <button type="button" className="secondary-button" disabled={!duration || busy} onClick={() => void capture('finish')}>记录当前片段为完成姿势</button>
          </div>
          <div className="mt-4 rounded-xl border border-blue-200 bg-white p-3">
            <p className="text-sm font-bold text-slate-900">连续示范自动建议</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">视频从静止的开始姿势拍到动作完成，再回到开始姿势。把进度条移到这次动作前，自动分析后仍需你确认和实际测试。</p>
            <button type="button" className="secondary-button mt-2" disabled={!duration || busy} onClick={() => void scan()} data-testid="workshop-continuous-scan">分析这段连续示范</button>
            {suggestion ? <div className="mt-3 text-sm text-slate-700" data-testid="workshop-continuous-suggestion">
              <p>找到阶段：开始 {suggestion.phases.start.toFixed(1)} 秒 → 运动 {suggestion.phases.moving.toFixed(1)} 秒 → 到位 {suggestion.phases.peak.toFixed(1)} 秒 → 返回 {suggestion.phases.returned.toFixed(1)} 秒。</p>
              <p className="mt-1">参考模板：开始姿势、完成姿势；建议单次至少 {suggestion.suggestedMinRepMs / 1000} 秒。分析了 {suggestion.sampledFrames} 帧。</p>
              <button type="button" className="primary-button mt-3" onClick={() => { onSuggestion(suggestion); setSuggestion(undefined); setMessage('已采用建议，请检查姿势和识别重点，再进行实际测试。') }}>采用这组建议</button>
            </div> : null}
          </div>
        </div>
      ) : null}
      {message ? <p className={`mt-3 text-sm font-semibold ${error ? 'text-coral-600' : 'text-blue-800'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}
      {error ? <button type="button" className="mt-2 text-sm font-semibold text-blue-700 underline underline-offset-2" onClick={onUseCamera}>改用摄像头示范</button> : null}
    </div>
  )
}
