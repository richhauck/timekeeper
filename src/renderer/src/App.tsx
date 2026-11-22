import { useEffect, useState } from 'react'
import { entrySeconds, formatClock } from '@shared/time'
import { useData, useNow } from './data'
import { Logo, ProjectsIcon, ReportsIcon, SettingsIcon, TimerIcon } from './components/Icons'
import { TimerView } from './views/TimerView'
import { ReportsView } from './views/ReportsView'
import { ProjectsView } from './views/ProjectsView'
import { SettingsView } from './views/SettingsView'
import { IdlePromptView } from './views/IdlePromptView'

export type View = 'timer' | 'reports' | 'projects' | 'settings'

const NAV: { id: View; label: string; Icon: typeof TimerIcon }[] = [
  { id: 'timer', label: 'Timer', Icon: TimerIcon },
  { id: 'reports', label: 'Reports', Icon: ReportsIcon },
  { id: 'projects', label: 'Projects', Icon: ProjectsIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon }
]

export function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (hash.startsWith('#/idle')) return <IdlePromptView />
  return <MainApp />
}

function MainApp() {
  const { ready, catalog } = useData()
  const [view, setView] = useState<View>('timer')

  // Start new users on Projects, since a timer needs a project.
  useEffect(() => {
    if (ready && catalog.projects.length === 0) setView((v) => (v === 'timer' ? 'projects' : v))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  if (!ready) return null

  return (
    <div className="app">
      <nav className="topnav" aria-label="Main navigation">
        <button type="button" className="brand" onClick={() => setView('timer')} title="Go to the timer">
          <Logo />
          <span>Timekeeper</span>
        </button>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="navlink" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
            <Icon />
            {label}
          </button>
        ))}
        {view !== 'timer' && <RunningStatus onOpen={() => setView('timer')} />}
      </nav>
      {view === 'timer' && <TimerView onGoToProjects={() => setView('projects')} />}
      {view === 'reports' && <ReportsView onGoToSettings={() => setView('settings')} />}
      {view === 'projects' && <ProjectsView />}
      {view === 'settings' && <SettingsView />}
    </div>
  )
}

function RunningStatus({ onOpen }: { onOpen(): void }) {
  const { running, labelFor, projectById } = useData()
  const now = useNow(1000, !!running)
  if (!running) return null
  return (
    <button type="button" className="navlink nav-status" onClick={onOpen} title="Go to the timer">
      <span className="dot" style={{ background: projectById.get(running.projectId)?.color }} />
      <span className="ellipsis" style={{ maxWidth: 220 }}>{labelFor(running.projectId)}</span>
      <span className="mono" style={{ color: 'var(--text)' }}>{formatClock(entrySeconds(running.start, null, now))}</span>
    </button>
  )
}
