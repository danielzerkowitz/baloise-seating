import { nextTeamColor } from './color'
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  WEEKDAYS,
  type Area,
  type AreaKind,
  type Art,
  type Domain,
  type DayWish,
  type Floor,
  type Id,
  type PlanImage,
  type Project,
  type Rect,
  type Seating,
  type Settings,
  type Team,
  type Weekday,
} from './types'

/* Everything that is DERIVED from a project: seats needed, who sits where on a day, how
   full a day or a floor is. Pure functions; results for a given project object are cached,
   which is safe because projects are never mutated. */

// ---------------------------------------------------------------------------
// Caching per project snapshot
// ---------------------------------------------------------------------------

function cachedPerProject<T>(compute: (project: Project) => T): (project: Project) => T {
  const cache = new WeakMap<Project, T>()
  return (project) => {
    const hit = cache.get(project)
    if (hit !== undefined) return hit
    const value = compute(project)
    cache.set(project, value)
    return value
  }
}

function cachedPerProjectDay<T>(compute: (project: Project, day: Weekday) => T): (project: Project, day: Weekday) => T {
  const cache = new WeakMap<Project, Partial<Record<Weekday, T>>>()
  return (project, day) => {
    let perDay = cache.get(project)
    if (!perDay) {
      perDay = {}
      cache.set(project, perDay)
    }
    const hit = perDay[day]
    if (hit !== undefined) return hit
    const value = compute(project, day)
    perDay[day] = value
    return value
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** Seats a team needs on a team day: its size times the expected attendance, rounded up.
 *  A team with people always needs at least one seat. */
export function seatsNeeded(team: Team, settings: Settings): number {
  if (!(team.size > 0)) return 0
  const rate = team.attendance ?? settings.attendance
  // Round away floating point noise before rounding up: 10 x 0.8 must give 8, not 9.
  const exact = Math.round(team.size * rate * 1e6) / 1e6
  return Math.max(1, Math.ceil(exact))
}

export function isTeamDay(team: Team, day: Weekday): boolean {
  return team.days.includes(day)
}

/** True when the team sits somewhere else on this day than on its other days. */
export function hasDayException(team: Team, day: Weekday): boolean {
  return team.daySeating[day] !== undefined
}

const NO_SEATS: Seating = Object.freeze({}) as Seating

/** The seats the team holds on a day. Empty on days that are not team days. */
export function seatingOn(team: Team, day: Weekday): Seating {
  if (!team.days.includes(day)) return NO_SEATS
  return team.daySeating[day] ?? team.seating
}

export function sortDays(days: Iterable<Weekday>): Weekday[] {
  const set = new Set(days)
  return WEEKDAYS.filter((d) => set.has(d))
}

export function wishesFromDays(days: readonly Weekday[]): Record<Weekday, DayWish> {
  const wishes = {} as Record<Weekday, DayWish>
  for (const d of WEEKDAYS) wishes[d] = days.includes(d) ? 'want' : 'none'
  return wishes
}

export function sumSeats(seating: Seating): number {
  let total = 0
  for (const id in seating) total += seating[id] ?? 0
  return total
}

export function sameSeating(a: Seating, b: Seating): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

// ---------------------------------------------------------------------------
// Floors and areas
// ---------------------------------------------------------------------------

export interface AreaRef {
  area: Area
  floor: Floor
}

/** Every area of the project by id, with the floor it is on. */
export const indexAreas: (project: Project) => ReadonlyMap<Id, AreaRef> = cachedPerProject((project) => {
  const map = new Map<Id, AreaRef>()
  for (const floor of project.floors) for (const area of floor.areas) map.set(area.id, { area, floor })
  return map
})

export function findTeam(project: Project, teamId: Id | null | undefined): Team | undefined {
  return teamId ? project.teams.find((t) => t.id === teamId) : undefined
}

export function findFloor(project: Project, floorId: Id | null | undefined): Floor | undefined {
  return floorId ? project.floors.find((f) => f.id === floorId) : undefined
}

/** Teams can be seated in desk and overflow areas, never in rooms. */
export function isSeatable(kind: AreaKind): boolean {
  return kind !== 'no-seating'
}

export interface Capacity {
  /** Regular desks. The capacity the planner works with. */
  desks: number
  /** Touchdown and collaboration seats that can absorb a busy day. */
  overflow: number
}

export function floorCapacity(floor: Floor): Capacity {
  let desks = 0
  let overflow = 0
  for (const a of floor.areas) {
    if (a.kind === 'desks') desks += a.capacity
    else if (a.kind === 'overflow') overflow += a.capacity
  }
  return { desks, overflow }
}

export const projectCapacity: (project: Project) => Capacity = cachedPerProject((project) => {
  let desks = 0
  let overflow = 0
  for (const f of project.floors) {
    const c = floorCapacity(f)
    desks += c.desks
    overflow += c.overflow
  }
  return { desks, overflow }
})

/** Width divided by height of the sheet a floor is drawn on. */
export function planAspect(floor: Floor): number {
  if (floor.plan && floor.plan.width > 0 && floor.plan.height > 0) return floor.plan.width / floor.plan.height
  return 2
}

// ---------------------------------------------------------------------------
// Occupancy: who holds how many seats where, on one day
// ---------------------------------------------------------------------------

export interface AreaOccupancy {
  area: Area
  floorId: Id
  /** Teams holding seats here on this day, in team-list order. */
  teams: { teamId: Id; seats: number }[]
  /** Seats held in total. */
  used: number
  /** capacity - used. Negative when the area is over capacity. */
  free: number
}

/** Occupancy of EVERY area on a day (also empty ones), by area id. */
export const dayOccupancy: (project: Project, day: Weekday) => ReadonlyMap<Id, AreaOccupancy> = cachedPerProjectDay(
  (project, day) => {
    const map = new Map<Id, AreaOccupancy>()
    for (const floor of project.floors) {
      for (const area of floor.areas) {
        map.set(area.id, { area, floorId: floor.id, teams: [], used: 0, free: area.capacity })
      }
    }
    for (const team of project.teams) {
      const seating = seatingOn(team, day)
      for (const areaId in seating) {
        const seats = seating[areaId] ?? 0
        const occ = map.get(areaId)
        if (!occ || seats <= 0) continue
        occ.teams.push({ teamId: team.id, seats })
        occ.used += seats
        occ.free -= seats
      }
    }
    return map
  },
)

/** Seats in an area that are free on ALL the given days (never below zero). When
 *  `ignoreTeamId` is set, that team's own seats count as free: use it to ask "how many
 *  seats could this team have here". */
export function freeOnDays(project: Project, areaId: Id, days: readonly Weekday[], ignoreTeamId?: Id): number {
  const ref = indexAreas(project).get(areaId)
  if (!ref) return 0
  let free = ref.area.capacity
  for (const day of days) {
    const occ = dayOccupancy(project, day).get(areaId)
    if (!occ) continue
    let used = occ.used
    if (ignoreTeamId) {
      for (const t of occ.teams) if (t.teamId === ignoreTeamId) used -= t.seats
    }
    free = Math.min(free, ref.area.capacity - used)
  }
  return Math.max(0, free)
}

export type SeatState =
  /** Not a team day. */
  | 'off'
  /** A team day without any seat. */
  | 'unseated'
  /** Some seats, fewer than needed. */
  | 'short'
  /** Exactly the seats needed. */
  | 'seated'
  /** More seats than needed. */
  | 'over'

export interface TeamDayStatus {
  teamId: Id
  day: Weekday
  planned: boolean
  needed: number
  /** Seats held in desk and overflow areas. Seats in a room do not count. */
  seated: number
  inDesks: number
  inOverflow: number
  /** Seats placed in an area that is not for seating (a mistake to fix). */
  inNoSeating: number
  /** Areas where the team holds seats, in floor then area order. */
  areaIds: Id[]
  floorIds: Id[]
  state: SeatState
}

export function teamDayStatus(project: Project, team: Team, day: Weekday): TeamDayStatus {
  const planned = team.days.includes(day)
  const needed = planned ? seatsNeeded(team, project.settings) : 0
  const seating = seatingOn(team, day)
  const areas = indexAreas(project)
  let inDesks = 0
  let inOverflow = 0
  let inNoSeating = 0
  const held = new Set<Id>()
  for (const areaId in seating) {
    const seats = seating[areaId] ?? 0
    const ref = areas.get(areaId)
    if (!ref || seats <= 0) continue
    held.add(areaId)
    if (ref.area.kind === 'desks') inDesks += seats
    else if (ref.area.kind === 'overflow') inOverflow += seats
    else inNoSeating += seats
  }
  const areaIds: Id[] = []
  const floorIds: Id[] = []
  for (const floor of project.floors) {
    let onFloor = false
    for (const area of floor.areas) {
      if (held.has(area.id)) {
        areaIds.push(area.id)
        onFloor = true
      }
    }
    if (onFloor) floorIds.push(floor.id)
  }
  const seated = inDesks + inOverflow
  let state: SeatState = 'off'
  if (planned) {
    if (seated === 0) state = needed === 0 ? 'seated' : 'unseated'
    else if (seated < needed) state = 'short'
    else if (seated === needed) state = 'seated'
    else state = 'over'
  }
  return { teamId: team.id, day, planned, needed, seated, inDesks, inOverflow, inNoSeating, areaIds, floorIds, state }
}

export interface DayLoad {
  day: Weekday
  /** Teams in on this day. */
  teams: number
  /** People in those teams. */
  people: number
  /** Seats those teams need. */
  needed: number
  /** Of the needed seats, how many are placed (a team never counts for more than it needs). */
  seated: number
  /** Desk and overflow capacity of the whole building. */
  capacity: Capacity
  /** Desks that may be planned once the reserve for visitors is set aside. */
  plannableDesks: number
  /** How the demand compares with the building. */
  level: DayLevel
}

/** - `fits`: the seats needed fit in the plannable desks
 *  - `reserve`: fits in the desks, but eats into the reserve kept free for visitors
 *  - `overflow`: more people than desks; only fits with overflow seats
 *  - `over`: more people than desks and overflow seats together */
export type DayLevel = 'fits' | 'reserve' | 'overflow' | 'over'

/** Desks left for planning after the reserve is set aside (rounded down). */
export function plannableDesks(project: Project): number {
  const { desks } = projectCapacity(project)
  return Math.floor(Math.round(desks * (1 - project.settings.reserve) * 1e6) / 1e6)
}

export function dayLevel(needed: number, capacity: Capacity, plannable: number): DayLevel {
  if (needed > capacity.desks + capacity.overflow) return 'over'
  if (needed > capacity.desks) return 'overflow'
  if (needed > plannable) return 'reserve'
  return 'fits'
}

/** Demand against capacity for the whole building on one day. */
export const dayLoad: (project: Project, day: Weekday) => DayLoad = cachedPerProjectDay((project, day) => {
  let teams = 0
  let people = 0
  let needed = 0
  let seated = 0
  for (const team of project.teams) {
    if (!team.days.includes(day)) continue
    const status = teamDayStatus(project, team, day)
    teams += 1
    people += Math.max(0, team.size)
    needed += status.needed
    seated += Math.min(status.seated, status.needed)
  }
  const capacity = projectCapacity(project)
  const plannable = plannableDesks(project)
  return {
    day,
    teams,
    people,
    needed,
    seated,
    capacity,
    plannableDesks: plannable,
    level: dayLevel(needed, capacity, plannable),
  }
})

export interface FloorLoad {
  floorId: Id
  day: Weekday
  capacity: Capacity
  /** Seats held in desk areas of this floor. */
  usedDesks: number
  /** Seats held in overflow areas of this floor. */
  usedOverflow: number
  /** Teams holding at least one seat on this floor. */
  teamIds: Id[]
}

export function floorLoad(project: Project, floor: Floor, day: Weekday): FloorLoad {
  const occupancy = dayOccupancy(project, day)
  let usedDesks = 0
  let usedOverflow = 0
  const teamIds = new Set<Id>()
  for (const area of floor.areas) {
    const occ = occupancy.get(area.id)
    if (!occ) continue
    if (area.kind === 'desks') usedDesks += occ.used
    else if (area.kind === 'overflow') usedOverflow += occ.used
    for (const t of occ.teams) teamIds.add(t.teamId)
  }
  return {
    floorId: floor.id,
    day,
    capacity: floorCapacity(floor),
    usedDesks,
    usedOverflow,
    teamIds: project.teams.filter((t) => teamIds.has(t.id)).map((t) => t.id),
  }
}

/** A short text for where a team sits on a day: "Floor 4: NE 1, NE 2". Empty when unseated. */
export function describeSeating(project: Project, team: Team, day: Weekday): string {
  const seating = seatingOn(team, day)
  const parts: string[] = []
  for (const floor of project.floors) {
    const names = floor.areas.filter((a) => (seating[a.id] ?? 0) > 0).map((a) => a.name)
    if (names.length > 0) parts.push(`${floor.name}: ${names.join(', ')}`)
  }
  return parts.join('; ')
}

// ---------------------------------------------------------------------------
// Making new things (ids are random, so these are for action creators, not reducers)
// ---------------------------------------------------------------------------

export function newId(prefix: string): Id {
  // getRandomValues works everywhere, also where randomUUID is missing (non-secure contexts).
  const bytes = new Uint8Array(8)
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  let random = ''
  for (const b of bytes) random += b.toString(36).padStart(2, '0')
  return `${prefix}-${random.slice(0, 12)}`
}

/** The longest code a team can have (see `Team.code`). */
const TEAM_CODE_LENGTH = 4

/** A short code for a team name that is not in use yet: "Claims Alpha" gives "CA". A number
 *  in the name is kept whole, so "Team 12" gives "T12" and does not collide with "Team 1". */
export function teamCode(name: string, taken: readonly string[]): string {
  const words = name
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const isNumber = (word: string) => /^\p{N}+$/u.test(word)
  const [first = ''] = words
  let base: string
  if (words.length === 0) base = 'T'
  else if (words.length === 1) base = isNumber(first) ? first : first.slice(0, 3)
  else
    base = words
      .slice(0, 3)
      .map((w) => (isNumber(w) ? w : w.slice(0, 1)))
      .join('')
  // Cut after converting: upper case can be longer than lower case ("ß" becomes "SS").
  base = base.toUpperCase().slice(0, TEAM_CODE_LENGTH)
  const used = new Set(taken.map((t) => t.toUpperCase()))
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    // The letters make room for the number, however long it gets.
    const number = String(n)
    const candidate = `${base.slice(0, TEAM_CODE_LENGTH - number.length)}${number}`
    if (!used.has(candidate)) return candidate
  }
  return base
}

export interface NewTeamInput {
  name: string
  size: number
  /** Wanted team days; they are also planned. */
  days?: readonly Weekday[]
  /** Ignored when `artId` is given: the team then gets the ART's domain. */
  domainId?: Id | null
  artId?: Id | null
  color?: string
  code?: string
  attendance?: number | null
  homeFloorId?: Id | null
  notes?: string
}

/** A whole number of zero or more for a team size or a number of seats. Anything that is not
 *  a usable number (also infinity) counts as zero. */
function wholeCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

export function makeTeam(project: Project, input: NewTeamInput): Team {
  const days = sortDays(input.days ?? [])
  const org = fitOrg(project, input.domainId ?? null, input.artId ?? null)
  return {
    id: newId('team'),
    name: input.name,
    code: (input.code ?? teamCode(input.name, project.teams.map((t) => t.code))).slice(0, TEAM_CODE_LENGTH),
    size: wholeCount(input.size),
    color: input.color ?? nextTeamColor(project.teams.map((t) => t.color)),
    domainId: org.domainId,
    artId: org.artId,
    wishes: wishesFromDays(days),
    days,
    attendance: input.attendance ?? null,
    homeFloorId: input.homeFloorId ?? null,
    seating: {},
    daySeating: {},
    notes: input.notes ?? '',
  }
}

/** A sign label from a floor name: "Floor 4" gives "4", "Ground floor" gives "G". */
export function floorLabelFromName(name: string): string {
  const number = /-?\d+/.exec(name)
  if (number) return number[0].slice(0, 3)
  const letter = /\p{L}/u.exec(name)
  return letter ? letter[0].toUpperCase() : '?'
}

export function makeFloor(input: { name: string; label?: string; plan?: PlanImage | null; areas?: Area[] }): Floor {
  return {
    id: newId('floor'),
    name: input.name,
    label: (input.label ?? floorLabelFromName(input.name)).slice(0, 3),
    plan: input.plan ?? null,
    areas: input.areas ?? [],
  }
}

/** A copy of a floor with new ids for the floor and all its areas (same layout, no teams). */
export function copyFloor(floor: Floor, name: string, label?: string): Floor {
  return {
    ...floor,
    id: newId('floor'),
    name,
    label: (label ?? floorLabelFromName(name)).slice(0, 3),
    areas: floor.areas.map((a) => ({ ...a, id: newId('area'), rect: { ...a.rect } })),
  }
}

/** The next free "Area N" name on a floor. */
export function nextAreaName(floor: Floor): string {
  const names = new Set(floor.areas.map((a) => a.name.trim().toLowerCase()))
  for (let n = floor.areas.length + 1; n < floor.areas.length + 1000; n += 1) {
    if (!names.has(`area ${n}`)) return `Area ${n}`
  }
  return 'Area'
}

export function makeArea(
  floor: Floor,
  rect: Rect,
  patch: Partial<Pick<Area, 'name' | 'kind' | 'capacity'>> = {},
): Area {
  return {
    id: newId('area'),
    name: patch.name ?? nextAreaName(floor),
    kind: patch.kind ?? 'desks',
    capacity: wholeCount(patch.capacity ?? 4),
    rect: clampRect(rect),
  }
}

export const MIN_RECT_SIZE = 0.01

/** Keeps a rectangle inside the plan and at least `MIN_RECT_SIZE` wide and high. */
export function clampRect(rect: Rect): Rect {
  const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback)
  const w = Math.min(1, Math.max(MIN_RECT_SIZE, finite(rect.w, MIN_RECT_SIZE)))
  const h = Math.min(1, Math.max(MIN_RECT_SIZE, finite(rect.h, MIN_RECT_SIZE)))
  const x = Math.min(1 - w, Math.max(0, finite(rect.x, 0)))
  const y = Math.min(1 - h, Math.max(0, finite(rect.y, 0)))
  return { x, y, w, h }
}

