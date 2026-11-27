import { nextTeamColor, normalizeHex } from './color'
import { boundedText, LIMITS } from './limits'
import { clampRect, fitOrg, indexAreas, isSeatable, sameSeating, sortDays, sumSeats } from './model'
import type {
  Area,
  Art,
  DayWish,
  Domain,
  Floor,
  Id,
  PlanImage,
  Project,
  Seating,
  SeatingScope,
  Settings,
  Team,
  Weekday,
} from './types'

/* Every change to a project is one of these actions. `reduce` is pure and keeps the
   invariants listed in types.ts. An action that changes nothing returns the SAME project
   object, so it does not create an undo step. */

export type TeamPatch = Partial<
  Pick<Team, 'name' | 'code' | 'size' | 'color' | 'domainId' | 'artId' | 'attendance' | 'homeFloorId' | 'notes'>
>
export type ArtPatch = Partial<Pick<Art, 'name' | 'domainId'>>
export type FloorPatch = Partial<Pick<Floor, 'name' | 'label' | 'plan'>>
export type AreaPatch = Partial<Pick<Area, 'name' | 'kind' | 'capacity' | 'rect'>>

export type Action =
  | { type: 'project/rename'; name: string }
  /** Swap in a whole project (opening a file, applying a computed plan). Pass a normalized project. */
  | { type: 'project/replace'; project: Project }
  | { type: 'settings/update'; patch: Partial<Settings> }
  /** Add a team; refused when its id is in use. The team is made to fit the project first
   *  (whole size, days in week order, no seats in areas that do not exist), so a team from
   *  `makeTeam` is stored as it is and a carelessly built one cannot break the project. */
  | { type: 'team/add'; team: Team }
  /** The same for a list of teams; teams whose id is in use or repeated are skipped. */
  | { type: 'team/addMany'; teams: Team[] }
  | { type: 'team/update'; id: Id; patch: TeamPatch }
  | { type: 'team/remove'; id: Id }
  /** Record what the team said about a day. The planned days follow: `want` plans the day,
   *  `cannot` unplans it, `can` and `none` unplan it only when it was a wanted day before. */
  | { type: 'team/setWish'; id: Id; day: Weekday; wish: DayWish }
  /** The planner's decision, independent of the wish. */
  | { type: 'team/setPlanned'; id: Id; day: Weekday; planned: boolean }
  /** Plan `to` instead of `from`. The team keeps the seats it had on `from`; the wishes stay
   *  as they are. */
  | { type: 'team/moveDay'; id: Id; from: Weekday; to: Weekday }
  /** Give the team `seats` seats in an area (0 removes it from the area). With scope `all`
   *  this edits the seating used on every team day; with a weekday it edits that day only
   *  and creates a day exception when needed. In a room (`no-seating`) seats can only be
   *  taken away: a higher number than the team holds there is refused. */
  | { type: 'seat/set'; teamId: Id; areaId: Id; seats: number; scope: SeatingScope }
  /** Remove all seats: everywhere (`all`, including day exceptions) or on one day. */
  | { type: 'seat/clear'; teamId: Id; scope: SeatingScope }
  /** Drop a day exception so the day uses the normal seating again. */
  | { type: 'seat/resetDay'; teamId: Id; day: Weekday }
  /** Replace a team's whole seating (used when applying an automatic proposal). */
  | { type: 'seat/replace'; teamId: Id; seating: Seating; daySeating?: Partial<Record<Weekday, Seating>> }
  /** Put a floor on top of the building; refused when its id or one of its area ids is in
   *  use. Seat counts and rectangles are made sound, as `area/add` does for one area. */
  | { type: 'floor/add'; floor: Floor }
  | { type: 'floor/update'; id: Id; patch: FloorPatch }
  /** Removes the floor, its areas and every seat teams held there. */
  | { type: 'floor/remove'; id: Id }
  /** Move a floor one position up (+1) or down (-1) in the building. */
  | { type: 'floor/move'; id: Id; by: 1 | -1 }
  | { type: 'area/add'; floorId: Id; area: Area }
  | { type: 'area/update'; id: Id; patch: AreaPatch }
  /** Removes the area and every seat teams held there. */
  | { type: 'area/remove'; id: Id }
  /** Add a domain at the end of the list; refused when its id is in use. */
  | { type: 'domain/add'; domain: Domain }
  | { type: 'domain/rename'; id: Id; name: string }
  /** Removes the domain. Its ARTs stay, on no domain; its teams stay, in no domain (those on
   *  one of its ARTs stay on that ART). */
  | { type: 'domain/remove'; id: Id }
  /** Add an ART at the end of the list; refused when its id is in use. A domain that does not
   *  exist becomes none. */
  | { type: 'art/add'; art: Art }
  /** Rename an ART or move it to another domain (or none); its teams move along. */
  | { type: 'art/update'; id: Id; patch: ArtPatch }
  /** Removes the ART. Its teams stay in the ART's domain, on no ART. */
  | { type: 'art/remove'; id: Id }
  /** Accept a warning or note as it is, with an optional reason. `detail` is the issue's
   *  current detail text; the acceptance lapses when that text changes. */
  | { type: 'issue/accept'; id: string; note: string; detail: string }
  | { type: 'issue/unaccept'; id: string }
  /** Several actions as one undo step. */
  | { type: 'batch'; actions: Action[] }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const MIN_ATTENDANCE = 0.1

