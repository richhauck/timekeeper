import { describe, expect, it } from 'vitest'
import { roundSeconds } from '@shared/rounding'

const min = (m: number) => m * 60

describe('roundSeconds', () => {
  it('rounds to the nearest 15 minutes by default rules', () => {
    expect(roundSeconds(min(8), 15, 'nearest')).toBe(min(15))
    expect(roundSeconds(min(7), 15, 'nearest')).toBe(0)
    expect(roundSeconds(min(68), 15, 'nearest')).toBe(min(75))
    expect(roundSeconds(min(92), 15, 'nearest')).toBe(min(90))
    expect(roundSeconds(min(7.5), 15, 'nearest')).toBe(min(15))
  })

  it('rounds up and down', () => {
    expect(roundSeconds(min(16), 15, 'up')).toBe(min(30))
    expect(roundSeconds(min(15), 15, 'up')).toBe(min(15))
    expect(roundSeconds(min(29), 15, 'down')).toBe(min(15))
    expect(roundSeconds(min(30), 15, 'down')).toBe(min(30))
  })

  it('supports every increment and leaves time exact when off', () => {
    expect(roundSeconds(min(22), 6, 'nearest')).toBe(min(24))
    expect(roundSeconds(min(22), 10, 'nearest')).toBe(min(20))
    expect(roundSeconds(min(22), 30, 'nearest')).toBe(min(30))
    expect(roundSeconds(min(22) + 31, 1, 'nearest')).toBe(min(23))
    expect(roundSeconds(1234, 0, 'nearest')).toBe(1234)
  })

  it('never returns negative time', () => {
    expect(roundSeconds(-100, 15, 'up')).toBe(0)
  })
})
