import { describe, expect, it } from 'vitest'
import { TEAM_COLORS, contrast, luminance, nextTeamColor, normalizeHex, readableInk, teamStyle } from './color'

const WHITE = '#ffffff'
const BLACK = '#000000'
/** The ink of the design system (`--ink` in tokens.css). */
const INK = '#16233b'
/** What WCAG AA asks of small text, such as the code on a team chip. */
const READABLE = 4.5

/** A coarse walk through the whole colour cube: 16 steps per channel, 4096 colours. */
function colourCube(): string[] {
  const steps = [...'0123456789abcdef']
  const colours: string[] = []
  for (const r of steps) for (const g of steps) for (const b of steps) colours.push(`#${r}${r}${g}${g}${b}${b}`)
  return colours
}

describe('TEAM_COLORS', () => {
  it('holds sixteen different colours', () => {
    expect(TEAM_COLORS).toHaveLength(16)
    expect(new Set(TEAM_COLORS).size).toBe(16)
  })

  it('stores every colour in the normal form, so colours can be compared as text', () => {
    for (const color of TEAM_COLORS) expect(normalizeHex(color)).toBe(color)
  })
})

describe('normalizeHex', () => {
  it.each([
    ['#0f8b8d', '#0f8b8d'],
    ['#0F8B8D', '#0f8b8d'],
    ['0f8b8d', '#0f8b8d'],
    ['0F8B8D', '#0f8b8d'],
    ['#abc', '#aabbcc'],
    ['ABC', '#aabbcc'],
    ['#000', '#000000'],
    ['  #AbCdEf \n', '#abcdef'],
  ])('reads %j as %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected)
  })

  it.each([
    '',
    '#',
    '#1',
    '#12',
    '#1234',
    '#12345',
    '#1234567',
    '#12345678',
    'red',
    '#ggg',
    '#12345g',
    '##123456',
    '#12 34 56',
    'rgb(15, 139, 141)',
    '0x0f8b8d',
  ])('refuses %j', (input) => {
    expect(normalizeHex(input)).toBeNull()
  })
})

describe('luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(luminance(BLACK)).toBe(0)
    expect(luminance(WHITE)).toBeCloseTo(1, 12)
  })

  it('weighs red, green and blue as WCAG does', () => {
    expect(luminance('#ff0000')).toBeCloseTo(0.2126, 6)
    expect(luminance('#00ff00')).toBeCloseTo(0.7152, 6)
    expect(luminance('#0000ff')).toBeCloseTo(0.0722, 6)
  })

  it('is not linear in the hex value: mid grey is much darker than half', () => {
    expect(luminance('#808080')).toBeCloseTo(0.2159, 4)
  })

  it('uses the linear part of the curve for the darkest values', () => {
    // 0x0a / 255 is below the 0.03928 knee: the channel is divided by 12.92.
    expect(luminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 12)
  })

  it('reads any spelling normalizeHex accepts', () => {
    expect(luminance('FFF')).toBeCloseTo(1, 12)
    expect(luminance(' #F00 ')).toBeCloseTo(0.2126, 6)
  })

  it('counts input that is not a colour as mid grey', () => {
    expect(luminance('nonsense')).toBe(0.5)
    expect(luminance('')).toBe(0.5)
  })
})

describe('contrast', () => {
  it('is 21 between black and white, in either order', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 10)
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 10)
  })

  it('is 1 between a colour and itself', () => {
    for (const color of [BLACK, WHITE, INK, ...TEAM_COLORS]) expect(contrast(color, color)).toBe(1)
  })

  it('agrees with the well-known greys on either side of 4.5 against white', () => {
    expect(contrast('#767676', WHITE)).toBeCloseTo(4.54, 2)
    expect(contrast('#777777', WHITE)).toBeCloseTo(4.48, 2)
  })

  it('is never below 1', () => {
    for (const color of TEAM_COLORS) {
      expect(contrast(color, INK)).toBeGreaterThanOrEqual(1)
      expect(contrast(INK, color)).toBe(contrast(color, INK))
    }
  })
})

