/**
 * A small, safe Markdown parser for entry descriptions. It produces a plain
 * tree (never HTML strings), so the renderer can't be tricked into injecting
 * markup. Supports the common subset: paragraphs with soft line breaks,
 * headings, bullet/numbered/task lists, block quotes, fenced code, rules,
 * and inline bold, italic, strikethrough, code, links and bare URLs.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'p'; children: Inline[] }
  | { type: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'ul' | 'ol'; start?: number; items: { checked?: boolean; children: Inline[] }[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'pre'; text: string }
  | { type: 'hr' }

const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line)
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++ // closing fence (or end of input)
      out.push({ type: 'pre', text: body.join('\n') })
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      out.push({ type: 'h', level: h[1].length as 1, children: parseInline(h[2]) })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ type: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && lines[i].trim() && QUOTE.test(lines[i])) body.push(lines[i++].match(QUOTE)![1])
      out.push({ type: 'quote', children: parseMarkdown(body.join('\n')) })
      continue
    }
    const ordered = ORDERED.test(line)
    if (ordered || BULLET.test(line)) {
      const re = ordered ? ORDERED : BULLET
      const items: { checked?: boolean; children: Inline[] }[] = []
      const start = ordered ? Number(line.match(ORDERED)![1]) : undefined
      while (i < lines.length && re.test(lines[i])) {
        const m = lines[i].match(re)!
        let text = ordered ? m[2] : m[1]
        i++
        // Indented continuation lines belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !startsBlock(lines[i])) text += '\n' + lines[i++].trim()
        const task = text.match(TASK)
        items.push(task ? { checked: task[1] !== ' ', children: parseInline(task[2]) } : { children: parseInline(text) })
      }
      out.push(ordered ? { type: 'ol', start, items } : { type: 'ul', items })
      continue
    }
    const body: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++])
    out.push({ type: 'p', children: parseInline(body.map((l) => l.trim()).join('\n')) })
  }
  return out
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function safeHref(href: string): string | null {
  const h = href.trim()
  if (SAFE_HREF.test(h)) return h
  if (/^www\./i.test(h)) return `https://${h}`
  return null
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && /[\\`*_~[\]()#>+\-.!]/.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (c === '\n') {
      flush()
      out.push({ type: 'br' })
      i++
      continue
    }
    if (c === '`') {
      const m = rest.match(/^(`+)([\s\S]*?[^`])\1(?!`)/)
      if (m) {
        flush()
        out.push({ type: 'code', text: m[2].replace(/^ (.*) $/, '$1') })
        i += m[0].length
        continue
      }
    }
    if (c === '[') {
      const m = rest.match(/^\[((?:\\.|[^\]\\])+)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/)
      const href = m && safeHref(m[2])
      if (m && href) {
        flush()
        out.push({ type: 'link', href, children: parseInline(m[1]) })
        i += m[0].length
        continue
      }
    }
    if (c === 'h' || c === 'w' || c === 'H' || c === 'W') {
      const prev = i > 0 ? src[i - 1] : ' '
      const m = /[\s(]/.test(prev) || i === 0 ? rest.match(/^(?:https?:\/\/|www\.)[^\s<>]+/i) : null
      if (m) {
        const url = m[0].replace(/[.,;:!?'")\]]+$/, '')
        flush()
        out.push({ type: 'link', href: safeHref(url)!, children: [{ type: 'text', text: url }] })
        i += url.length
        continue
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      const run = rest.match(/^([*_~])\1*/)![0]
      const prev = i > 0 ? src[i - 1] : ' '
      // Underscores inside words (snake_case) stay literal.
      const opens = !(c === '_' && /\w/.test(prev)) && rest.length > run.length && !/\s/.test(rest[run.length])
      let matched = false
      if (opens) {
        const lens = c === '~' ? (run.length >= 2 ? [2] : []) : [3, 2, 1].filter((n) => n <= run.length)
        for (const len of lens) {
          const marker = c.repeat(len)
          const close = findClose(src, i + len, marker)
          if (close > i + len) {
            const inner = parseInline(src.slice(i + len, close))
            flush()
            if (len === 3) out.push({ type: 'strong', children: [{ type: 'em', children: inner }] })
            else out.push({ type: c === '~' ? 'del' : len === 2 ? 'strong' : 'em', children: inner })
            i = close + len
            matched = true
            break
          }
        }
      }
      if (matched) continue
      buf += run
      i += run.length
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/** Index of the closing emphasis marker, or -1. Skips code spans and escapes. */
function findClose(src: string, from: number, marker: string): number {
  const c = marker[0]
  for (let j = from; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', j + 1)
      if (end !== -1) j = end
      continue
    }
    if (src.startsWith(marker, j) && src[j + marker.length] !== c && !/\s/.test(src[j - 1])) {
      if (c === '_' && /\w/.test(src[j + marker.length] ?? '')) continue
      return j
    }
  }
  return -1
}

/** Plain-text version of a description: markdown markers removed, lines joined. */
export function markdownToPlain(src: string): string {
  const text = (nodes: Inline[]): string =>
    nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : n.type === 'br' ? ' ' : 'children' in n ? text(n.children) : '')).join('')
  const block = (b: Block): string[] => {
    switch (b.type) {
      case 'p':
      case 'h':
        return [text(b.children)]
      case 'ul':
      case 'ol':
        return b.items.map((it) => text(it.children))
      case 'quote':
        return b.children.flatMap(block)
      case 'pre':
        return [b.text]
      case 'hr':
        return []
    }
  }
  return parseMarkdown(src).flatMap(block).join(' · ').replace(/\s+/g, ' ').trim()
}