export function emptyProject(name = 'Office plan'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    floors: [],
    domains: [],
    arts: [],
    teams: [],
    settings: { ...DEFAULT_SETTINGS },
    accepted: {},
  }
}

// ---------------------------------------------------------------------------
// Domains and ARTs
// ---------------------------------------------------------------------------

export function makeDomain(name: string): Domain {
  return { id: newId('domain'), name }
}

export function makeArt(name: string, domainId: Id | null): Art {
  return { id: newId('art'), name, domainId }
}

export function findDomain(project: Project, id: Id | null): Domain | undefined {
  return id === null ? undefined : project.domains.find((domain) => domain.id === id)
}

export function findArt(project: Project, id: Id | null): Art | undefined {
  return id === null ? undefined : project.arts.find((art) => art.id === id)
}

/** A domain and ART for a team that keep the invariants: both exist or are null, and a
 *  team on an ART has the ART's domain. The ART wins over the domain. */
export function fitOrg(project: Project, domainId: Id | null, artId: Id | null): { domainId: Id | null; artId: Id | null } {
  const art = findArt(project, artId)
  if (art) return { domainId: findDomain(project, art.domainId)?.id ?? null, artId: art.id }
  return { domainId: findDomain(project, domainId)?.id ?? null, artId: null }
}

/** The team's domain and ART, where it has them. */
export function teamOrg(project: Project, team: Team): { domain: Domain | undefined; art: Art | undefined } {
  return { domain: findDomain(project, team.domainId), art: findArt(project, team.artId) }
}

/** "Non-Life · Claims ART", "Management", or '' for a team that belongs to neither. Pass
 *  ', ' as the separator for text that is read out. */
export function orgLabel(project: Project, team: Team, separator = ' · '): string {
  const { domain, art } = teamOrg(project, team)
  return [domain?.name, art?.name].filter((name): name is string => Boolean(name?.trim())).join(separator)
}

/** The ARTs of a domain (null: the ARTs on no domain), in the planner's order. */
export function artsOf(project: Project, domainId: Id | null): Art[] {
  return project.arts.filter((art) => art.domainId === domainId)
}

/** The first of the names that is not taken (ignoring case), e.g. "New ART 2". */
export function freeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