describe('readableInk', () => {
  it('is white on a dark background and ink on a light one', () => {
    expect(readableInk(BLACK)).toBe(WHITE)
    expect(readableInk(INK)).toBe(WHITE)
    expect(readableInk(WHITE)).toBe(INK)
    expect(readableInk('#f5f6f8')).toBe(INK)
  })

  it.each([...TEAM_COLORS])('reads on team colour %s with a contrast of 4.5 or more', (color) => {
    expect(contrast(color, readableInk(color))).toBeGreaterThanOrEqual(READABLE)
  })

  it('reads on any background, also on the mid-tones where white and ink both fall short', () => {
    // A planner can type any hex value for a team, so the palette is not the whole story.
    const tooFaint = colourCube().filter((color) => contrast(color, readableInk(color)) < READABLE)
    expect(tooFaint.slice(0, 8), `${tooFaint.length} of 4096 backgrounds get a text colour that is too faint`).toEqual([])
  })

  it('keeps white or ink wherever one of them is readable, and then picks the better one', () => {
    const unexpected: string[] = []
    for (const color of colourCube()) {
      const onWhite = contrast(color, WHITE)
      const onInk = contrast(color, INK)
      if (Math.max(onWhite, onInk) < READABLE) continue
      const expected = onWhite >= onInk ? WHITE : INK
      if (readableInk(color) !== expected) unexpected.push(color)
    }
    expect(unexpected.slice(0, 8), `${unexpected.length} backgrounds lost their white or ink text`).toEqual([])
  })

  it('answers with a colour in the normal form', () => {
    for (const color of colourCube()) {
      const ink = readableInk(color)
      expect(normalizeHex(ink)).toBe(ink)
    }
  })

  it('treats input that is not a colour as mid grey', () => {
    expect(readableInk('nonsense')).toBe(INK)
  })
})

describe('nextTeamColor', () => {
  it('starts with the first palette colour', () => {
    expect(nextTeamColor([])).toBe(TEAM_COLORS[0])
  })

  it('hands out all sixteen colours in palette order before one repeats', () => {
    const used: string[] = []
    for (let i = 0; i < TEAM_COLORS.length; i += 1) used.push(nextTeamColor(used))
    expect(used).toEqual([...TEAM_COLORS])
    expect(nextTeamColor(used)).toBe(TEAM_COLORS[0])
  })

  it('picks the colour used least, the earlier one on a tie', () => {
    const [first, second, third] = TEAM_COLORS
    expect(nextTeamColor([first, first, second])).toBe(third)
    // Everything used once, the first three twice: the fourth is the first of the least used.
    expect(nextTeamColor([...TEAM_COLORS, first, second, third])).toBe(TEAM_COLORS[3])
    // A gap left by a removed team is filled before the palette moves on.
    expect(nextTeamColor([first, third])).toBe(second)
  })

  it('recognises a palette colour in any spelling', () => {
    expect(nextTeamColor(['#0F8B8D'])).toBe(TEAM_COLORS[1])
    expect(nextTeamColor(['0f8b8d'])).toBe(TEAM_COLORS[1])
  })

  it('ignores colours that are not in the palette', () => {
    expect(nextTeamColor(['#123456', 'nonsense', ''])).toBe(TEAM_COLORS[0])
  })
})

describe('teamStyle', () => {
  it('sets the team colour and a text colour that reads on it', () => {
    for (const color of TEAM_COLORS) {
      const style = teamStyle(color)
      expect(style['--team']).toBe(color)
      expect(style['--team-ink']).toBe(readableInk(color))
      expect(contrast(style['--team'], style['--team-ink'])).toBeGreaterThanOrEqual(READABLE)
    }
  })

  it('writes the colour in the normal form', () => {
    expect(teamStyle('#2F6FDE')['--team']).toBe('#2f6fde')
    expect(teamStyle('abc')['--team']).toBe('#aabbcc')
  })

  it('falls back to the first palette colour for input that is not a colour', () => {
    expect(teamStyle('nonsense')).toEqual(teamStyle(TEAM_COLORS[0]))
    expect(teamStyle('nonsense')['--team']).toBe(TEAM_COLORS[0])
  })
})
