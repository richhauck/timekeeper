import { useMemo, useRef, useState } from 'react'
import { useData } from '../data'
import { CloseIcon } from './Icons'

interface Props {
  value: string[]
  onChange(names: string[]): void
  label?: string
  compact?: boolean
}

/** Tag chips with a type-ahead field. Enter or comma adds a tag; new names are created on save. */
export function TagInput({ value, onChange, label = 'Tags', compact }: Props) {
  const { catalog } = useData()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase()
    const taken = new Set(value.map((v) => v.toLowerCase()))
    return catalog.tags.filter((t) => !taken.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8)
  }, [catalog.tags, text, value])

  const add = (name: string) => {
    const n = name.trim().replace(/,$/, '').trim()
    if (!n) return
    if (!value.some((v) => v.toLowerCase() === n.toLowerCase())) onChange([...value, n])
    setText('')
    setActive(0)
  }

  const exact = suggestions.find((s) => s.name.toLowerCase() === text.trim().toLowerCase())

  return (
    <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {!compact && <span className="label" style={{ marginRight: 4 }}>{label}</span>}
      {value.map((name) => (
        <span className="chip" key={name}>
          {name}
          <button type="button" aria-label={`Remove tag ${name}`} onClick={() => onChange(value.filter((v) => v !== name))}>
            <CloseIcon size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="inl"
        aria-label={value.length ? 'Add another tag' : 'Add tags'}
        placeholder={value.length ? '+ tag' : '+ Add tag'}
        value={text}
        style={{ width: 110, height: 30, padding: '0 8px', fontSize: 13 }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false)
            if (text.trim()) add(text)
          }, 120)
        }
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) add(v)
          else {
            setText(v)
            setOpen(true)
            setActive(0)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (open && suggestions[active] && (text.trim() === '' || !exact)) add(suggestions[active].name)
            else add(text)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, suggestions.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1))
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (suggestions.length > 0 || text.trim()) && (
        <div className="popover" role="listbox" style={{ left: compact ? 0 : 40 }}>
          {suggestions.map((s, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              key={s.id}
              className={`option${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                add(s.name)
                inputRef.current?.focus()
              }}
            >
              {s.name}
            </button>
          ))}
          {text.trim() && !exact && (
            <button type="button" className="option" onMouseDown={(e) => e.preventDefault()} onClick={() => add(text)}>
              Create tag “{text.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  )
}