function toCount(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0
}

function clampAttendance(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(1, Math.max(MIN_ATTENDANCE, n))
}

export const MAX_RESERVE = 0.5

function clampReserve(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_RESERVE, Math.max(0, n))
}

function withSeats(seating: Seating, areaId: Id, seats: number): Seating {
  const current = seating[areaId] ?? 0
  if (current === seats) return seating
  const next: Seating = { ...seating }
  if (seats > 0) next[areaId] = seats
  else delete next[areaId]
  return next
}

function withoutDay<T>(record: Partial<Record<Weekday, T>>, day: Weekday): Partial<Record<Weekday, T>> {
  if (record[day] === undefined) return record
  const next = { ...record }
  delete next[day]
  return next
}

/** Keeps only positive whole seat counts in areas for which `keep` is true. Returns the
 *  same object when nothing had to go. */
function cleanSeating(seating: Seating, keep: (areaId: Id) => boolean): Seating {
  let changed = false
  const next: Seating = {}
  for (const areaId in seating) {
    const seats = toCount(seating[areaId])
    if (seats > 0 && keep(areaId)) {
      next[areaId] = seats
      if (seats !== seating[areaId]) changed = true
    } else {
      changed = true
    }
  }
  return changed ? next : seating
}

/** Keeps a team's seating honest. Returns the same team when nothing had to change.
 *
 *  - Drops day exceptions that are not exceptions: on days that are not team days, and
 *    seatings identical to the normal one.
 *  - Never leaves the normal seating hidden. When EVERY team day has a seating of its own,
 *    no day shows `team.seating`: nobody can see or edit it, and it would come back from
 *    nowhere on the next day that is added. The seating most team days share then becomes
 *    the normal one (on a tie the one with more seats, then the earlier day's). */
export function settleSeating(team: Team): Team {
  let seating = team.seating
  let daySeating = team.daySeating
  for (const key of Object.keys(team.daySeating) as Weekday[]) {
    const own = team.daySeating[key]
    if (own === undefined || !team.days.includes(key) || sameSeating(own, seating)) {
      daySeating = withoutDay(daySeating, key)
    }
  }
  if (team.days.length > 0 && team.days.every((day) => daySeating[day] !== undefined)) {
    let best: Seating | undefined
    let bestDays = 0
    let bestSeats = -1
    for (const day of team.days) {
      const candidate = daySeating[day]
      if (candidate === undefined) continue
      const sharedBy = team.days.filter((d) => {
        const other = daySeating[d]
        return other !== undefined && sameSeating(other, candidate)
      }).length
      const seats = sumSeats(candidate)
      if (sharedBy > bestDays || (sharedBy === bestDays && seats > bestSeats)) {
        best = candidate
        bestDays = sharedBy
        bestSeats = seats
      }
    }
    if (best !== undefined) {
      seating = best
      for (const day of team.days) {
        const own = daySeating[day]
        if (own !== undefined && sameSeating(own, seating)) daySeating = withoutDay(daySeating, day)
      }
    }
  }
  return seating === team.seating && daySeating === team.daySeating ? team : { ...team, seating, daySeating }
}

