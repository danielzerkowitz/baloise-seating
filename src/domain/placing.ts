import { freeOnDays, hasDayException, indexAreas, isSeatable, seatingOn, seatsNeeded, sumSeats } from './model'
import type { Action } from './reducer'
import type { Area, Id, Project, Seating, SeatingScope, Team, Weekday } from './types'

/* What happens when the planner points a team at an area on the plan. The preview on hover
   and the click itself both come from here, so they always agree. */

/** The scope an edit really has. A team that already sits differently on the shown day can
 *  only be edited for that day: its normal seating is not what is on screen. */
export function effectiveScope(team: Team, day: Weekday, scope: 'all' | 'day'): SeatingScope {
  return scope === 'day' || hasDayException(team, day) ? day : 'all'
}

/** The seating an edit with this scope works on. */
export function scopedSeating(team: Team, scope: SeatingScope): Seating {
  return scope === 'all' ? team.seating : seatingOn(team, scope)
}

/** The days on which an edit with this scope changes where the team sits: for `all`, every
 *  team day without its own exception. */
export function scopedDays(team: Team, scope: SeatingScope): Weekday[] {
  if (scope !== 'all') return team.days.includes(scope) ? [scope] : []
  return team.days.filter((d) => !hasDayException(team, d))
}

/** Seats held in areas that are meant for seating, within a seating. */
export function validSeats(project: Project, seating: Seating): number {
  const areas = indexAreas(project)
  let total = 0
  for (const areaId in seating) {
    const ref = areas.get(areaId)
    if (ref && isSeatable(ref.area.kind)) total += seating[areaId] ?? 0
  }
  return total
}

export type PlaceIntent =
  /** A click gives the team this many seats here. */
  | { type: 'add'; seats: number }
  /** A click takes the team's seats here away. */
  | { type: 'remove'; seats: number }
  | {
      type: 'blocked'
      /** - `no-seating`: the area is a room
       *  - `full`: no seat is free here on the days concerned
       *  - `not-in`: the shown day is not a team day of this team
       *  - `complete`: the team already holds all the seats it needs */
      reason: 'no-seating' | 'full' | 'not-in' | 'complete'
    }

/** What clicking `area` would do for `team` while `day` is shown. */
export function placeIntent(project: Project, team: Team, area: Area, day: Weekday, scope: 'all' | 'day'): PlaceIntent {
  if (!team.days.includes(day)) return { type: 'blocked', reason: 'not-in' }
  const target = effectiveScope(team, day, scope)
  const seating = scopedSeating(team, target)
  const held = seating[area.id] ?? 0
  // Taking seats away is always possible, also from a room where they should never have been.
  if (held > 0) return { type: 'remove', seats: held }
  if (!isSeatable(area.kind)) return { type: 'blocked', reason: 'no-seating' }
  const remaining = seatsNeeded(team, project.settings) - validSeats(project, seating)
  if (remaining <= 0) return { type: 'blocked', reason: 'complete' }
  const free = freeOnDays(project, area.id, scopedDays(team, target), team.id)
  if (free <= 0) return { type: 'blocked', reason: 'full' }
  return { type: 'add', seats: Math.min(remaining, free) }
}

/** The action for clicking `area` with `team`, or null when the click does nothing. */
export function placeAction(project: Project, team: Team, area: Area, day: Weekday, scope: 'all' | 'day'): Action | null {
  const intent = placeIntent(project, team, area, day, scope)
  if (intent.type === 'blocked') return null
  return {
    type: 'seat/set',
    teamId: team.id,
    areaId: area.id,
    seats: intent.type === 'add' ? intent.seats : 0,
    scope: effectiveScope(team, day, scope),
  }
}

/** A sentence for a blocked click, to show the planner why nothing happened. */
export function blockedMessage(team: Team, area: Area, reason: Extract<PlaceIntent, { type: 'blocked' }>['reason']): string {
  switch (reason) {
    case 'no-seating':
      return `${area.name} is not for seating.`
    case 'full':
      return `${area.name} has no free seat on ${team.name}'s days.`
    case 'not-in':
      return `${team.name} is not in on this day.`
    case 'complete':
      return `${team.name} already has all its seats. Take seats away first to move the team.`
  }
}

/** Total seats in a seating, including seats in areas that no longer allow seating. */
export function heldSeats(seating: Seating): number {
  return sumSeats(seating)
}

/** Area ids of a seating that are on the given floor's area list, in that order. */
export function areasOf(seating: Seating, areas: readonly Area[]): Id[] {
  return areas.filter((a) => (seating[a.id] ?? 0) > 0).map((a) => a.id)
}
