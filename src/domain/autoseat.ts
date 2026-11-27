import { areNeighbours, centerDistance, clusterAreas, nearestFirst } from './geometry'
import {
  freeOnDays,
  isSeatable,
  planAspect,
  sameSeating,
  seatingOn,
  seatsNeeded,
  sumSeats,
  teamDayStatus,
} from './model'
import { reduce, type Action } from './reducer'
import {
  WEEKDAY_NAME,
  type Area,
  type AreaKind,
  type Floor,
  type Id,
  type Project,
  type Seating,
  type Team,
  type Weekday,
} from './types'

/* Automatic seating: proposes where teams sit. It never changes anything by itself; it
   returns a new project that the caller may apply (as one undoable step) or discard.

   A team is seated in the first of these ways that works:
     1. on one floor, in the same areas on every team day (its normal seating)
     2. on one floor, but in other areas on a day where that has no room (a day exception)
     3. as 1 and 2 with overflow seats next to the desks, when the planner allows them
     4. spread over several floors on a day for which no single floor has room
   A day on which even that fails is left as it was: half a team is never placed.

   The proposal is deterministic. Teams, floors, areas and days are always walked in list
   or week order, never in the key order of a seating object. */

export interface AutoSeatOptions {
  /** Teams to seat. Default: every team that is not fully seated on one of its team days. */
  teamIds?: readonly Id[]
  /** Start the chosen teams from scratch instead of keeping the seats they already hold and
   *  adding what is missing. Default false. */
  restart?: boolean
  /** Use overflow areas (touchdown, collaboration tables) when the desks are full.
   *  Default false. */
  useOverflow?: boolean
}

export interface AutoSeatOutcome {
  teamId: Id
  /** - `seated`: fully seated on every team day
   *  - `partly`: fully seated on some team days but not on all
   *  - `unseated`: could not be seated on any team day
   *  - `unchanged`: was already fully seated, or has no team day */
  result: 'seated' | 'partly' | 'unseated' | 'unchanged'
  /** A plain sentence for the planner: "Seated in NE 1 and NE 2 on Floor 4", or
   *  "No room on Tuesday: needs 9 seats, 5 desks are free". */
  message: string
}

export interface AutoSeatResult {
  /** The proposal. The SAME object as the input when nothing changed. */
  project: Project
  /** One entry per team that was considered, in team-list order. */
  outcomes: AutoSeatOutcome[]
}

