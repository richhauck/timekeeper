import { useEffect, useState } from 'react'
import { roundForSettings } from '@shared/rounding'
import { formatHM } from '@shared/time'
import { ROUNDING_OPTIONS, type AppInfo, type RoundingMode, type Settings, type Theme } from '@shared/types'
import { errorMessage, useData } from '../data'
import { InfoIcon } from '../components/Icons'
import { useToast } from '../components/Toast'

const MODES: { id: RoundingMode; label: string; hint: string }[] = [
  { id: 'nearest', label: 'To the nearest increment', hint: 'Halfway or more rounds up, less rounds down.' },
  { id: 'up', label: 'Always up', hint: 'Any started increment counts in full.' },
  { id: 'down', label: 'Always down', hint: 'Only completed increments count.' }
]

export function SettingsView() {
  const { settings } = useData()
  const toast = useToast()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [idleText, setIdleText] = useState(String(settings.idleThresholdMinutes))

  useEffect(() => {
    window.api.getAppInfo().then(setInfo)
  }, [])
  useEffect(() => setIdleText(String(settings.idleThresholdMinutes)), [settings.idleThresholdMinutes])

  const save = async (patch: Partial<Settings>) => {
    try {
      await window.api.updateSettings(patch)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const example = (min: number) => formatHM(roundForSettings(min * 60, settings))

  return (
    <main className="page narrow">
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>Settings</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          Changes save automatically
        </span>
      </header>

      <section aria-labelledby="round-h" className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h2 id="round-h" style={{ fontSize: 18 }}>
            Rounding
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Each entry's duration is rounded on its own in the timer list, reports and exports. Exact start and end times are always kept, so changing this re-rounds past entries too.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span id="inc-l" style={{ fontSize: 13, fontWeight: 600 }}>
            Round each entry to
          </span>
          <div role="group" aria-labelledby="inc-l" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ROUNDING_OPTIONS.map((n) => {
              const on = settings.roundingMinutes === n
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  className={`btn${on ? ' primary' : ''}`}
                  style={{ minWidth: 64, fontWeight: on ? 600 : 400 }}
                  onClick={() => save({ roundingMinutes: n })}
                >
                  {n ? `${n} min` : 'Off'}
                </button>
              )
            })}
          </div>
        </div>
        <fieldset style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 10 }} disabled={!settings.roundingMinutes}>
          <legend style={{ padding: 0, marginBottom: 10, fontSize: 13, fontWeight: 600 }}>Rounding mode</legend>
          {MODES.map((m) => (
            <label key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', opacity: settings.roundingMinutes ? 1 : 0.5 }}>
              <input type="radio" name="mode" checked={settings.roundingMode === m.id} onChange={() => save({ roundingMode: m.id })} style={{ width: 18, height: 18, margin: '2px 0 0', accentColor: 'var(--accent)' }} />
              <span>
                <span style={{ fontWeight: 500 }}>{m.label}</span>
                <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                  {m.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="notice">
          <InfoIcon style={{ color: 'var(--accent)', flex: 'none' }} />
          <p style={{ margin: 0 }}>
            With this setting, a <strong>1:08</strong> entry shows as <strong className="mono">{example(68)}</strong> and a <strong>0:22</strong> entry shows as{' '}
            <strong className="mono">{example(22)}</strong>.
          </p>
        </div>
      </section>

      <section aria-labelledby="idle-h" className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h2 id="idle-h" style={{ fontSize: 18 }}>
            Idle detection
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            While a timer runs, Timekeeper notices when you step away and reminds you that the time is still counting.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <label htmlFor="idle-min" style={{ fontWeight: 500 }}>
            Notify me after
          </label>
          <input
            id="idle-min"
            type="number"
            min={1}
            max={120}
            className="input mono"
            style={{ width: 84 }}
            value={idleText}
            onChange={(e) => setIdleText(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(idleText))
              if (Number.isFinite(n) && n >= 1 && n <= 120) save({ idleThresholdMinutes: n })
              else setIdleText(String(settings.idleThresholdMinutes))
            }}
          />
          <span>minutes idle</span>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={settings.sleepCountsAsIdle} onChange={(e) => save({ sleepCountsAsIdle: e.target.checked })} />
          Treat sleep and screen lock as idle time
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.askOnReturn} onChange={(e) => save({ askOnReturn: e.target.checked })} />
          Ask what to do with idle time when I come back
        </label>
        {info?.idleNote ? (
          <div className="notice warn">
            <InfoIcon style={{ color: 'var(--danger)', flex: 'none' }} />
            <p style={{ margin: 0 }}>{info.idleNote}</p>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {info?.platform === 'darwin'
              ? 'The idle notification has Keep and Discard buttons. To keep it on screen until you answer, set Timekeeper notifications to "Alerts" in System Settings.'
              : 'Click the idle notification to answer it right away. Otherwise a small prompt appears when you come back.'}
          </p>
        )}
      </section>

      <section aria-labelledby="gen-h" className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 id="gen-h" style={{ fontSize: 18 }}>
          General
        </h2>
        <div className="field">
          <span id="theme-l" style={{ fontSize: 13, fontWeight: 600 }}>
            Theme
          </span>
          <div className="segmented" role="group" aria-labelledby="theme-l" style={{ alignSelf: 'flex-start' }}>
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} type="button" aria-pressed={settings.theme === t} onClick={() => save({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {info && info.platform !== 'linux' && (
          <label className="checkbox">
            <input type="checkbox" checked={settings.openAtLogin} onChange={(e) => save({ openAtLogin: e.target.checked })} />
            Open Timekeeper when I log in
          </label>
        )}
      </section>

      <section aria-labelledby="data-h" className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 id="data-h" style={{ fontSize: 18 }}>
          Data
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Database file</p>
            <p className="mono" style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-2)', wordBreak: 'break-all' }}>
              {info?.dbPath}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => window.api.showDatabaseInFolder()}>
              Show in folder
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  const r = await window.api.backupDatabase()
                  if (r.saved) toast('Backup saved')
                } catch (err) {
                  toast(errorMessage(err), { error: true })
                }
              }}
            >
              Back up now
            </button>
          </div>
        </div>
        {info && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Timekeeper {info.version}
          </p>
        )}
      </section>
    </main>
  )
}
