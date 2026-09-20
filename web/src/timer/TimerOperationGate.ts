/** Orders writes per habit and rejects reads taken before a write or newer read. */
export class TimerOperationGate {
  private mutationVersion = 0
  private readVersion = 0
  private pending = new Map<number, Promise<unknown>>()

  beginRead(): { mutation: number; read: number } | null {
    if (this.pending.size) return null
    return { mutation: this.mutationVersion, read: ++this.readVersion }
  }

  canApplyRead(token: { mutation: number; read: number }): boolean {
    return this.pending.size === 0 && token.mutation === this.mutationVersion && token.read === this.readVersion
  }

  run<T>(habitId: number, operation: () => Promise<T>): Promise<T> {
    ++this.mutationVersion
    const previous = this.pending.get(habitId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation).finally(() => {
      ++this.mutationVersion
      if (this.pending.get(habitId) === result) this.pending.delete(habitId)
    })
    this.pending.set(habitId, result)
    return result
  }
}