export function autoSeat(project: Project, options: AutoSeatOptions = {}): AutoSeatResult {
  const restart = options.restart ?? false
  const useOverflow = options.useOverflow ?? false

  const outcomes = new Map<Id, AutoSeatOutcome>()
  const toSeat: Team[] = []
  for (const team of chosenTeams(project, options.teamIds)) {
    const settled = nothingToDo(project, team, restart)
    if (settled === null) toSeat.push(team)
    else outcomes.set(team.id, { teamId: team.id, result: 'unchanged', message: settled })
  }

  // Large teams are the hardest to place, so they go first; among equally large teams the
  // one with more days. The sort is stable: teams that tie stay in list order.
  const need = (team: Team) => seatsNeeded(team, project.settings)
  toSeat.sort((a, b) => need(b) - need(a) || b.days.length - a.days.length)

  // `working` is where the plan grows: every team sees the seats of the teams before it.
  // On a restart the chosen teams first give up all their seats, so that those are free
  // for each other as well and not only for the team that held them.
  const giveUpSeats: Action[] = toSeat.map((t) => ({ type: 'seat/clear', teamId: t.id, scope: 'all' }))
  let working = restart ? reduce(project, { type: 'batch', actions: giveUpSeats }) : project
  const changes: Action[] = []
  const plans: { team: Team; plan: TeamPlan }[] = []
  for (const team of toSeat) {
    // The team as it is in the working plan: without seats on a restart, untouched otherwise.
    const current = restart ? { ...team, seating: {}, daySeating: {} } : team
    const plan = planTeam(working, current, useOverflow)
    // A plan that adds nothing is not applied, so that a team that cannot be helped stays
    // exactly as the planner left it. A restart is always applied: it also takes seats away.
    if (plan.added || restart) {
      const { seating, daySeating } = plan
      const change: Action = { type: 'seat/replace', teamId: team.id, seating, daySeating }
      changes.push(change)
      working = reduce(working, change)
    }
    plans.push({ team, plan })
  }

  for (const { team, plan } of plans) {
    // What is said about a day without room must be true of the proposal as a whole: the
    // desks that were free when this team was looked at may have gone to teams after it.
    const placed = working.teams.find((t) => t.id === team.id)
    const noRoom = plan.noRoom.map((day) => {
      if (!placed) return day
      const seating = seatableOnly(working, seatingOn(placed, day.day))
      const search: Search = { project: working, team: placed, days: [day.day], seating, missing: day.missing }
      return { ...day, free: freeEverywhere(search, useOverflow) }
    })
    const daysWithoutRoom = noRoom.length
    outcomes.set(team.id, {
      teamId: team.id,
      result: daysWithoutRoom === 0 ? 'seated' : daysWithoutRoom < team.days.length ? 'partly' : 'unseated',
      message: describe(project, team.days, { ...plan, noRoom }, useOverflow),
    })
  }

  return {
    // The changes are replayed on the project that came in. The reducer hands back the same
    // team when its seating comes out as it was, also after a restart, and the same project
    // when that goes for every team.
    project: reduce(project, { type: 'batch', actions: changes }),
    outcomes: project.teams.flatMap((t) => outcomes.get(t.id) ?? []),
  }
}

// ---------------------------------------------------------------------------
// Which teams
// ---------------------------------------------------------------------------

/** True when the team holds fewer seats than it needs on at least one of its team days. */
function isOpen(project: Project, team: Team): boolean {
  return team.days.some((day) => {
    const status = teamDayStatus(project, team, day)
    return status.seated < status.needed
  })
}

/** The teams that were asked for, in list order. Ids that match no team are ignored. */
function chosenTeams(project: Project, teamIds: readonly Id[] | undefined): Team[] {
  if (teamIds === undefined) return project.teams.filter((t) => isOpen(project, t))
  const asked = new Set(teamIds)
  return project.teams.filter((t) => asked.has(t.id))
}

/** Why a chosen team is left alone, as a sentence, or null when it has to be seated. */
function nothingToDo(project: Project, team: Team, restart: boolean): string | null {
  if (team.days.length === 0) return 'Has no team day'
  if (seatsNeeded(team, project.settings) === 0) return 'Needs no seats'
  if (!restart && !isOpen(project, team)) return 'Already has all its seats'
  return null
}

// ---------------------------------------------------------------------------
// Looking for seats
// ---------------------------------------------------------------------------

/** What a search is about: `missing` more seats for `team`, free on all of `days`, to add
 *  to `seating` (the seating the team has on those days). */
interface Search {
  project: Project
  team: Team
  days: readonly Weekday[]
  seating: Seating
  missing: number
}

/** Seats to take in one area. */
interface Take {
  area: Area
  seats: number
}

/** Seats to add on one floor, in the order in which the areas were picked. */
interface Block {
  takes: Take[]
  /** How good the block is. Ranks are compared number by number; lower is better. */
  rank: number[]
}

/** What one floor has to offer to a search. */
interface FloorRoom {
  floor: Floor
  /** Position of the floor in the building. */
  index: number
  /** Areas of the allowed kinds with at least one seat free for the team, in floor order. */
  candidates: Area[]
  /** Seats free for the team per candidate, by area id. */
  free: ReadonlyMap<Id, number>
  /** The free seats of all candidates together. */
  total: number
}

const DESKS: readonly AreaKind[] = ['desks']
const DESKS_AND_OVERFLOW: readonly AreaKind[] = ['desks', 'overflow']

