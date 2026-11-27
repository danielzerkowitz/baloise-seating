import { autoSeat, type AutoSeatOutcome } from './autoseat'
import { findIssues, type Issue } from './conflicts'
import { suggestDayMoves } from './dayMoves'
import { dayLoad, dayOccupancy, findFloor, findTeam, hasDayException, indexAreas, isSeatable, seatingOn, teamDayStatus } from './model'
import { effectiveScope } from './placing'
import { reduce, type Action } from './reducer'
import { WEEKDAY_NAME, WEEKDAYS, type Area, type Project, type Team, type Weekday } from './types'

/* One-click ways out of an issue. A fix is a ready-made action for the store; applying it
   is a normal, undoable edit. Only fixes that certainly help are offered: every candidate
   is tried out on the project first, and dropped when it does not keep the promise that
   `certainlyHelps` spells out. */

export interface Fix {
  /** Unique within the fixes of one issue. */
  id: string
  /** What the button says, as an action: "Move Alpha to Wednesday", "Release 2 seats". */
  label: string
  /** What applying it does, in one sentence, for a tooltip. */
  explanation: string
  action: Action
}

/** No issue is given more fixes than this. Only a day that is too full has that many ways
 *  out (see `moveToAnotherDay`); every other rule has one or two. */
const MAX_FIXES = 3

/** Fixes for one issue, best first; often empty and never more than three. Computed on
 *  demand (when an issue is shown), not for the whole list. */
export function suggestFixes(project: Project, issue: Issue): Fix[] {
  // The issue as the project has it now. One that is gone (solved in the meantime, or
  // never there) has nothing left to fix.
  const current = findIssues(project).find((each) => each.id === issue.id)
  if (!current) return []
  return candidates(project, current).filter((fix) => certainlyHelps(project, current, fix.action))
}

// ---------------------------------------------------------------------------
// The promise: what a fix does, and what it never costs
// ---------------------------------------------------------------------------

/** Tries the action out on the project. A fix is worth a button when it solves the issue
 *  it is offered for and costs nothing that matters: no seats in conflict that were not in
 *  conflict before, no team with fewer of the seats it needs, no day filled beyond the
 *  desks of the building. Lesser consequences (a note, a warning such as a day that now
 *  uses the reserve) are for the planner to weigh: the explanation says what the fix does,
 *  and the edit can be undone. */
function certainlyHelps(project: Project, issue: Issue, action: Action): boolean {
  const result = reduce(project, action)
  const issuesAfter = findIssues(result)
  return (
    isSolved(project, result, issue, issuesAfter) &&
    !addsToConflicts(project, result, issuesAfter) &&
    !takesNeededSeats(project, result) &&
    !overfillsDay(project, result)
  )
}

/** True when the result no longer has the problem that the issue reports. */
function isSolved(before: Project, after: Project, issue: Issue, issuesAfter: readonly Issue[]): boolean {
  switch (issue.rule) {
    case 'area-over-capacity':
    case 'seats-in-room':
      // Whichever teams are still involved: no seat of this conflict may be left.
      return seatsInConflict(after, issue) <= 0
    case 'day-over-capacity':
    case 'day-needs-overflow':
    case 'day-uses-reserve':
      // One team moving away rarely brings a full day all the way back, so every seat less
      // that the day needs counts as help.
      return issue.day !== null && dayLoad(after, issue.day).needed < dayLoad(before, issue.day).needed
    default: {
      const problem = problemOf(issue)
      return !issuesAfter.some((each) => problemOf(each) === problem)
    }
  }
}

/** What an issue about a team on a day comes down to, without the parts of its id that can
 *  change while the problem stays: the floor or the area it points at, and whether a team
 *  that should sit in one place is apart over floors or on one floor. */
function problemOf(issue: Issue): string {
  const apart = issue.rule === 'team-split-floors' || issue.rule === 'team-scattered'
  // No seats or too few: either way the team still needs seats that day. A fix that turns
  // "no seats" into "too few" has not given the team its seats.
  const needsSeats = issue.rule === 'team-unseated' || issue.rule === 'team-short'
  return `${apart ? 'apart' : needsSeats ? 'needs-seats' : issue.rule}|${issue.day}|${issue.teamIds.join('+')}`
}

