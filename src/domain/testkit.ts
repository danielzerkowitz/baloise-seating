import { LIMITS } from './limits'
import { isSeatable, sameSeating } from './model'
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  WEEKDAYS,
  type Area,
  type AreaKind,
  type Art,
  type DayWish,
  type Domain,
  type Floor,
  type Project,
  type Rect,
  type Seating,
  type Settings,
  type Team,
  type Weekday,
} from './types'

/* Builders and checks for tests. Ids are whatever you pass, so tests read well:
   area('a1', 4), team('alpha', 8, ['tue', 'thu'], { a1: 4 }). Not used by the app. */

export function area(id: string, capacity: number, options: { kind?: AreaKind; rect?: Rect; name?: string } = {}): Area {
  return {
    id,
    name: options.name ?? id.toUpperCase(),
    kind: options.kind ?? 'desks',
    capacity,
    rect: options.rect ?? { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
  }
}

/** Areas laid out left to right in one row with a small gap between them, so that neighbours
 *  in the list, and only those, are neighbours on the plan. Up to eight areas are a tenth
 *  of the plan wide; a longer row is drawn narrower so that it stays inside the plan. */
export function row(ids: readonly string[], capacity: number, y = 0.1): Area[] {
  const scale = Math.min(1, 8 / ids.length)
  return ids.map((id, i) => area(id, capacity, { rect: { x: 0.05 + i * 0.11 * scale, y, w: 0.1 * scale, h: 0.2 } }))
}

export function floor(id: string, areas: Area[], options: { name?: string; label?: string } = {}): Floor {
  return { id, name: options.name ?? `Floor ${id}`, label: options.label ?? id.slice(0, 3), plan: null, areas }
}

export function team(
  id: string,
  size: number,
  days: readonly Weekday[] = [],
  seating: Seating = {},
  options: Partial<Omit<Team, 'id' | 'size' | 'days' | 'seating'>> = {},
): Team {
  const wishes = {} as Record<Weekday, DayWish>
  for (const d of WEEKDAYS) wishes[d] = days.includes(d) ? 'want' : 'none'
  return {
    id,
    name: options.name ?? id.charAt(0).toUpperCase() + id.slice(1),
    code: options.code ?? id.slice(0, 3).toUpperCase(),
    size,
    color: options.color ?? '#0f8b8d',
    domainId: options.domainId ?? null,
    artId: options.artId ?? null,
    wishes: options.wishes ?? wishes,
    days: WEEKDAYS.filter((d) => days.includes(d)),
    attendance: options.attendance ?? null,
    homeFloorId: options.homeFloorId ?? null,
    seating,
    daySeating: options.daySeating ?? {},
    notes: options.notes ?? '',
  }
}

export function project(
  floors: Floor[],
  teams: Team[] = [],
  settings: Partial<Settings> = {},
  org: { domains?: Domain[]; arts?: Art[] } = {},
): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Test plan',
    floors,
    // Unless given, the domains and ARTs are those the teams refer to, named after their ids
    // (an ART on the domain of its first team).
    domains: org.domains ?? [...new Set(teams.map((t) => t.domainId).filter((id) => id !== null))].map((id) => ({ id, name: id })),
    arts:
      org.arts ??
      [...new Set(teams.map((t) => t.artId).filter((id) => id !== null))].map((id) => ({
        id,
        name: id,
        domainId: teams.find((t) => t.artId === id)?.domainId ?? null,
      })),
    teams,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    accepted: {},
  }
}

/** Every way in which a project breaks the invariants listed in types.ts. Empty when it is
 *  sound. Use in tests: expect(violations(p)).toEqual([]). */
