import { cn } from '../../lib/cn'
import { COACH_AVATAR_ASSET } from './coachIdentity'

/** The coach's head and shoulders (the identity baseline, cut out) on a soft sky disc: the same face wherever the coach speaks. */
export function CoachAvatar({ className }: { className?: string }) {
  return (
    <span className={cn('fp-coach-avatar inline-block shrink-0 overflow-hidden rounded-full', className)} aria-hidden="true" data-testid="coach-avatar">
      <img src={COACH_AVATAR_ASSET.src} width={COACH_AVATAR_ASSET.width} height={COACH_AVATAR_ASSET.height} alt="" draggable={false} className="size-full object-cover" />
    </span>
  )
}