/** The kinds of area to look in, one attempt after the other: desks on their own first;
 *  overflow seats join only when that fails and the planner allows them. */
function attempts(useOverflow: boolean): (readonly AreaKind[])[] {
  return useOverflow ? [DESKS, DESKS_AND_OVERFLOW] : [DESKS]
}

/** The seats of a seating that count: those in desk and overflow areas, listed in plan
 *  order. Seats in a room or in an area that is gone are no seats; the reducer drops them
 *  as well when the proposal is applied. */
function seatableOnly(project: Project, seating: Seating): Seating {
  const clean: Seating = {}
  for (const floor of project.floors) {
    for (const area of floor.areas) {
      const seats = seating[area.id] ?? 0
      if (seats > 0 && isSeatable(area.kind)) clean[area.id] = seats
    }
  }
  return clean
}

function withTakes(seating: Seating, takes: readonly Take[]): Seating {
  const next: Seating = { ...seating }
  for (const { area, seats } of takes) next[area.id] = (next[area.id] ?? 0) + seats
  return next
}

/** The floors on which a seating holds seats, in building order. */
function floorsOf(project: Project, seating: Seating): Floor[] {
  return project.floors.filter((f) => f.areas.some((a) => (seating[a.id] ?? 0) > 0))
}

/** The areas of a floor in which teams close to this one in the organisation sit on one of
 *  the days the search is for: teams on the same ART, or, when none of them is there, teams
 *  in the same domain. */
function groupMates(search: Search, floor: Floor): Area[] {
  const { team } = search
  if (team.artId !== null) {
    const artMates = matesWhere(search, floor, (other) => other.artId === team.artId)
    if (artMates.length > 0) return artMates
  }
  if (team.domainId === null) return []
  return matesWhere(search, floor, (other) => other.domainId === team.domainId)
}

function matesWhere(search: Search, floor: Floor, isMate: (other: Team) => boolean): Area[] {
  const { project, team, days } = search
  const others = project.teams.filter((other) => other.id !== team.id && isMate(other))
  return floor.areas.filter((area) =>
    others.some((other) => days.some((day) => (seatingOn(other, day)[area.id] ?? 0) > 0)),
  )
}

function roomOn(search: Search, floor: Floor, index: number, kinds: readonly AreaKind[]): FloorRoom {
  const { project, team, days, seating } = search
  const candidates: Area[] = []
  const free = new Map<Id, number>()
  let total = 0
  for (const area of floor.areas) {
    if (!kinds.includes(area.kind)) continue
    // The team's own seats are not in its way, but the ones it keeps are not free either.
    const seats = freeOnDays(project, area.id, days, team.id) - (seating[area.id] ?? 0)
    if (seats <= 0) continue
    candidates.push(area)
    free.set(area.id, seats)
    total += seats
  }
  return { floor, index, candidates, free, total }
}

/** Grows a block until it holds `wanted` seats (at least one). It begins at `start`, or
 *  next to the areas the team holds on the floor when there is no start, and keeps adding
 *  the nearest candidate. Every area is taken in full, except the last one, which gets what
 *  is left. Null when the candidates run out first. */
function growBlock(room: FloorRoom, held: readonly Area[], start: Area | undefined, wanted: number): Take[] | null {
  const takes: Take[] = []
  let remaining: readonly Area[] = room.candidates
  let left = wanted
  let next = start ?? nearestFirst(room.floor, held, remaining)[0]
  while (next !== undefined) {
    const area = next
    const seats = Math.min(left, room.free.get(area.id) ?? 0)
    takes.push({ area, seats })
    left -= seats
    if (left === 0) return takes
    remaining = remaining.filter((c) => c !== area)
    next = nearestFirst(room.floor, [...held, ...takes.map((t) => t.area)], remaining)[0]
  }
  return null
}

/** Rates a block. `origin` is the area it grew from: the first area the team holds on the
 *  floor, or the candidate the block started with. */