export function violations(p: Project): string[] {
  const out: string[] = []
  const isCount = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0

  const floorIds = new Set<string>()
  const areaKinds = new Map<string, AreaKind>()
  for (const f of p.floors) {
    if (floorIds.has(f.id)) out.push(`duplicate floor id ${f.id}`)
    floorIds.add(f.id)
    if (f.label.length > 3) out.push(`floor ${f.id}: label longer than 3 characters`)
    for (const a of f.areas) {
      if (areaKinds.has(a.id)) out.push(`duplicate area id ${a.id}`)
      areaKinds.set(a.id, a.kind)
      if (!isCount(a.capacity)) out.push(`area ${a.id}: capacity ${a.capacity} is not a whole number >= 0`)
      const { x, y, w, h } = a.rect
      const inside =
        [x, y, w, h].every((n) => Number.isFinite(n)) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9
      if (!inside) out.push(`area ${a.id}: rectangle outside the plan`)
    }
  }

  const checkSeating = (who: string, seating: Seating) => {
    for (const [areaId, seats] of Object.entries(seating)) {
      if (!areaKinds.has(areaId)) out.push(`${who}: seats in missing area ${areaId}`)
      if (!isCount(seats) || seats < 1) out.push(`${who}: seat count ${seats} in ${areaId} is not a whole number >= 1`)
    }
  }

  const domainIds = new Set<string>()
  for (const d of p.domains) {
    if (domainIds.has(d.id)) out.push(`duplicate domain id ${d.id}`)
    domainIds.add(d.id)
    if (d.name.length > LIMITS.orgName) out.push(`domain ${d.id}: name longer than ${LIMITS.orgName}`)
  }
  const artDomain = new Map<string, string | null>()
  for (const a of p.arts) {
    if (artDomain.has(a.id)) out.push(`duplicate ART id ${a.id}`)
    artDomain.set(a.id, a.domainId)
    if (a.name.length > LIMITS.orgName) out.push(`ART ${a.id}: name longer than ${LIMITS.orgName}`)
    if (a.domainId !== null && !domainIds.has(a.domainId)) out.push(`ART ${a.id}: domain is missing`)
  }

  const teamIds = new Set<string>()
  for (const t of p.teams) {
    if (t.domainId !== null && !domainIds.has(t.domainId)) out.push(`team ${t.id}: domain is missing`)
    if (t.artId !== null) {
      if (!artDomain.has(t.artId)) out.push(`team ${t.id}: ART is missing`)
      else if (artDomain.get(t.artId) !== t.domainId) out.push(`team ${t.id}: domain is not its ART's domain`)
    }
    if (teamIds.has(t.id)) out.push(`duplicate team id ${t.id}`)
    teamIds.add(t.id)
    if (!isCount(t.size)) out.push(`team ${t.id}: size ${t.size} is not a whole number >= 0`)
    if (t.code.length > 4) out.push(`team ${t.id}: code longer than 4 characters`)
    if (!/^#[0-9a-f]{6}$/.test(t.color)) out.push(`team ${t.id}: colour ${t.color} is not #rrggbb`)
    const sorted = WEEKDAYS.filter((d) => t.days.includes(d))
    if (sorted.length !== t.days.length || sorted.some((d, i) => d !== t.days[i])) {
      out.push(`team ${t.id}: days are not unique and in week order`)
    }
    for (const d of WEEKDAYS) {
      if (!['want', 'can', 'none', 'cannot'].includes(t.wishes[d])) out.push(`team ${t.id}: wish for ${d} is invalid`)
    }
    if (t.attendance !== null && !(t.attendance > 0 && t.attendance <= 1)) {
      out.push(`team ${t.id}: attendance ${t.attendance} outside (0, 1]`)
    }
    if (t.homeFloorId !== null && !floorIds.has(t.homeFloorId)) out.push(`team ${t.id}: preferred floor is missing`)
    checkSeating(`team ${t.id}`, t.seating)
    if (t.days.length > 0 && t.days.every((d) => t.daySeating[d] !== undefined)) {
      out.push(`team ${t.id}: every team day has its own seating, so the normal seating is hidden`)
    }
    for (const [day, seating] of Object.entries(t.daySeating) as [Weekday, Seating | undefined][]) {
      if (seating === undefined) {
        out.push(`team ${t.id}: day seating for ${day} is undefined`)
        continue
      }
      if (!t.days.includes(day)) out.push(`team ${t.id}: day seating on ${day}, which is not a team day`)
      if (sameSeating(seating, t.seating)) out.push(`team ${t.id}: day seating on ${day} equals the normal seating`)
      checkSeating(`team ${t.id} on ${day}`, seating)
    }
  }

  if (!(p.settings.attendance > 0 && p.settings.attendance <= 1)) out.push('settings: attendance outside (0, 1]')
  if (!(p.settings.reserve >= 0 && p.settings.reserve <= 0.5)) out.push('settings: reserve outside [0, 0.5]')
  return out
}

/** True when the kind allows seating; re-exported so tests need one import. */
export const seatable = isSeatable