/** Removes seats in areas that no longer exist, from every team. */
function pruneSeatings(project: Project): Project {
  const areas = indexAreas(project)
  const keep = (areaId: Id) => areas.has(areaId)
  let changed = false
  const teams = project.teams.map((team) => {
    const seating = cleanSeating(team.seating, keep)
    let daySeating = team.daySeating
    for (const day of Object.keys(team.daySeating) as Weekday[]) {
      const current = team.daySeating[day]
      if (current === undefined) continue
      const cleaned = cleanSeating(current, keep)
      if (cleaned !== current) daySeating = { ...daySeating, [day]: cleaned }
    }
    if (seating === team.seating && daySeating === team.daySeating) return team
    changed = true
    return settleSeating({ ...team, seating, daySeating })
  })
  return changed ? { ...project, teams } : project
}

function updateTeam(project: Project, id: Id, change: (team: Team) => Team): Project {
  let changed = false
  const teams = project.teams.map((team) => {
    if (team.id !== id) return team
    const next = change(team)
    if (next !== team) changed = true
    return next
  })
  return changed ? { ...project, teams } : project
}

function updateFloor(project: Project, id: Id, change: (floor: Floor) => Floor): Project {
  let changed = false
  const floors = project.floors.map((floor) => {
    if (floor.id !== id) return floor
    const next = change(floor)
    if (next !== floor) changed = true
    return next
  })
  return changed ? { ...project, floors } : project
}

function sameRect(a: Area['rect'], b: Area['rect']): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/** True for the same drawing, also when it was loaded again into a new object. */
function samePlan(a: PlanImage | null, b: PlanImage | null): boolean {
  if (a === b) return true
  return a !== null && b !== null && a.width === b.width && a.height === b.height && a.src === b.src
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day, i) => day === b[i])
}

function sameDaySeating(a: Partial<Record<Weekday, Seating>>, b: Partial<Record<Weekday, Seating>>): boolean {
  const days = Object.keys(a) as Weekday[]
  return (
    days.length === Object.keys(b).length &&
    days.every((day) => {
      const one = a[day]
      const other = b[day]
      return one !== undefined && other !== undefined && sameSeating(one, other)
    })
  )
}

/** A team that is handed over as a whole (a new team, a pasted list) made to fit the
 *  project, so that adding it keeps the invariants: whole counts, days in week order, seats
 *  only in areas that exist, day exceptions only on team days, a preferred floor that is
 *  there. What is merely a conflict stays (seats in a room, more seats than an area has):
 *  conflicts are shown, not prevented. A team that fits already is returned as it is. */
function fitTeam(project: Project, team: Team, colorsInUse: readonly string[]): Team {
  const areas = indexAreas(project)
  const exists = (areaId: Id) => areas.has(areaId)
  const days = sortDays(team.days)
  const daySeating: Partial<Record<Weekday, Seating>> = {}
  for (const day of days) {
    const seating = team.daySeating[day]
    if (seating !== undefined) daySeating[day] = cleanSeating(seating, exists)
  }
  const fitted = settleSeating({
    ...team,
    code: team.code.slice(0, 4),
    size: toCount(team.size),
    color: normalizeHex(team.color) ?? nextTeamColor(colorsInUse),
    days,
    attendance: team.attendance === null ? null : clampAttendance(team.attendance),
    homeFloorId: project.floors.some((f) => f.id === team.homeFloorId) ? team.homeFloorId : null,
    ...fitOrg(project, team.domainId, team.artId),
    seating: cleanSeating(team.seating, exists),
    daySeating,
  })
  const fits =
    fitted.code === team.code &&
    fitted.size === team.size &&
    fitted.color === team.color &&
    sameDays(fitted.days, team.days) &&
    fitted.attendance === team.attendance &&
    fitted.homeFloorId === team.homeFloorId &&
    fitted.domainId === team.domainId &&
    fitted.artId === team.artId &&
    fitted.seating === team.seating &&
    sameDaySeating(fitted.daySeating, team.daySeating)
  return fits ? team : fitted
}

