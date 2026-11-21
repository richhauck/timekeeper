import type { RoundingMode, Settings } from './types'

/**
 * Round a duration in seconds to the configured increment.
 * Rounding applies to each entry on its own; an increment of 0 leaves the
 * duration exact.
 */
export function roundSeconds(seconds: number, incrementMinutes: number, mode: RoundingMode): number {
  const s = Math.max(0, seconds)
  if (!incrementMinutes || incrementMinutes <= 0) return s
  const step = incrementMinutes * 60
  const q = s / step
  // Guard against floating point noise such as 2.0000000001 rounding up.
  const eps = 1e-9
  let n: number
  if (mode === 'up') n = Math.ceil(q - eps)
  else if (mode === 'down') n = Math.floor(q + eps)
  else n = Math.floor(q + 0.5 + eps)
  return Math.max(0, n) * step
}

export function roundForSettings(seconds: number, settings: Pick<Settings, 'roundingMinutes' | 'roundingMode'>): number {
  return roundSeconds(seconds, settings.roundingMinutes, settings.roundingMode)
}

export function describeRounding(settings: Pick<Settings, 'roundingMinutes' | 'roundingMode'>): string {
  if (!settings.roundingMinutes) return 'Rounding off'
  const mode = settings.roundingMode === 'nearest' ? 'nearest' : settings.roundingMode === 'up' ? 'always up to' : 'always down to'
  return `Rounding: ${mode} ${settings.roundingMinutes} min per entry`
}
