import { useData } from '../data'
import { projectLabel } from '@shared/reports'

interface Props {
  value: number | null
  onChange(projectId: number): void
  id?: string
  className?: string
  ariaLabel?: string
  /** Include this archived project even though archived ones are hidden. */
  includeId?: number | null
  placeholder?: string
  style?: React.CSSProperties
}

/** Native select of projects, grouped by client. Archived projects are hidden. */
export function ProjectSelect({ value, onChange, id, className = 'select', ariaLabel, includeId, placeholder = 'Choose a project', style }: Props) {
  const { catalog } = useData()
  const visible = catalog.projects.filter((p) => !p.archived || p.id === includeId || p.id === value)
  const groups = new Map<string, typeof visible>()
  for (const p of visible) {
    const client = p.clientId != null ? catalog.clients.find((c) => c.id === p.clientId)?.name ?? 'No client' : 'No client'
    groups.set(client, [...(groups.get(client) ?? []), p])
  }
  const names = [...groups.keys()].sort((a, b) => (a === 'No client' ? 1 : b === 'No client' ? -1 : a.localeCompare(b)))
  return (
    <select
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={value ?? ''}
      style={style}
      onChange={(e) => e.target.value && onChange(Number(e.target.value))}
    >
      {value == null && (
        <option value="" disabled>
          {visible.length ? placeholder : 'Create a project first'}
        </option>
      )}
      {names.map((name) => (
        <optgroup key={name} label={name}>
          {groups.get(name)!.map((p) => (
            <option key={p.id} value={p.id}>
              {projectLabel(p.code, p.name)}
              {p.archived ? ' (archived)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