/** The same for a floor that is handed over as a whole: a sign of at most three characters,
 *  whole seat counts and rectangles inside the plan. A floor that fits already is returned
 *  as it is. */
function fitFloor(floor: Floor): Floor {
  let changed = false
  const areas = floor.areas.map((area) => {
    const capacity = toCount(area.capacity)
    const rect = clampRect(area.rect)
    if (capacity === area.capacity && sameRect(rect, area.rect)) return area
    changed = true
    return { ...area, capacity, rect }
  })
  const label = floor.label.slice(0, 3)
  return changed || label !== floor.label ? { ...floor, label, areas } : floor
}

function applyTeamPatch(project: Project, team: Team, patch: TeamPatch): Team {
  const next: Team = { ...team }
  if (patch.name !== undefined) next.name = boundedText(String(patch.name), LIMITS.name)
  if (patch.code !== undefined) next.code = boundedText(String(patch.code), LIMITS.code)
  if (patch.size !== undefined) next.size = Math.min(LIMITS.teamSize, toCount(patch.size))
  if (patch.color !== undefined) next.color = normalizeHex(String(patch.color)) ?? team.color
  if (patch.domainId !== undefined || patch.artId !== undefined) {
    const domainId = patch.domainId !== undefined ? patch.domainId : team.domainId
    // A new domain takes the team off an ART of another domain, unless an ART is given too.
    const keepsArt = patch.domainId === undefined || findArtDomain(project, team.artId) === patch.domainId
    const artId = patch.artId !== undefined ? patch.artId : keepsArt ? team.artId : null
    const org = fitOrg(project, domainId, artId)
    next.domainId = org.domainId
    next.artId = org.artId
  }
  if (patch.notes !== undefined) next.notes = boundedText(String(patch.notes), LIMITS.notes)
  if (patch.attendance !== undefined) {
    next.attendance = patch.attendance === null ? null : clampAttendance(patch.attendance)
  }
  if (patch.homeFloorId !== undefined) {
    next.homeFloorId =
      patch.homeFloorId !== null && project.floors.some((f) => f.id === patch.homeFloorId) ? patch.homeFloorId : null
  }
  const same =
    next.name === team.name &&
    next.code === team.code &&
    next.size === team.size &&
    next.color === team.color &&
    next.domainId === team.domainId &&
    next.artId === team.artId &&
    next.notes === team.notes &&
    next.attendance === team.attendance &&
    next.homeFloorId === team.homeFloorId
  return same ? team : next
}

/** The domain of an ART; undefined when there is no such ART. */
function findArtDomain(project: Project, artId: Id | null): Id | null | undefined {
  return artId === null ? undefined : project.arts.find((art) => art.id === artId)?.domainId
}

function orgName(name: unknown): string {
  return boundedText(String(name), LIMITS.orgName)
}

