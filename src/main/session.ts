import type { IdleChoice, IdlePrompt } from '@shared/types'
import type { Store } from './db'
import { planIdleChoice } from './idle'

/**
 * Timer bookkeeping that touches the store but not Electron, so it can be
 * unit tested. The app wires these to the idle prompt, the heartbeat and
 * startup.
 */

/** Entries shorter than this after discarding idle time are dropped. */
export const MIN_ENTRY_MS = 60_000

/** Apply the user's answer to an idle prompt to the running entry. */
export function applyIdleChoice(store: Store, choice: IdleChoice, prompt: IdlePrompt, now: Date = new Date()): void {
  const running = store.getRunning()
  if (choice === 'keep') {
    if (running && running.id === prompt.entryId) {
      const kept = Math.max(0, Math.round((Date.parse(prompt.returnedAt) - Date.parse(prompt.idleSince)) / 1000))
      store.updateEntry(running.id, { idleSeconds: running.idleSeconds + kept })
    }
    return
  }
  const plan = planIdleChoice(choice, prompt, running, now.toISOString())
  if (!plan || !running) return
  store.stopTimer(plan.endAt)
  // Idle began before any real work in this entry: drop the empty entry.
  if (Date.parse(plan.endAt) - Date.parse(running.start) < MIN_ENTRY_MS) store.deleteEntry(running.id)
  if (plan.restartAt) {
    store.startTimer({ projectId: running.projectId, description: running.description, tagIds: running.tagIds }, plan.restartAt)
  }
}

/** Record that the app was alive with a timer running. */
export function recordHeartbeat(store: Store, now: number = Date.now()): void {
  if (store.getRunning()) store.setMeta('lastSeen', String(now))
}

/**
 * The last heartbeat from a previous run, if a timer is still running and the
 * app may have been closed or crashed while it ran. Null means nothing to recover.
 */
export function lastSeenForRecovery(store: Store): number | null {
  if (!store.getRunning()) return null
  const lastSeen = Number(store.getMeta('lastSeen') ?? 0)
  return Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null
}
