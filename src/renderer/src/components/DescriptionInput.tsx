import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Markdown } from './Markdown'

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange(value: string): void
  /** Called on Enter (without Shift). Shift+Enter inserts a new line. */
  onSubmit?(): void
}

/** A textarea that grows with its content. Enter submits; Shift+Enter adds a line. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function AutoTextarea({ value, onChange, onSubmit, onKeyDown, style, ...rest }, fwd) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(fwd, () => ref.current!)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }, [value])
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      style={{ resize: 'none', overflow: 'hidden', ...style }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
      }}
    />
  )
})

interface FieldProps {
  value: string
  onSave(value: string): void
  ariaLabel: string
  placeholder: string
}

/**
 * Shows a description rendered as Markdown; click (or focus + Enter) to edit
 * the source. Enter or leaving the field saves, Shift+Enter adds a line,
 * Escape cancels.
 */
export function DescriptionField({ value, onSave, ariaLabel, placeholder }: FieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)

  useLayoutEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const begin = () => {
    setDraft(value)
    cancelled.current = false
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (!cancelled.current && draft !== value) onSave(draft)
  }

  if (editing) {
    return (
      <AutoTextarea
        ref={ref}
        className="inl"
        aria-label={ariaLabel}
        aria-description="Markdown supported. Shift+Enter for a new line."
        placeholder={placeholder}
        value={draft}
        style={{ display: 'block', width: '100%', minHeight: 30, padding: '4px 5px', fontSize: 14, lineHeight: '20px' }}
        onChange={setDraft}
        onSubmit={() => ref.current?.blur()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            ref.current?.blur()
          }
        }}
      />
    )
  }

  return (
    <div
      className="inl desc-view"
      role="textbox"
      aria-label={ariaLabel}
      aria-readonly="false"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        begin()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault()
          begin()
        }
      }}
    >
      {value.trim() ? <Markdown text={value} /> : <span className="placeholder">{placeholder}</span>}
    </div>
  )
}