/** Every team on the ART gets the ART's domain (after the ART moved). */
function withArtDomain(teams: Team[], artId: Id, domainId: Id | null): Team[] {
  let changed = false
  const next = teams.map((team) => {
    if (team.artId !== artId || team.domainId === domainId) return team
    changed = true
    return { ...team, domainId }
  })
  return changed ? next : teams
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function reduce(project: Project, action: Action): Project {
  switch (action.type) {
    case 'project/rename': {
      const name = boundedText(String(action.name), LIMITS.name)
      return name === project.name ? project : { ...project, name }
    }

    case 'project/replace':
      return action.project

    case 'settings/update': {
      const settings: Settings = { ...project.settings }
      if (action.patch.attendance !== undefined) settings.attendance = clampAttendance(action.patch.attendance)
      if (action.patch.reserve !== undefined) settings.reserve = clampReserve(action.patch.reserve)
      const same =
        settings.attendance === project.settings.attendance && settings.reserve === project.settings.reserve
      return same ? project : { ...project, settings }
    }

    case 'team/add': {
      if (project.teams.some((t) => t.id === action.team.id)) return project
      const colors = project.teams.map((t) => t.color)
      return { ...project, teams: [...project.teams, fitTeam(project, action.team, colors)] }
    }

    case 'team/addMany': {
      const ids = new Set(project.teams.map((t) => t.id))
      const colors = project.teams.map((t) => t.color)
      const fresh: Team[] = []
      for (const candidate of action.teams) {
        if (ids.has(candidate.id)) continue
        const team = fitTeam(project, candidate, colors)
        ids.add(team.id)
        colors.push(team.color)
        fresh.push(team)
      }
      return fresh.length === 0 ? project : { ...project, teams: [...project.teams, ...fresh] }
    }

    case 'team/update':
      return updateTeam(project, action.id, (team) => applyTeamPatch(project, team, action.patch))

    case 'team/remove': {
      const teams = project.teams.filter((t) => t.id !== action.id)
      return teams.length === project.teams.length ? project : { ...project, teams }
    }

    case 'team/setWish':
      return updateTeam(project, action.id, (team) => {
        const previous = team.wishes[action.day]
        if (previous === action.wish) return team
        const wishes = { ...team.wishes, [action.day]: action.wish }
        let days = team.days
        let daySeating = team.daySeating
        if (action.wish === 'want') {
          if (!days.includes(action.day)) days = sortDays([...days, action.day])
        } else if (action.wish === 'cannot' || previous === 'want') {
          if (days.includes(action.day)) {
            days = days.filter((d) => d !== action.day)
            daySeating = withoutDay(daySeating, action.day)
          }
        }
        // Taking a day off the plan can leave only days with a seating of their own.
        return settleSeating({ ...team, wishes, days, daySeating })
      })

    case 'team/setPlanned':
      return updateTeam(project, action.id, (team) => {
        const has = team.days.includes(action.day)
        if (has === action.planned) return team
        if (action.planned) return { ...team, days: sortDays([...team.days, action.day]) }
        return settleSeating({
          ...team,
          days: team.days.filter((d) => d !== action.day),
          daySeating: withoutDay(team.daySeating, action.day),
        })
      })

    case 'team/moveDay':
      return updateTeam(project, action.id, (team) => {
        if (action.from === action.to || !team.days.includes(action.from)) return team
        const days = sortDays([...team.days.filter((d) => d !== action.from), action.to])
        // The team keeps the seats it had on the day it leaves: a seating of its own for
        // that day moves along. (A day that was a team day already keeps its own seating.)
        const own = team.daySeating[action.from]
        let daySeating = withoutDay(team.daySeating, action.from)
        if (own !== undefined && !team.days.includes(action.to)) daySeating = { ...daySeating, [action.to]: own }
        return settleSeating({ ...team, days, daySeating })
      })

    case 'seat/set': {
      const ref = indexAreas(project).get(action.areaId)
      if (!ref) return project
      const seats = toCount(action.seats)
      const seatable = isSeatable(ref.area.kind)
      const scope = action.scope
      return updateTeam(project, action.teamId, (team) => {
        if (scope !== 'all' && !team.days.includes(scope)) return team
        const current = scope === 'all' ? team.seating : (team.daySeating[scope] ?? team.seating)
        // Seats can always be taken away, one by one too, but only be given in areas meant
        // for seating.
        if (!seatable && seats > (current[action.areaId] ?? 0)) return team
        const next = withSeats(current, action.areaId, seats)
        if (next === current) return team
        return settleSeating(
          scope === 'all' ? { ...team, seating: next } : { ...team, daySeating: { ...team.daySeating, [scope]: next } },
        )
      })
    }

    case 'seat/clear':
      return updateTeam(project, action.teamId, (team) => {
        if (action.scope === 'all') {
          const empty = Object.keys(team.seating).length === 0 && Object.keys(team.daySeating).length === 0
          return empty ? team : { ...team, seating: {}, daySeating: {} }
        }
        const day = action.scope
        if (!team.days.includes(day)) return team
        const current = team.daySeating[day] ?? team.seating
        if (Object.keys(current).length === 0) return team
        return settleSeating({ ...team, daySeating: { ...team.daySeating, [day]: {} } })
      })

    case 'seat/resetDay':
      return updateTeam(project, action.teamId, (team) => {
        const daySeating = withoutDay(team.daySeating, action.day)
        return daySeating === team.daySeating ? team : { ...team, daySeating }
      })

    case 'seat/replace': {
      const areas = indexAreas(project)
      const keep = (areaId: Id) => {
        const ref = areas.get(areaId)
        return ref !== undefined && isSeatable(ref.area.kind)
      }
      return updateTeam(project, action.teamId, (team) => {
        const seating = cleanSeating({ ...action.seating }, keep)
        const daySeating: Partial<Record<Weekday, Seating>> = {}
        for (const day of team.days) {
          const s = action.daySeating?.[day]
          if (s !== undefined) daySeating[day] = cleanSeating({ ...s }, keep)
        }
        const next = settleSeating({ ...team, seating, daySeating })
        const unchanged = sameSeating(next.seating, team.seating) && sameDaySeating(next.daySeating, team.daySeating)
        return unchanged ? team : next
      })
    }

    case 'floor/add': {
      if (project.floors.some((f) => f.id === action.floor.id)) return project
      const areas = indexAreas(project)
      const seen = new Set<Id>()
      for (const area of action.floor.areas) {
        if (areas.has(area.id) || seen.has(area.id)) return project
        seen.add(area.id)
      }
      return { ...project, floors: [...project.floors, fitFloor(action.floor)] }
    }

    case 'floor/update':
      return updateFloor(project, action.id, (floor) => {
        const next: Floor = { ...floor }
        if (action.patch.name !== undefined) next.name = boundedText(String(action.patch.name), LIMITS.name)
        if (action.patch.label !== undefined) next.label = boundedText(String(action.patch.label), LIMITS.label)
        if (action.patch.plan !== undefined) next.plan = action.patch.plan
        return next.name === floor.name && next.label === floor.label && samePlan(next.plan, floor.plan) ? floor : next
      })

    case 'floor/remove': {
      const floors = project.floors.filter((f) => f.id !== action.id)
      if (floors.length === project.floors.length) return project
      const teams = project.teams.map((t) => (t.homeFloorId === action.id ? { ...t, homeFloorId: null } : t))
      return pruneSeatings({ ...project, floors, teams })
    }

    case 'floor/move': {
      const from = project.floors.findIndex((f) => f.id === action.id)
      const to = from + action.by
      if (from < 0 || to < 0 || to >= project.floors.length) return project
      const floors = [...project.floors]
      const [moved] = floors.splice(from, 1)
      if (!moved) return project
      floors.splice(to, 0, moved)
      return { ...project, floors }
    }

    case 'area/add': {
      if (indexAreas(project).has(action.area.id)) return project
      const area: Area = {
        ...action.area,
        capacity: toCount(action.area.capacity),
        rect: clampRect(action.area.rect),
      }
      return updateFloor(project, action.floorId, (floor) => ({ ...floor, areas: [...floor.areas, area] }))
    }

    case 'area/update': {
      const ref = indexAreas(project).get(action.id)
      if (!ref) return project
      return updateFloor(project, ref.floor.id, (floor) => {
        let changed = false
        const areas = floor.areas.map((area) => {
          if (area.id !== action.id) return area
          const next: Area = { ...area }
          if (action.patch.name !== undefined) next.name = boundedText(String(action.patch.name), LIMITS.name)
          if (action.patch.kind !== undefined) next.kind = action.patch.kind
          if (action.patch.capacity !== undefined) next.capacity = Math.min(LIMITS.seats, toCount(action.patch.capacity))
          if (action.patch.rect !== undefined) next.rect = clampRect(action.patch.rect)
          const same =
            next.name === area.name &&
            next.kind === area.kind &&
            next.capacity === area.capacity &&
            sameRect(next.rect, area.rect)
          if (same) return area
          changed = true
          return next
        })
        return changed ? { ...floor, areas } : floor
      })
    }

    case 'area/remove': {
      const ref = indexAreas(project).get(action.id)
      if (!ref) return project
      const next = updateFloor(project, ref.floor.id, (floor) => ({
        ...floor,
        areas: floor.areas.filter((a) => a.id !== action.id),
      }))
      return pruneSeatings(next)
    }

    case 'domain/add': {
      const { domain } = action
      if (project.domains.some((d) => d.id === domain.id)) return project
      return { ...project, domains: [...project.domains, { id: domain.id, name: orgName(domain.name) }] }
    }

    case 'domain/rename': {
      const name = orgName(action.name)
      const domain = project.domains.find((d) => d.id === action.id)
      if (!domain || domain.name === name) return project
      return { ...project, domains: project.domains.map((d) => (d === domain ? { ...d, name } : d)) }
    }

    case 'domain/remove': {
      if (!project.domains.some((d) => d.id === action.id)) return project
      return {
        ...project,
        domains: project.domains.filter((d) => d.id !== action.id),
        arts: project.arts.map((art) => (art.domainId === action.id ? { ...art, domainId: null } : art)),
        teams: project.teams.map((team) => (team.domainId === action.id ? { ...team, domainId: null } : team)),
      }
    }

    case 'art/add': {
      const { art } = action
      if (project.arts.some((a) => a.id === art.id)) return project
      const domainId = project.domains.some((d) => d.id === art.domainId) ? art.domainId : null
      return { ...project, arts: [...project.arts, { id: art.id, name: orgName(art.name), domainId }] }
    }

    case 'art/update': {
      const art = project.arts.find((a) => a.id === action.id)
      if (!art) return project
      const { patch } = action
      const name = patch.name !== undefined ? orgName(patch.name) : art.name
      let domainId = art.domainId
      if (patch.domainId !== undefined) {
        domainId = patch.domainId !== null && project.domains.some((d) => d.id === patch.domainId) ? patch.domainId : null
      }
      if (name === art.name && domainId === art.domainId) return project
      return {
        ...project,
        arts: project.arts.map((a) => (a === art ? { ...a, name, domainId } : a)),
        teams: withArtDomain(project.teams, art.id, domainId),
      }
    }

    case 'art/remove': {
      if (!project.arts.some((a) => a.id === action.id)) return project
      return {
        ...project,
        arts: project.arts.filter((a) => a.id !== action.id),
        teams: project.teams.map((team) => (team.artId === action.id ? { ...team, artId: null } : team)),
      }
    }

    case 'issue/accept': {
      const note = boundedText(String(action.note), LIMITS.acceptNote)
      const detail = boundedText(String(action.detail), LIMITS.acceptDetail)
      const current = Object.hasOwn(project.accepted, action.id) ? project.accepted[action.id] : undefined
      if (current && current.note === note && current.detail === detail) return project
      return { ...project, accepted: { ...project.accepted, [action.id]: { note, detail } } }
    }

    case 'issue/unaccept': {
      // `in` would also find what every object inherits ("toString", "constructor").
      if (!Object.hasOwn(project.accepted, action.id)) return project
      const accepted = { ...project.accepted }
      delete accepted[action.id]
      return { ...project, accepted }
    }

    case 'batch': {
      let next = project
      for (const a of action.actions) next = reduce(next, a)
      return next
    }
  }
}