function rankBlock(
  search: Search,
  room: FloorRoom,
  held: readonly Area[],
  takes: readonly Take[],
  origin: Area,
  mates: readonly Area[],
): number[] {
  const { team, seating } = search
  const { floor } = room
  const groups = clusterAreas(floor, [...held, ...takes.map((t) => t.area)].map((a) => a.id))
  const newAreas = takes.filter((t) => seating[t.area.id] === undefined)
  let overflowSeats = 0
  for (const t of takes) if (t.area.kind === 'overflow') overflowSeats += t.seats
  const last = takes[takes.length - 1]
  const lonelySeat = last !== undefined && (room.free.get(last.area.id) ?? 0) - last.seats === 1
  const nearGroup = takes.some((t) => mates.some((mate) => areNeighbours(floor, t.area, mate)))
  const aspect = planAspect(floor)
  let spread = 0
  for (const t of takes) spread += centerDistance(t.area.rect, origin.rect, aspect)
  return [
    // The floor the team prefers, when it has one.
    team.homeFloorId !== null && team.homeFloorId !== floor.id ? 1 : 0,
    // The team in as few separate places on the floor as possible.
    groups.length,
    // At desks rather than in overflow seats, when overflow areas take part at all.
    overflowSeats,
    // In as few areas as possible: rather more seats where it sits than one more area.
    newAreas.length,
    // Not one single seat left over in the area that is only partly taken.
    lonelySeat ? 1 : 0,
    // Next to a team of the same ART, or else of the same domain, that is in on the same day.
    nearGroup ? 0 : 1,
    // Compact. Rounded, so that blocks which are equally compact do not differ by
    // floating point noise and the tie is settled by the order below.
    Math.round(spread * 1e6) / 1e6,
    // The lower floor, then the earlier area.
    room.index,
    floor.areas.indexOf(origin),
  ]
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** The best block of `wanted` seats on one floor, or null when the floor does not have
 *  that many free (or nothing is wanted). */
function bestBlockOn(search: Search, room: FloorRoom, wanted: number): Block | null {
  if (wanted <= 0 || room.total < wanted) return null
  const held = room.floor.areas.filter((a) => (search.seating[a.id] ?? 0) > 0)
  const mates = groupMates(search, room.floor)
  // A team that already sits on the floor grows from where it sits. For a team that is
  // new to the floor every candidate is tried as the place to start.
  const sitsHere = held.length > 0
  let best: Block | null = null
  for (const origin of sitsHere ? held.slice(0, 1) : room.candidates) {
    const takes = growBlock(room, held, sitsHere ? undefined : origin, wanted)
    if (!takes) continue
    const rank = rankBlock(search, room, held, takes, origin, mates)
    if (!best || compareRanks(rank, best.rank) < 0) best = { takes, rank }
  }
  return best
}

/** The best block on ONE floor that holds everything that is missing, or null when no
 *  floor has the room (or nothing is missing). */
function findBlock(search: Search, kinds: readonly AreaKind[]): Block | null {
  const { project, seating, missing } = search
  if (missing <= 0) return null
  // A team that already sits somewhere stays on its floors: seats on another floor would
  // split it, and that is the last resort (see `splitOverFloors`).
  const own = floorsOf(project, seating)
  let best: Block | null = null
  for (const floor of own.length > 0 ? own : project.floors) {
    const block = bestBlockOn(search, roomOn(search, floor, project.floors.indexOf(floor), kinds), missing)
    if (block && (!best || compareRanks(block.rank, best.rank) < 0)) best = block
  }
  return best
}

/** Spreads what is missing over the floors and returns the seating that results: first the
 *  floors the team already sits on (so that it ends up on as few floors as possible), then
 *  the floor with the most free seats. Null when all floors together do not have the seats:
 *  then nothing is placed. */
function splitOverFloors(search: Search, useOverflow: boolean): Seating | null {
  const { project, missing } = search
  const ownFloors = new Set(floorsOf(project, search.seating).map((floor) => floor.id))
  for (const kinds of attempts(useOverflow)) {
    const rooms = project.floors.map((floor, index) => roomOn(search, floor, index, kinds))
    if (rooms.reduce((sum, room) => sum + room.total, 0) < missing) continue
    // Floors that tie stay in building order: the sort is stable.
    rooms.sort(
      (a, b) => Number(ownFloors.has(b.floor.id)) - Number(ownFloors.has(a.floor.id)) || b.total - a.total,
    )
    const takes: Take[] = []
    let left = missing
    for (const room of rooms) {
      if (left <= 0) break
      // A floor without a free seat (the team's own floor may be full) has nothing to give.
      const wanted = Math.min(left, room.total)
      const block = wanted > 0 ? bestBlockOn(search, room, wanted) : null
      if (!block) continue
      takes.push(...block.takes)
      left -= wanted
    }
    return withTakes(search.seating, takes)
  }
  return null
}

/** All seats that are free for the search, on every floor together. */
function freeEverywhere(search: Search, useOverflow: boolean): number {
  const kinds = useOverflow ? DESKS_AND_OVERFLOW : DESKS
  return search.project.floors.reduce((sum, floor, index) => sum + roomOn(search, floor, index, kinds).total, 0)
}

// ---------------------------------------------------------------------------
// One team
// ---------------------------------------------------------------------------

/** A team day that could only be completed by spreading the team over floors. */
interface SplitDay {
  day: Weekday
  /** Seats that had to be found. */
  missing: number
  /** Names of the floors the team already sat on that day; empty when it had no seats. */
  ownFloors: string[]
}

/** A team day that could not be completed. */
interface NoRoomDay {
  day: Weekday
  /** Seats that are missing, seats the team does hold, and seats that are free for it in
   *  the whole building. */
  missing: number
  holds: number
  free: number
}

/** Where a team sits once its missing seats are placed, and how each team day ended. */
interface TeamPlan {
  seating: Seating
  /** Only the days that differ from `seating`. */
  daySeating: Partial<Record<Weekday, Seating>>
  /** True when the plan gives the team seats it did not have. */
  added: boolean
  /** The team days in three lists, each in week order: complete without spreading the team
   *  over more floors, complete by doing so, or not complete. */
  seated: Weekday[]
  split: SplitDay[]
  noRoom: NoRoomDay[]
}

/** Works out where the missing seats of one team go. The seats the team holds are kept and
 *  built on; a team that starts from scratch comes in without seats. */
function planTeam(project: Project, team: Team, useOverflow: boolean): TeamPlan {
  const need = seatsNeeded(team, project.settings)
  const searchFor = (days: readonly Weekday[], seating: Seating): Search => ({
    project,
    team,
    days,
    seating,
    missing: need - sumSeats(seating),
  })

  let normal = seatableOnly(project, team.seating)
  const exceptions: Partial<Record<Weekday, Seating>> = {}
  for (const day of team.days) {
    const own = team.daySeating[day]
    if (own !== undefined) exceptions[day] = seatableOnly(project, own)
  }
  // The days on which the team sits in its normal seating as it comes in.
  const normalDays = team.days.filter((day) => exceptions[day] === undefined)
  let added = false

  // On one floor. Desks are tried for all days together and then day by day before
  // overflow seats are, so that those are only used on days that are too busy for desks.
  for (const kinds of attempts(useOverflow)) {
    // The normal seating: seats that are free on every day that still uses it.
    const together = normalDays.filter((day) => exceptions[day] === undefined)
    const shared = together.length > 0 ? findBlock(searchFor(together, normal), kinds) : null
    if (shared) {
      normal = withTakes(normal, shared.takes)
      added = true
    }
    // When that fails because some day is full, the days that do have room should still end
    // up in the same seats: one block that is free on all of them, before each day is
    // looked at on its own.
    const withRoom = shared
      ? []
      : together.filter((day) => findBlock(searchFor([day], normal), kinds) !== null)
    if (withRoom.length >= 2) {
      const common = findBlock(searchFor(withRoom, normal), kinds)
      if (common) {
        for (const day of withRoom) exceptions[day] = withTakes(normal, common.takes)
        added = true
      }
    }
    // A day that is still short keeps the seats it has and gets the rest for that day
    // only. From then on it has a seating of its own.
    for (const day of team.days) {
      const current = exceptions[day] ?? normal
      const block = findBlock(searchFor([day], current), kinds)
      if (!block) continue
      exceptions[day] = withTakes(current, block.takes)
      added = true
    }
  }

  // The last resort for a day that is still short: over several floors, or not at all.
  const seated: Weekday[] = []
  const split: SplitDay[] = []
  const noRoom: NoRoomDay[] = []
  for (const day of team.days) {
    const current = exceptions[day] ?? normal
    const search = searchFor([day], current)
    if (search.missing <= 0) {
      seated.push(day)
      continue
    }
    const spread = splitOverFloors(search, useOverflow)
    if (!spread) {
      noRoom.push({ day, missing: search.missing, holds: sumSeats(current), free: freeEverywhere(search, useOverflow) })
      continue
    }
    exceptions[day] = spread
    added = true
    split.push({ day, missing: search.missing, ownFloors: floorsOf(project, current).map((f) => f.name) })
  }

  // When days of the normal seating had to be completed one by one, each of them has a
  // seating of its own now. What most of them share (the earliest day's on a tie) becomes
  // the normal seating, so that as few days as possible are exceptions. The same goes for
  // a team that came in with a seating of its own on every day: its normal seating is not
  // in use. No seat moves by this: every day keeps the seating it has.
  const pool = normalDays.length > 0 ? normalDays : team.days
  if (pool.some((day) => exceptions[day] !== undefined)) {
    const own = pool.map((day) => ({ day, seating: exceptions[day] ?? normal }))
    let sharedByMost = 0
    for (const { day, seating } of own) {
      exceptions[day] = seating
      const sharedBy = own.filter((other) => sameSeating(other.seating, seating)).length
      if (sharedBy > sharedByMost) {
        normal = seating
        sharedByMost = sharedBy
      }
    }
  }

  // Seatings are listed in plan order, so the proposal does not depend on the key order of
  // what came in. A day that sits like the normal seating is no exception.
  const daySeating: Partial<Record<Weekday, Seating>> = {}
  for (const day of team.days) {
    const own = exceptions[day]
    if (own !== undefined && !sameSeating(own, normal)) daySeating[day] = seatableOnly(project, own)
  }
  return { seating: seatableOnly(project, normal), daySeating, added, seated, split, noRoom }
}

// ---------------------------------------------------------------------------
// Telling the planner what happened
// ---------------------------------------------------------------------------

/** One sentence, without a full stop, about how the team days of a team ended. */
function describe(project: Project, days: readonly Weekday[], plan: TeamPlan, useOverflow: boolean): string {
  if (plan.split.length === 0 && plan.noRoom.length === 0) return `Seated ${whereText(project, days, plan)}`
  const clauses: string[] = []
  if (plan.seated.length > 0) clauses.push(`seated on ${dayNames(plan.seated)}`)
  clauses.push(...splitClauses(project, plan, useOverflow))
  if (plan.noRoom.length > 0) clauses.push(noRoomClause(plan.noRoom, useOverflow))
  const sentence = clauses.join('; ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** "in NE 1 and NE 2 on Floor 4, and on Thursday in N 1 and N 2": the normal seating
 *  first, then every day on which the team sits somewhere else. */
function whereText(project: Project, days: readonly Weekday[], plan: TeamPlan): string {
  const places: string[] = []
  const usualInUse = days.some((day) => plan.daySeating[day] === undefined)
  if (usualInUse) places.push(placeText(project, plan.seating, true))

  // Days that share an exception are named together.
  const exceptions: { days: Weekday[]; seating: Seating }[] = []
  for (const day of days) {
    const seating = plan.daySeating[day]
    if (seating === undefined) continue
    const same = exceptions.find((e) => sameSeating(e.seating, seating))
    if (same) same.days.push(day)
    else exceptions.push({ days: [day], seating })
  }
  const usualFloors = floorsOf(project, plan.seating)
  for (const exception of exceptions) {
    const floors = floorsOf(project, exception.seating)
    // The floor is only worth naming again when the day is spent on another one.
    const sameFloor = usualInUse && usualFloors.length === 1 && floors.length === 1 && floors[0] === usualFloors[0]
    places.push(`on ${dayNames(exception.days)} ${placeText(project, exception.seating, !sameFloor)}`)
  }
  return joinClauses(places)
}

/** "in NE 1 and NE 2 on Floor 4"; on two floors "in A on Floor 3 and in B on Floor 4". */
function placeText(project: Project, seating: Seating, nameFloor: boolean): string {
  const parts: string[] = []
  for (const floor of project.floors) {
    const names = floor.areas.filter((a) => (seating[a.id] ?? 0) > 0).map((a) => a.name)
    if (names.length > 0) parts.push(`in ${joinAnd(names)}${nameFloor ? ` on ${floor.name}` : ''}`)
  }
  return joinAnd(parts)
}

/** "split over Floor 3 and Floor 4 on Tuesday: no floor has 12 free desks", one clause
 *  for all days that are split over the same floors for the same reason. */
function splitClauses(project: Project, plan: TeamPlan, useOverflow: boolean): string[] {
  const clauses: { where: string; why: string; days: Weekday[] }[] = []
  for (const { day, missing, ownFloors } of plan.split) {
    const floors = floorsOf(project, plan.daySeating[day] ?? plan.seating)
    const where = `split over ${joinAnd(floors.map((f) => f.name))}`
    const seats = `${missing} ${missing === 1 ? 'seat' : 'seats'}`
    const why =
      ownFloors.length === 0
        ? `no floor has ${missing} free ${useOverflow ? 'seats' : 'desks'}`
        : `${joinAnd(ownFloors)} ${ownFloors.length === 1 ? 'has' : 'have'} no room for the ${seats} still missing`
    const same = clauses.find((c) => c.where === where && c.why === why)
    if (same) same.days.push(day)
    else clauses.push({ where, why, days: [day] })
  }
  return clauses.map((c) => `${c.where} on ${dayNames(c.days)}: ${c.why}`)
}

/** "no room on Tuesday and Thursday: needs 12 seats, at most 7 desks are free". With
 *  several days the largest numbers are given. */
function noRoomClause(days: readonly NoRoomDay[], useOverflow: boolean): string {
  const missing = Math.max(...days.map((d) => d.missing))
  const free = Math.max(...days.map((d) => d.free))
  const upTo = days.some((d) => d.missing !== missing) ? 'up to ' : ''
  const more = days.some((d) => d.holds > 0) ? ' more' : ''
  const needs = `needs ${upTo}${missing}${more} ${missing === 1 ? 'seat' : 'seats'}`
  const atMost = days.some((d) => d.free !== free)
  return `no room on ${dayNames(days.map((d) => d.day))}: ${needs}, ${freeText(free, atMost, useOverflow)}`
}

function freeText(free: number, atMost: boolean, withOverflow: boolean): string {
  const one = withOverflow ? 'desk or overflow seat' : 'desk'
  const many = withOverflow ? 'desks and overflow seats' : 'desks'
  if (free === 0) return `no ${one} is free`
  return `${atMost ? 'at most ' : ''}${free} ${free === 1 ? `${one} is` : `${many} are`} free`
}

function dayNames(days: readonly Weekday[]): string {
  return joinAnd(days.map((day) => WEEKDAY_NAME[day]))
}

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Like `joinAnd`, for parts that contain "and" themselves: "a and b, and c". */
function joinClauses(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
