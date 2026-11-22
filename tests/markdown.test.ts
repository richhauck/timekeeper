import { describe, expect, it } from 'vitest'
import { markdownToPlain, parseInline, parseMarkdown } from '@shared/markdown'

describe('parseInline', () => {
  it('parses emphasis, code and strikethrough', () => {
    expect(parseInline('a **b** *c* _d_ ~~e~~ `f*g*`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' ' },
      { type: 'del', children: [{ type: 'text', text: 'e' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'f*g*' }
    ])
  })

  it('leaves unmatched markers and snake_case alone', () => {
    expect(parseInline('2 * 3 and some_var_name and **open')).toEqual([{ type: 'text', text: '2 * 3 and some_var_name and **open' }])
  })

  it('handles escapes', () => {
    expect(parseInline('\\*not em\\*')).toEqual([{ type: 'text', text: '*not em*' }])
  })

  it('parses safe links and drops unsafe ones', () => {
    expect(parseInline('[site](https://example.com)')).toEqual([{ type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'site' }] }])
    expect(parseInline('[x](javascript:alert(1))')[0]).toMatchObject({ type: 'text' })
  })

  it('autolinks bare URLs without trailing punctuation', () => {
    expect(parseInline('see https://example.com/a.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'https://example.com/a' }] },
      { type: 'text', text: '.' }
    ])
  })

  it('turns newlines into breaks', () => {
    expect(parseInline('a\nb')).toEqual([{ type: 'text', text: 'a' }, { type: 'br' }, { type: 'text', text: 'b' }])
  })
})

describe('parseMarkdown', () => {
  it('parses blocks', () => {
    const blocks = parseMarkdown('# Title\n\nPara line\nsecond\n\n- one\n- [x] two\n\n1. a\n2. b\n\n> quote\n\n```\ncode *x*\n```\n\n---')
    expect(blocks.map((b) => b.type)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'pre', 'hr'])
    expect(blocks[2]).toEqual({
      type: 'ul',
      items: [{ children: [{ type: 'text', text: 'one' }] }, { checked: true, children: [{ type: 'text', text: 'two' }] }]
    })
    expect(blocks[5]).toEqual({ type: 'pre', text: 'code *x*' })
  })

  it('treats plain single-line text as one paragraph', () => {
    expect(parseMarkdown('Fixed the login bug')).toEqual([{ type: 'p', children: [{ type: 'text', text: 'Fixed the login bug' }] }])
  })
})

describe('markdownToPlain', () => {
  it('strips markers and joins lines', () => {
    expect(markdownToPlain('**Client call**\n- agenda\n- [notes](https://x.io)')).toBe('Client call · agenda · notes')
  })
})