/** True when the result has seats in conflict that were not in conflict before: a conflict
 *  in an area that is new, or one that grew. */
function addsToConflicts(before: Project, after: Project, issuesAfter: readonly Issue[]): boolean {
  return issuesAfter.some((each) => seatsInConflict(after, each) > seatsInConflict(before, each))
}

/** The seats that the conflict of an issue is about in the given project: the seats held
 *  beyond what the area has (`area-over-capacity`) or the seats placed in the room
 *  (`seats-in-room`). Zero or less when the project does not have that conflict, and zero
 *  for an issue of any other rule. */
function seatsInConflict(project: Project, issue: Issue): number {
  const { day, areaId } = issue
  if (day === null || areaId === null) return 0
  switch (issue.rule) {
    case 'area-over-capacity': {
      const occupancy = dayOccupancy(project, day).get(areaId)
      return occupancy ? occupancy.used - occupancy.area.capacity : 0
    }
    case 'seats-in-room': {
      const team = findTeam(project, issue.teamIds[0])
      return team ? (seatingOn(team, day)[areaId] ?? 0) : 0
    }
    default:
      return 0
  }
}

/** True when a team ends up with fewer of the seats it needs on one of its team days.
 *  Seating a team from scratch takes its seats away on a day that has no room for it, and
 *  without its day exception a team may hold less than the exception gave it. */
function takesNeededSeats(before: Project, after: Project): boolean {
  return after.teams.some((team) => {
    const was = findTeam(before, team.id)
    if (was === undefined) return false
    if (team.days.some((day) => seatsCovered(after, team, day) < seatsCovered(before, was, day))) return true
    // A team that moves to another day must arrive there with the seats it had, which the
    // comparison day by day cannot see: with as many team days as before, it may not hold
    // fewer of its seats over the week. (Taking a day off the plan gives seats up on purpose.)
    if (team.days.length !== was.days.length) return false
    const overTheWeek = (project: Project, each: Team) =>
      each.days.reduce((sum, day) => sum + seatsCovered(project, each, day), 0)
    return overTheWeek(after, team) < overTheWeek(before, was)
  })
}

/** How many of the seats a team needs on a day it also holds. */
function seatsCovered(project: Project, team: Team, day: Weekday): number {
  const status = teamDayStatus(project, team, day)
  return Math.min(status.seated, status.needed)
}

/** True when a day gets fuller and then needs more seats than the building has desks:
 *  planning a wanted day, or moving a team to another day, must not make that day the next
 *  problem. This is also what keeps a fix from causing the third kind of conflict, a day
 *  that cannot fit, or from adding to one. */
function overfillsDay(before: Project, after: Project): boolean {
  return WEEKDAYS.some((day) => {
    const load = dayLoad(after, day)
    return load.needed > dayLoad(before, day).needed && load.needed > load.capacity.desks
  })
}

// ---------------------------------------------------------------------------
// The candidates, rule by rule
// ---------------------------------------------------------------------------

