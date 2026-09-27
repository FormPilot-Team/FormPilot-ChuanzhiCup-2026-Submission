import { cn } from '../../lib/cn'
import { COACH_AVATAR_ASSET } from './coachIdentity'

/** The coach's face (the identity baseline, cut out) on a soft sky disc: the same look wherever the coach answers. */
export function CoachAvatar({ className }: { className?: string }) {
  return (
    <span className={cn('fp-coach-avatar inline-block shrink-0 overflow-hidden rounded-full', className)} aria-hidden="true">
      <img src={COACH_AVATAR_ASSET} alt="" draggable={false} className="size-full object-cover" />
    </span>
  )
}
