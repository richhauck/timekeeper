import { Fragment, useMemo, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '@shared/markdown'

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>
      case 'br':
        return <br key={i} />
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'strong':
        return <strong key={i}>{inline(n.children)}</strong>
      case 'em':
        return <em key={i}>{inline(n.children)}</em>
      case 'del':
        return <del key={i}>{inline(n.children)}</del>
      case 'link':
        // target=_blank routes through the main process, which opens it in the system browser.
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {inline(n.children)}
          </a>
        )
    }
  })
}

function block(b: Block, i: number): ReactNode {
  switch (b.type) {
    case 'p':
      return <p key={i}>{inline(b.children)}</p>
    case 'h': {
      const H = `h${Math.min(b.level + 2, 6)}` as 'h3'
      return <H key={i}>{inline(b.children)}</H>
    }
    case 'ul':
    case 'ol': {
      const L = b.type
      const tasks = b.items.some((it) => it.checked !== undefined)
      return (
        <L key={i} start={b.type === 'ol' && b.start !== 1 ? b.start : undefined} className={tasks ? 'tasks' : undefined}>
          {b.items.map((it, j) => (
            <li key={j}>
              {it.checked !== undefined && <input type="checkbox" checked={it.checked} readOnly disabled aria-label={it.checked ? 'Done' : 'Not done'} />}
              {inline(it.children)}
            </li>
          ))}
        </L>
      )
    }
    case 'quote':
      return <blockquote key={i}>{b.children.map(block)}</blockquote>
    case 'pre':
      return (
        <pre key={i}>
          <code>{b.text}</code>
        </pre>
      )
    case 'hr':
      return <hr key={i} />
  }
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className={`md${className ? ` ${className}` : ''}`}>{blocks.map(block)}</div>
}