/** Everything that might help with the issue, best first. Not tried out yet. */
function candidates(project: Project, issue: Issue): Fix[] {
  // Which day to plan is for the planner and the team to decide.
  if (issue.rule === 'no-team-days') return []
  const { day, areaId } = issue
  // The team of a rule about one team. (An area or a day that is too full involves several
  // teams; those rules choose among them further down.)
  const team = findTeam(project, issue.teamIds[0])
  // Every other rule names a day and at least one team.
  if (!team || day === null) return []
  const area = areaId === null ? undefined : indexAreas(project).get(areaId)?.area

  switch (issue.rule) {
    case 'area-over-capacity':
      return area ? reseatFromArea(project, area, day) : []
    case 'seats-in-room':
      return area ? [removeFromRoom(team, area, day)] : []
    case 'day-over-capacity':
    case 'day-needs-overflow':
    case 'day-uses-reserve':
      return moveToAnotherDay(project, day)
    case 'team-unseated':
    case 'team-short': {
      const seat = seatingFixes(project, team, 'Seat automatically', 'complete')
      // A day with a seating of its own may simply go back to the normal one. Like every
      // fix it is only kept when it really gives the team its seats that day.
      return hasDayException(team, day) ? [useNormalSeating(team, day), ...seat] : seat
    }
    case 'team-split-floors':
    case 'team-scattered':
      return seatingFixes(project, team, 'Reseat in one place', 'restart')
    case 'off-home-floor': {
      const home = findFloor(project, team.homeFloorId)
      return home ? seatingFixes(project, team, `Reseat on ${home.name}`, 'restart') : []
    }
    case 'overflow-used':
      // Automatic seating keeps to the desks unless it is told to use overflow seats.
      return seatingFixes(project, team, 'Move to desks', 'restart')
    case 'team-over-seated':
      return [releaseSurplus(project, team, day)]
    case 'seat-differs':
      return [useNormalSeating(team, day)]
    case 'wish-unmet':
      return [planDay(team, day)]
    case 'unwanted-day':
      return [unplanDay(team, day)]
  }
}

/** What automatic seating proposes for one team, as an action for that team alone. */
interface Proposal {
  action: Action
  outcome: AutoSeatOutcome
}

/** Asks automatic seating about one team: to add what is missing to the seats it holds
 *  (`complete`) or to seat it again from scratch (`restart`). Null when that changes
 *  nothing for the team. */
function proposeSeating(project: Project, team: Team, mode: 'complete' | 'restart'): Proposal | null {
  const result = autoSeat(project, { teamIds: [team.id], restart: mode === 'restart' })
  const seated = findTeam(result.project, team.id)
  const outcome = result.outcomes.find((each) => each.teamId === team.id)
  if (!seated || seated === team || !outcome) return null
  const { seating, daySeating } = seated
  return { action: { type: 'seat/replace', teamId: team.id, seating, daySeating }, outcome }
}

function seatingFix(team: Team, label: string, proposal: Proposal): Fix {
  return { id: `seat/replace|${team.id}`, label, explanation: proposal.outcome.message, action: proposal.action }
}

/** The proposal of automatic seating for one team as a fix; nothing when it has none. */
function seatingFixes(project: Project, team: Team, label: string, mode: 'complete' | 'restart'): Fix[] {
  const proposal = proposeSeating(project, team, mode)
  return proposal ? [seatingFix(team, label, proposal)] : []
}

/** How many teams of an area that is over capacity are tried for another place; every try
 *  is a full run of automatic seating. */
const TEAMS_TO_RESEAT = 2

/** An area that holds more seats than it has: one of the teams has to sit somewhere else.
 *  Only a team that holds at least as many seats as are too many can bring the area back
 *  within its seats by leaving. Of those, the team with the fewest seats here is the
 *  easiest to find another place for. */
function reseatFromArea(project: Project, area: Area, day: Weekday): Fix[] {
  const occupancy = dayOccupancy(project, day).get(area.id)
  if (!occupancy) return []
  const tooMany = occupancy.used - area.capacity
  // Sorting is stable: teams with equally many seats stay in team-list order.
  const fewestFirst = occupancy.teams
    .filter((holder) => holder.seats >= tooMany)
    .sort((a, b) => a.seats - b.seats)
    .slice(0, TEAMS_TO_RESEAT)
  const fixes: Fix[] = []
  for (const { teamId } of fewestFirst) {
    const team = findTeam(project, teamId)
    const proposal = team ? proposeSeating(project, team, 'restart') : null
    // Only when the team ends up with all its seats on every one of its days: a conflict
    // is not to be traded for a team without seats.
    if (team && proposal && proposal.outcome.result === 'seated') {
      fixes.push(seatingFix(team, `Reseat ${nameOf(team)}`, proposal))
    }
  }
  return fixes
}

