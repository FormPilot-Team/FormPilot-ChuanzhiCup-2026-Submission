export class PhasePersistenceGate<TPhase extends string> {
  private pending?: TPhase
  private count = 0

  reset(): void {
    this.pending = undefined
    this.count = 0
  }

  clear(): void {
    this.reset()
  }

  confirm(target: TPhase, requiredFrames: number): boolean {
    if (this.pending === target) this.count += 1
    else {
      this.pending = target
      this.count = 1
    }
    if (this.count < requiredFrames) return false
    this.reset()
    return true
  }
}
