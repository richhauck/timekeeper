import type { Entry, IdleChoice, IdlePrompt, Settings } from '@shared/types'

/**
 * Watches for idle time while a timer runs.
 *
 * - Past the idle threshold it fires `onIdle` (the app shows a notification
 *   saying the time is still being counted).
 * - When the user comes back it fires `onReturn` with a prompt asking what to
 *   do with the idle stretch.
 * - Sleep and screen lock count as idle when the setting says so.
 *
 * The class is free of Electron imports so it can be unit tested; the app
 * wires it to powerMonitor.
 */
export interface IdleDeps {
  getIdleSeconds(): number
  getRunning(): Entry | null
  getSettings(): Settings
  describeEntry(entry: Entry): { label: string; color: string }
  onIdle(info: { entry: Entry; idleMinutes: number; label: string }): void
  onReturn(prompt: IdlePrompt): void
  onCleared(): void
  now?(): number
}

/** Seconds of activity after which we treat the user as back. */
const ACTIVE_BELOW_SECONDS = 5

export class IdleMonitor {
  private idleSince: number | null = null
  private notified = false
  private prompt: IdlePrompt | null = null
  private suspendedAt: number | null = null

  constructor(private deps: IdleDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  get currentPrompt(): IdlePrompt | null {
    return this.prompt
  }

  /** True while we are waiting for the user to return; the app polls faster then. */
  get watchingForReturn(): boolean {
    return this.idleSince !== null
  }

  /** Call every few seconds. */
  tick(): void {
    const running = this.deps.getRunning()
    if (!running) {
      this.reset()
      return
    }
    const settings = this.deps.getSettings()
    const threshold = Math.max(1, settings.idleThresholdMinutes) * 60
    const idle = this.deps.getIdleSeconds()

    if (this.idleSince === null) {
      if (idle >= threshold) {
        // Never count idle time from before the entry started.
        this.idleSince = Math.max(this.now() - idle * 1000, new Date(running.start).getTime())
        this.notify(running, idle)
      }
      return
    }

    if (!this.notified && idle >= threshold) this.notify(running, idle)

    if (idle < ACTIVE_BELOW_SECONDS) this.returned(running)
  }

  /** The computer is going to sleep or the screen locked. */
  suspend(): void {
    if (!this.deps.getSettings().sleepCountsAsIdle) return
    if (!this.deps.getRunning()) return
    if (this.suspendedAt === null) this.suspendedAt = this.now()
  }

  /** The computer woke up or the screen unlocked. */
  resume(): void {
    const at = this.suspendedAt
    this.suspendedAt = null
    if (at === null) return
    const running = this.deps.getRunning()
    if (!running) return
    const threshold = Math.max(1, this.deps.getSettings().idleThresholdMinutes) * 60 * 1000
    if (this.now() - at < threshold) return
    const since = this.idleSince !== null ? Math.min(this.idleSince, at) : at
    this.idleSince = Math.max(since, new Date(running.start).getTime())
    this.returned(running)
  }

  /**
   * The app was closed or crashed while a timer ran. `lastSeen` is the last
   * heartbeat; anything beyond the threshold is treated as idle time.
   */
  recoverFromGap(lastSeen: number): void {
    const running = this.deps.getRunning()
    if (!running) return
    const threshold = Math.max(1, this.deps.getSettings().idleThresholdMinutes) * 60 * 1000
    if (this.now() - lastSeen < threshold) return
    this.idleSince = Math.max(lastSeen, new Date(running.start).getTime())
    this.returned(running)
  }

  private notify(entry: Entry, idleSeconds: number): void {
    this.notified = true
    const { label } = this.deps.describeEntry(entry)
    this.deps.onIdle({ entry, idleMinutes: Math.max(1, Math.round(idleSeconds / 60)), label })
  }

  private makePrompt(running: Entry, since: number): IdlePrompt {
    const { label, color } = this.deps.describeEntry(running)
    return {
      entryId: running.id,
      idleSince: new Date(since).toISOString(),
      returnedAt: new Date(this.now()).toISOString(),
      projectLabel: label,
      projectColor: color,
      description: running.description
    }
  }

  /**
   * The user answered from the notification itself, so they are back.
   * Creates the prompt without announcing it; the caller resolves or shows it.
   */
  forceReturn(): void {
    const running = this.deps.getRunning()
    if (!running || this.idleSince === null) return
    this.prompt = this.makePrompt(running, this.idleSince)
    this.idleSince = null
    this.notified = false
  }

  private returned(running: Entry): void {
    if (this.idleSince === null) return
    const settings = this.deps.getSettings()
    const prompt = this.makePrompt(running, this.idleSince)
    this.idleSince = null
    this.notified = false
    if (settings.askOnReturn) {
      this.prompt = prompt
      this.deps.onReturn(prompt)
    } else {
      // Not asking: keep the time, which is what "still being counted" means.
      this.prompt = null
      this.deps.onCleared()
    }
  }

  /** Clear the open prompt after the user answers. Returns the prompt that was answered. */
  takePrompt(): IdlePrompt | null {
    const p = this.prompt
    this.prompt = null
    if (p) this.deps.onCleared()
    return p
  }

  reset(): void {
    const hadPrompt = this.prompt !== null
    this.idleSince = null
    this.notified = false
    this.suspendedAt = null
    if (hadPrompt) {
      this.prompt = null
      this.deps.onCleared()
    }
  }
}

/**
 * What a choice means for the running entry.
 * - keep: nothing changes.
 * - discard: the entry ends when idle began, and an identical entry starts now,
 *   so the timer keeps running without the idle stretch.
 * - discard-stop: the entry ends when idle began.
 */
export function planIdleChoice(
  choice: IdleChoice,
  prompt: IdlePrompt,
  running: Entry | null,
  nowIso: string
): { endAt: string; restartAt: string | null } | null {
  if (choice === 'keep') return null
  if (!running || running.id !== prompt.entryId) return null
  const endAt = prompt.idleSince < running.start ? running.start : prompt.idleSince
  return { endAt, restartAt: choice === 'discard' ? nowIso : null }
}
