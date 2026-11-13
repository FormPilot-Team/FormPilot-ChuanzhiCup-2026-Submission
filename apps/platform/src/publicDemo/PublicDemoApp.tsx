import { useMemo } from 'react'
import { CoachPage } from '../pages/Web/CoachPage'
import { DEMO_DATASET_NOTE, DEMO_PROFILE, createDemoStorage } from './syntheticDataset'

/**
 * Public AI Coach demo (`pnpm demo:build`, served by server/coachAgent/demo). Only the AI Coach page, on the bundled
 * synthetic dataset, with the same agent, tools, RAG, M1/M2 decision runtime (competition build: ACTIVE) and validation
 * as the product. Every route renders this page; no camera, no training pages, no reference videos.
 */
export default function PublicDemoApp() {
  const storage = useMemo(createDemoStorage, [])
  document.title = 'FormPilot · AI 教练在线演示'
  document.documentElement.classList.add('fp-public-demo')
  return (
    <>
      <div className="public-demo-banner" role="note" data-testid="public-demo-banner">
        <strong>FormPilot AI 教练 · 在线演示</strong>
        <span>只包含 AI 教练，完整平台（摄像头训练、功法跟练、动作工坊、体感游戏）请使用离线竞赛包。</span>
        <span>画像与训练记录属于一位<b>虚构的示例用户</b>，是程序生成的合成数据，不是你的数据。你的提问和工具整理后的合成数据会发送到演示服务器上的大模型，请不要输入真实的健康或个人信息。</span>
      </div>
      <CoachPage storage={storage} startInside demo={{ datasetNote: DEMO_DATASET_NOTE, profile: DEMO_PROFILE }} />
    </>
  )
}