function removeFromRoom(team: Team, room: Area, day: Weekday): Fix {
  const seats = seatingOn(team, day)[room.id] ?? 0
  return {
    id: `seat/set|${team.id}|${room.id}`,
    label: 'Remove these seats',
    explanation: `Takes ${nameOf(team)}'s ${plural(seats, 'seat')} out of ${room.name}`,
    // As a click on the plan would: in the team's exception for this day when it has one,
    // in its normal seating otherwise.
    action: { type: 'seat/set', teamId: team.id, areaId: room.id, seats: 0, scope: effectiveScope(team, day, 'all') },
  }
}

/** A day that is too full: the moves `suggestDayMoves` finds best, in its order. */
function moveToAnotherDay(project: Project, day: Weekday): Fix[] {
  const fixes: Fix[] = []
  for (const move of suggestDayMoves(project, day, MAX_FIXES)) {
    const team = findTeam(project, move.teamId)
    if (!team) continue
    fixes.push({
      id: `team/moveDay|${team.id}|${move.to}`,
      label: `Move ${nameOf(team)} to ${WEEKDAY_NAME[move.to]}`,
      // Silence is not consent: a team that said nothing about the day has to be asked.
      explanation: move.agreed ? move.reason : `${move.reason}. Ask the team first`,
      action: { type: 'team/moveDay', id: team.id, from: move.from, to: move.to },
    })
  }
  return fixes
}

/** A team with more seats than it needs gives the surplus back, starting at the end of
 *  the plan: the highest floor, and on it the area that comes last. */
function releaseSurplus(project: Project, team: Team, day: Weekday): Fix {
  const status = teamDayStatus(project, team, day)
  const surplus = status.seated - status.needed
  const scope = effectiveScope(team, day, 'all')
  const seating = seatingOn(team, day)
  // Seats in a room are no surplus: they do not count as seats in the first place.
  const held = project.floors
    .flatMap((floor) => floor.areas)
    .filter((area) => isSeatable(area.kind) && (seating[area.id] ?? 0) > 0)
  const actions: Action[] = []
  let left = surplus
  for (const area of held.reverse()) {
    if (left <= 0) break
    const seats = seating[area.id] ?? 0
    const given = Math.min(left, seats)
    actions.push({ type: 'seat/set', teamId: team.id, areaId: area.id, seats: seats - given, scope })
    left -= given
  }
  return {
    id: `batch|${team.id}|${scope}`,
    label: `Release ${plural(surplus, 'seat')}`,
    explanation: 'Gives back the seats the team does not need',
    action: { type: 'batch', actions },
  }
}

function useNormalSeating(team: Team, day: Weekday): Fix {
  const dayName = WEEKDAY_NAME[day]
  return {
    id: `seat/resetDay|${team.id}|${day}`,
    label: `Use the normal seating on ${dayName}`,
    explanation: `Drops the exception for ${dayName}`,
    action: { type: 'seat/resetDay', teamId: team.id, day },
  }
}

function planDay(team: Team, day: Weekday): Fix {
  const dayName = WEEKDAY_NAME[day]
  return {
    id: `team/setPlanned|${team.id}|${day}`,
    label: `Plan ${dayName}`,
    explanation: `Adds ${dayName} as a team day for ${nameOf(team)}`,
    action: { type: 'team/setPlanned', id: team.id, day, planned: true },
  }
}

function unplanDay(team: Team, day: Weekday): Fix {
  const dayName = WEEKDAY_NAME[day]
  return {
    id: `team/setPlanned|${team.id}|${day}`,
    label: `Take ${dayName} off the plan`,
    explanation: `${team.name.trim() || 'The team'} said it cannot come on ${dayName}`,
    action: { type: 'team/setPlanned', id: team.id, day, planned: false },
  }
}

// ---------------------------------------------------------------------------
// Wording. Same rules as ui/format.ts, which the domain does not import.
// ---------------------------------------------------------------------------

/** The team's name inside a sentence. A team has no name for a moment while the planner
 *  retypes it. */
function nameOf(team: Team): string {
  return team.name.trim() || 'this team'
}

/** "1 seat", "3 seats". */
function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}
