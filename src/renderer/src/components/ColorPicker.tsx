import { useEffect, useState } from 'react'

export const PRESETS: [string, string][] = [
  ['#12877A', 'Teal'],
  ['#2B7FB8', 'Blue'],
  ['#2457C5', 'Indigo'],
  ['#7A4FC9', 'Purple'],
  ['#C93E77', 'Pink'],
  ['#B42318', 'Red'],
  ['#D9692B', 'Orange'],
  ['#B7860B', 'Gold'],
  ['#4E8A2E', 'Green'],
  ['#8A94A3', 'Gray']
]

interface HSV {
  h: number
  s: number
  v: number
}

export function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: HSV): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let [r, g, b] = [0, 0, 0]
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

interface Props {
  value: string
  onChange(hex: string): void
}

/** Saturation/brightness area, hue slider, preset swatches and a hex field. */
export function ColorPicker({ value, onChange }: Props) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value))
  const [hexText, setHexText] = useState(value)

  // Follow outside changes (another project selected) without fighting our own drags.
  useEffect(() => {
    if (hsvToHex(hsv) !== value.toUpperCase()) setHsv(hexToHsv(value))
    setHexText(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = (next: HSV) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setHexText(hex)
    onChange(hex)
  }

  const drag = (apply: (x: number, y: number) => void) => (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect()
      apply(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    move(e)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const hueColor = `hsl(${Math.round(hsv.h)}, 100%, 50%)`
  const current = value.toUpperCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div
          role="presentation"
          onPointerDown={drag((x, y) => commit({ h: hsv.h, s: x, v: 1 - y }))}
          style={{
            position: 'relative',
            flex: 1,
            height: 96,
            borderRadius: 8,
            cursor: 'crosshair',
            touchAction: 'none',
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueColor})`
          }}
        >
          <span
            style={{
              position: 'absolute',
              width: 14,
              height: 14,
              margin: '-7px 0 0 -7px',
              border: '2px solid #fff',
              borderRadius: '50%',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              background: current,
              pointerEvents: 'none'
            }}
          />
        </div>
        <div style={{ width: 118, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ height: 50, borderRadius: 8, background: current, border: '1px solid var(--border)' }} />
          <label className="sr-only" htmlFor="hex-input">
            Hex color
          </label>
          <input
            id="hex-input"
            className="input mono"
            value={hexText}
            maxLength={7}
            style={{ height: 40, fontSize: 13, textTransform: 'uppercase' }}
            onChange={(e) => {
              let v = e.target.value.trim()
              if (v && !v.startsWith('#')) v = `#${v}`
              setHexText(v)
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                setHsv(hexToHsv(v))
                onChange(v.toUpperCase())
              }
            }}
          />
        </div>
      </div>
      <div
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const step = e.shiftKey ? 30 : 5
            commit({ ...hsv, h: (hsv.h + (e.key === 'ArrowRight' ? step : -step) + 360) % 360 })
          }
        }}
        onPointerDown={drag((x) => commit({ ...hsv, h: Math.min(359.9, x * 360) }))}
        style={{
          position: 'relative',
          height: 12,
          borderRadius: 6,
          cursor: 'pointer',
          touchAction: 'none',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: -3,
            width: 14,
            height: 14,
            marginLeft: -7,
            border: '2px solid #fff',
            borderRadius: '50%',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            left: `${(hsv.h / 360) * 100}%`,
            background: hueColor,
            pointerEvents: 'none'
          }}
        />
      </div>
      <div role="group" aria-label="Preset colors" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {PRESETS.map(([hex, name]) => (
          <button
            key={hex}
            type="button"
            aria-label={name}
            aria-pressed={current === hex}
            onClick={() => {
              setHsv(hexToHsv(hex))
              setHexText(hex)
              onChange(hex)
            }}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: '50%',
              border: `2px solid ${current === hex ? 'var(--text)' : 'transparent'}`,
              background: hex,
              backgroundClip: 'padding-box',
              boxShadow: 'inset 0 0 0 2px var(--surface)'
            }}
          />
        ))}
      </div>
    </div>
  )
}
