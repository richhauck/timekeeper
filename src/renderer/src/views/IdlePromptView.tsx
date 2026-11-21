import { useEffect, useState } from 'react'
import { entrySeconds, formatClock, formatTimeOfDay } from '@shared/time'
import type { IdleChoice, IdlePrompt } from '@shared/types'
import { useData, useNow } from '../data'
import { StopIcon, TrashIcon } from '../components/Icons'

/** Runs in the small always-on-top window that opens when the user comes back. */
export function IdlePromptView() {
  const { running } = useData()
  const [prompt, setPrompt] = useState<IdlePrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const now = useNow(1000, !!running)

  useEffect(() => {
    window.api.getIdlePrompt().then(setPrompt)
    return window.api.onIdlePrompt(setPrompt)
  }, [])

  useEffect(() => {
    document.title = 'Welcome back'
  }, [])

  if (!prompt) {
    return (
      <main style={{ padding: 28 }}>
        <p className="muted">Nothing to decide right now.</p>
      </main>
    )
  }

  const awayMinutes = Math.max(1, Math.round((Date.parse(prompt.returnedAt) - Date.parse(prompt.idleSince)) / 60000))
  const choose = async (choice: IdleChoice) => {
    setBusy(true)
    await window.api.resolveIdle(choice)
  }

  const option = (choice: IdleChoice, title: string, detail: string, icon: React.ReactNode, primary = false) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => choose(choice)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        minHeight: 64,
        padding: '12px 16px',
        borderRadius: 10,
        border: primary ? 'none' : '1px solid var(--input-border)',
        background: primary ? 'var(--accent-btn)' : 'var(--surface)',
        color: primary ? '#fff' : 'var(--text)',
        textAlign: 'left'
      }}
    >
      {icon}
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: choice === 'discard-stop' ? 'var(--danger)' : undefined }}>{title}</span>
        <span style={{ fontSize: 13, color: primary ? '#dce5fa' : 'var(--muted)' }}>{detail}</span>
      </span>
    </button>
  )

  return (
    <main role="dialog" aria-labelledby="idle-title" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--surface)', minHeight: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-strong)' }}>Welcome back</p>
        <h1 id="idle-title" style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          You were away for {awayMinutes} minute{awayMinutes === 1 ? '' : 's'}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.5 }}>
          From {formatTimeOfDay(prompt.idleSince)} to {formatTimeOfDay(prompt.returnedAt)}, while the timer was running. What should happen to that time?
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--accent-softer)' }}>
        <span className="dot" style={{ background: prompt.projectColor }} />
        <span className="ellipsis" style={{ flex: 1 }}>
          <strong style={{ fontWeight: 600 }}>{prompt.projectLabel}</strong>
          {prompt.description ? ` · ${prompt.description}` : ''}
        </span>
        {running && <span className="mono">{formatClock(entrySeconds(running.start, null, now))}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {option('discard', 'Discard idle time', `Trim the entry back to ${formatTimeOfDay(prompt.idleSince)}. The timer keeps running.`, <TrashIcon />, true)}
        {option('keep', 'Keep idle time', `Count all ${awayMinutes} minute${awayMinutes === 1 ? '' : 's'}. The timer keeps running.`, <CheckIcon />)}
        {option('discard-stop', 'Discard and stop', `Trim the entry back to ${formatTimeOfDay(prompt.idleSince)} and stop the timer.`, <span style={{ color: 'var(--danger)', display: 'inline-flex' }}><StopIcon /></span>)}
      </div>
    </main>
  )
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}
