import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from './Icons'

interface Option {
  id: number
  label: string
  color?: string
}

interface Props {
  options: Option[]
  value: number[]
  onChange(ids: number[]): void
  allLabel: string
  noun: string
}

/** A button that opens a checklist. An empty selection means "all". */
export function MultiSelect({ options, value, onChange, allLabel, noun }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const selected = options.filter((o) => value.includes(o.id))
  const text = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0].label : `${selected.length} ${noun}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn" style={{ height: 36, fontSize: 13, fontWeight: 400 }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ellipsis" style={{ maxWidth: 200 }}>{text}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="popover">
          {options.length === 0 && <div className="option muted">Nothing here yet</div>}
          {options.length > 0 && (
            <button type="button" className="option" onClick={() => onChange([])}>
              <span style={{ fontWeight: 600 }}>{allLabel}</span>
            </button>
          )}
          {options.map((o) => (
            <label key={o.id} className="option" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                style={{ accentColor: 'var(--accent)' }}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
              />
              {o.color && <span className="dot" style={{ background: o.color }} />}
              <span className="ellipsis">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
