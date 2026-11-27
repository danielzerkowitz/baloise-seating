import { dayLoad, freeOnDays, seatsNeeded } from './model'
import { WEEKDAY_NAME, WEEKDAYS, type DayWish, type Id, type Project, type Team, type Weekday } from './types'

/* When a day is too full, which team could move to which other day? Suggestions only: the
   planner decides and usually has to ask the team first. */

export interface DayMove {
  teamId: Id
  from: Weekday
  to: Weekday
  /** Seats the team needs, i.e. what the move takes off `from` and adds to `to`. */
  seats: number
  /** Seats needed on `from` and on `to` after the move. */
  fromAfter: number
  toAfter: number
  /** True when the team said it wants or could do the target day; false when nothing was
   *  said about that day and the team would have to be asked. */
  agreed: boolean
  /** True when this one move brings `from` back within the plannable desks. */
  resolves: boolean
  /** A plain sentence: "Wednesday has 28 desks free and Alpha said it could come then". */
  reason: string
}

/** What a team can have said about a day it might move to. A day it cannot come on is
 *  never suggested. */
type OpenWish = Exclude<DayWish, 'cannot'>

/** The better the team likes the day, the lower. */
const WISH_RANK: Record<OpenWish, number> = { want: 0, can: 1, none: 2 }

/** A possible move with everything the ranking looks at. */
interface Candidate {
  move: DayMove
  wish: OpenWish
  /** The target day stays within its plannable desks. */
  fits: boolean
  /** The team's normal seating is free on the target day. */
  keepsSeats: boolean
  /** Positions in the team list and in the week. */
  teamIndex: number
  dayIndex: number
}

/** Up to `limit` moves that relieve the given day, best first. Empty when the day is not
 *  over its plannable desks. */
export function suggestDayMoves(project: Project, day: Weekday, limit = 3): DayMove[] {
  const load = dayLoad(project, day)
  const target = load.plannableDesks
  const over = load.needed - target
  if (over <= 0) return []

  const candidates: Candidate[] = []
  for (const [teamIndex, team] of project.teams.entries()) {
    const seats = seatsNeeded(team, project.settings)
    if (!team.days.includes(day) || seats === 0) continue
    for (const [dayIndex, to] of WEEKDAYS.entries()) {
      const wish = team.wishes[to]
      if (wish === 'cannot' || team.days.includes(to)) continue
      const neededThere = dayLoad(project, to).needed
      const toAfter = neededThere + seats
      // A target day with more people than desks would only move the problem.
      if (toAfter > load.capacity.desks) continue
      candidates.push({
        move: {
          teamId: team.id,
          from: day,
          to,
          seats,
          fromAfter: load.needed - seats,
          toAfter,
          agreed: wish === 'want' || wish === 'can',
          resolves: seats >= over,
          reason: reasonFor(team, to, wish, target - neededThere, toAfter - target),
        },
        wish,
        fits: toAfter <= target,
        keepsSeats: keepsSeats(project, team, to),
        teamIndex,
        dayIndex,
      })
    }
  }

  candidates.sort(
    (a, b) =>
      // 1. A day that stays within its plannable desks.
      Number(b.fits) - Number(a.fits) ||
      // 2. A day the team asked for, then one it said it could do, then one nobody asked about.
      WISH_RANK[a.wish] - WISH_RANK[b.wish] ||
      // 3. A move that brings the full day back within its desks on its own.
      Number(b.move.resolves) - Number(a.move.resolves) ||
      // 4. The smallest team that does the job; when no single team does, the largest.
      (a.move.resolves ? a.move.seats - b.move.seats : b.move.seats - a.move.seats) ||
      // 5. A move after which the team can sit where it always sits.
      Number(b.keepsSeats) - Number(a.keepsSeats) ||
      // 6. The emptier target day.
      a.move.toAfter - b.move.toAfter ||
      // 7. Team-list order, then week order.
      a.teamIndex - b.teamIndex ||
      a.dayIndex - b.dayIndex,
  )

  // One suggestion per team: its best one.
  const moves: DayMove[] = []
  const suggested = new Set<Id>()
  for (const { move } of candidates) {
    if (moves.length >= limit) break
    if (suggested.has(move.teamId)) continue
    suggested.add(move.teamId)
    moves.push(move)
  }
  return moves
}

/** True when every area of the team's normal seating has the team's seats free on `day`,
 *  so that the team could move there without moving desks. */
function keepsSeats(project: Project, team: Team, day: Weekday): boolean {
  return Object.keys(team.seating).every(
    (areaId) => freeOnDays(project, areaId, [day], team.id) >= (team.seating[areaId] ?? 0),
  )
}

/** "Wednesday has 28 desks free and Claims Intake said it could come then". `free` are the
 *  plannable desks nobody needs on the target day yet. `intoReserve` is how many desks of
 *  the reserve kept for visitors the day would use once the team has moved there (zero or
 *  less: none); such a move is possible, but the sentence says what it costs. */
function reasonFor(team: Team, to: Weekday, wish: OpenWish, free: number, intoReserve: number): string {
  const dayName = WEEKDAY_NAME[to]
  const who = team.name.trim() || 'this team'
  const room =
    intoReserve <= 0
      ? `${dayName} has ${free} ${free === 1 ? 'desk' : 'desks'} free`
      : `${dayName} has room only by using ${intoReserve} ${intoReserve === 1 ? 'desk' : 'desks'} of the reserve`
  if (wish === 'want') return `${room} and ${who} wants to come then`
  if (wish === 'can') return `${room} and ${who} said it could come then`
  return `${room}; ${who} was not asked about ${dayName} yet`
}
