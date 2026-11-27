import { clusterAreas } from './geometry'
import {
  dayLoad,
  dayOccupancy,
  findFloor,
  hasDayException,
  isSeatable,
  isTeamDay,
  seatingOn,
  teamDayStatus,
  type AreaOccupancy,
} from './model'
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  type Area,
  type Floor,
  type Id,
  type Project,
  type Seating,
  type Team,
  type Weekday,
} from './types'

/* Conflict recognition. `findIssues` looks at a whole project and lists everything that is
   wrong, unfinished or worth knowing, in four levels:

     error    a conflict: two things claim the same seats, or a day cannot fit (red)
     todo     unfinished: a team day that still needs seats (not wrong, just not done)
     warning  works, but against what was asked for or intended (amber)
     info     a note worth a glance (grey)

   The tool never prevents a conflicting state; it shows it. Warnings and notes can be
   accepted by the planner (see `isAccepted`); conflicts and to-dos cannot. */

export type Severity = 'error' | 'todo' | 'warning' | 'info'

export type IssueRule =
  // ---- conflicts (error)
  /** An area holds more seats than it has, on one day. One issue per area and day. */
  | 'area-over-capacity'
  /** A team holds seats in an area that is not for seating (a meeting room). Per team, area, day. */
  | 'seats-in-room'
  /** The seats all teams need on a day exceed desks plus overflow seats of the whole building. Per day. */
  | 'day-over-capacity'
  // ---- still to seat (todo)
  /** A team day without a single seat, while the team needs seats. Per team and day. */
  | 'team-unseated'
  /** A team day with some seats, but fewer than the team needs. Per team and day. */
  | 'team-short'
  // ---- warnings
  /** More seats needed than there are desks; the day only fits by using overflow seats. Per day. */
  | 'day-needs-overflow'
  /** The day fits in the desks but eats into the reserve kept free for visitors. Per day. */
  | 'day-uses-reserve'
  /** A team sits on more than one floor on a day. Per team and day. */
  | 'team-split-floors'
  /** A day the team wants is not planned. Per team and day. */
  | 'wish-unmet'
  /** A day is planned although the team said it cannot come. Per team and day. */
  | 'unwanted-day'
  /** A team uses overflow seats (touchdown, collaboration tables) on a day. Per team and day. */
  | 'overflow-used'
  // ---- notes (info)
  /** On one floor, a team's areas are not next to each other. Per team, floor and day. */
  | 'team-scattered'
  /** A team sits somewhere else on this day than on its other days (a day exception). Per team and day. */
  | 'seat-differs'
  /** A team holds more seats than it needs on a day. Per team and day. */
  | 'team-over-seated'
  /** A team with people has no planned team day at all. Per team. */
  | 'no-team-days'
  /** A team with a preferred floor holds seats on another floor on a day. Per team and day. */
  | 'off-home-floor'

export const RULE_SEVERITY: Record<IssueRule, Severity> = {
  'area-over-capacity': 'error',
  'seats-in-room': 'error',
  'day-over-capacity': 'error',
  'team-unseated': 'todo',
  'team-short': 'todo',
  'day-needs-overflow': 'warning',
  'day-uses-reserve': 'warning',
  'team-split-floors': 'warning',
  'wish-unmet': 'warning',
  'unwanted-day': 'warning',
  'overflow-used': 'warning',
  'team-scattered': 'info',
  'seat-differs': 'info',
  'team-over-seated': 'info',
  'no-team-days': 'info',
  'off-home-floor': 'info',
}

/** Most serious first. */
export const SEVERITY_ORDER: readonly Severity[] = ['error', 'todo', 'warning', 'info']

export interface Issue {
  /** Stable while the same problem persists: `rule|day|floor|area|teams`, where a part is
   *  only filled in when the problem is about that floor, area or team (otherwise `-`), and
   *  team ids are joined by `+`. An over-full area is `area-over-capacity|tue|-|ne1|-`
   *  whoever sits there; a team short of seats is `team-short|tue|-|-|claims` wherever it
   *  sits. Usable as a React key, to remember a selection, and as the key of an acceptance.
   *  It does NOT contain the numbers. */
  id: string
  rule: IssueRule
  severity: Severity
  /** Null for issues that are not tied to one day. */
  day: Weekday | null
  /** The floor to show for this issue, when there is one. */
  floorId: Id | null
  /** The area to highlight, when there is one. */
  areaId: Id | null
  /** Teams involved, in team-list order. */
  teamIds: Id[]
  /** One plain sentence without a full stop: "NE 1 is over capacity on Tuesday". */
  title: string
  /** The numbers behind it: "6 seats taken, 4 available. Claims Intake 4, Underwriting 2". */
  detail: string
}

/** All issues of the project, accepted ones included, ordered: conflicts, to-dos, warnings,
 *  notes; within a level by weekday (issues without a day last), then floor order, area
 *  order and team order. */
export function findIssues(project: Project): Issue[] {
  const teamsById = new Map(project.teams.map((team) => [team.id, team]))
  const issues: Issue[] = []
  for (const day of WEEKDAYS) {
    issues.push(...areaIssues(project, day, teamsById))
    const building = buildingIssue(project, day)
    if (building) issues.push(building)
  }
  for (const team of project.teams) {
    for (const day of WEEKDAYS) {
      if (isTeamDay(team, day)) issues.push(...teamDayIssues(project, team, day))
      else if (team.wishes[day] === 'want') issues.push(wishUnmet(team, day))
    }
    if (team.size > 0 && team.days.length === 0) issues.push(noTeamDays(team))
  }
  return inListOrder(project, issues)
}

/** True when the planner accepted this warning or note and nothing about it changed since. */
export function isAccepted(project: Project, issue: Issue): boolean {
  if (issue.severity !== 'warning' && issue.severity !== 'info') return false
  const accepted = project.accepted[issue.id]
  return accepted !== undefined && accepted.detail === issue.detail
}

export interface IssueSummary {
  /** Open conflicts. */
  conflicts: number
  /** Teams that still need seats on at least one of their days. */
  teamsToSeat: number
  /** Open (not accepted) warnings and notes. */
  warnings: number
  notes: number
  /** Accepted warnings and notes. */
  accepted: number
}

export function summarizeIssues(project: Project, issues: readonly Issue[]): IssueSummary {
  const summary: IssueSummary = { conflicts: 0, teamsToSeat: 0, warnings: 0, notes: 0, accepted: 0 }
  const toSeat = new Set<Id>()
  for (const issue of issues) {
    if (issue.severity === 'error') summary.conflicts += 1
    else if (issue.severity === 'todo') for (const id of issue.teamIds) toSeat.add(id)
    else if (isAccepted(project, issue)) summary.accepted += 1
    else if (issue.severity === 'warning') summary.warnings += 1
    else summary.notes += 1
  }
  summary.teamsToSeat = toSeat.size
  return summary
}

/** The most serious level present among the issues that concern the given day, floor, area
 *  and/or team (all given filters must match), or null when there is none. Accepted issues
 *  are skipped when `project` is passed. */
export function worstSeverity(
  issues: readonly Issue[],
  filter: { day?: Weekday; floorId?: Id; areaId?: Id; teamId?: Id },
  project?: Project,
): Severity | null {
  let worst: Severity | null = null
  for (const issue of issues) {
    if (filter.day !== undefined && issue.day !== filter.day) continue
    if (filter.floorId !== undefined && issue.floorId !== filter.floorId) continue
    if (filter.areaId !== undefined && issue.areaId !== filter.areaId) continue
    if (filter.teamId !== undefined && !issue.teamIds.includes(filter.teamId)) continue
    if (project && isAccepted(project, issue)) continue
    if (worst === null || SEVERITY_ORDER.indexOf(issue.severity) < SEVERITY_ORDER.indexOf(worst)) {
      worst = issue.severity
    }
    if (worst === 'error') break
  }
  return worst
}

/** The rules that describe a collision or a day that cannot fit. An edit that newly causes
 *  one of these deserves an immediate "this created a conflict" message; unfinished seating
 *  does not. */
export const COLLISION_RULES: readonly IssueRule[] = ['area-over-capacity', 'seats-in-room', 'day-over-capacity']

// ---------------------------------------------------------------------------
// The rules behind findIssues
// ---------------------------------------------------------------------------

/** What an issue is about. The same parts make up its id. */
interface Subject {
  day: Weekday | null
  floorId: Id | null
  areaId: Id | null
  teamIds: Id[]
}

/** Which parts of its subject identify an issue, besides the rule and the day. An id has to
 *  stay the same for as long as the same problem persists (acceptances hang on it), so it
 *  names only what the problem is ABOUT. An over-full area is the same problem whoever
 *  sits in it; a team that is short of seats is the same problem on whichever floor its
 *  first seats happen to be. The other parts of the subject only say where to look. */
const IDENTIFIED_BY: Record<IssueRule, { floor?: true; area?: true; teams?: true }> = {
  'area-over-capacity': { area: true },
  'seats-in-room': { area: true, teams: true },
  'day-over-capacity': {},
  'day-needs-overflow': {},
  'day-uses-reserve': {},
  'team-unseated': { teams: true },
  'team-short': { teams: true },
  'team-split-floors': { teams: true },
  'wish-unmet': { teams: true },
  'unwanted-day': { teams: true },
  'overflow-used': { teams: true },
  'team-scattered': { floor: true, teams: true },
  'seat-differs': { teams: true },
  'team-over-seated': { teams: true },
  'no-team-days': { teams: true },
  'off-home-floor': { teams: true },
}

function makeIssue(rule: IssueRule, subject: Subject, title: string, detail: string): Issue {
  const { day, floorId, areaId, teamIds } = subject
  const by = IDENTIFIED_BY[rule]
  const id = [
    rule,
    day ?? '-',
    (by.floor && floorId) || '-',
    (by.area && areaId) || '-',
    (by.teams && teamIds.join('+')) || '-',
  ].join('|')
  return { id, rule, severity: RULE_SEVERITY[rule], day, floorId, areaId, teamIds, title, detail }
}

/** The teams holding seats in an area on a day, in team-list order. */
function holdersOf(occupancy: AreaOccupancy, teamsById: ReadonlyMap<Id, Team>): { team: Team; seats: number }[] {
  const holders: { team: Team; seats: number }[] = []
  for (const { teamId, seats } of occupancy.teams) {
    const team = teamsById.get(teamId)
    if (team) holders.push({ team, seats })
  }
  return holders
}

/** Every area on one day: more seats held than the area has (`area-over-capacity`) and
 *  seats held in a room (`seats-in-room`). */
function areaIssues(project: Project, day: Weekday, teamsById: ReadonlyMap<Id, Team>): Issue[] {
  const issues: Issue[] = []
  const dayName = WEEKDAY_NAME[day]
  for (const occupancy of dayOccupancy(project, day).values()) {
    const { area, floorId, used } = occupancy
    if (!isSeatable(area.kind)) {
      // A room has no seats to hand out, so every team placed in it is a conflict of its own.
      for (const { team, seats } of holdersOf(occupancy, teamsById)) {
        issues.push(
          makeIssue(
            'seats-in-room',
            { day, floorId, areaId: area.id, teamIds: [team.id] },
            `${team.name} is seated in ${area.name} on ${dayName}`,
            `${area.name} is not for seating. ${plural(seats, 'seat')} placed there`,
          ),
        )
      }
    } else if (used > area.capacity) {
      const holders = holdersOf(occupancy, teamsById)
      const who = holders.map((h) => `${h.team.name} ${h.seats}`).join(', ')
      issues.push(
        makeIssue(
          'area-over-capacity',
          { day, floorId, areaId: area.id, teamIds: holders.map((h) => h.team.id) },
          `${area.name} is over capacity on ${dayName}`,
          `${plural(used, 'seat')} taken, ${area.capacity} available. ${who}`,
        ),
      )
    }
  }
  return issues
}

/** The whole building on one day: the seats all teams need against the desks, the reserve
 *  and the overflow seats (`day-over-capacity`, `day-needs-overflow`, `day-uses-reserve`).
 *  Null when the day fits. */
function buildingIssue(project: Project, day: Weekday): Issue | null {
  const load = dayLoad(project, day)
  if (load.level === 'fits') return null
  const dayName = WEEKDAY_NAME[day]
  const { desks, overflow } = load.capacity
  const needed = `${plural(load.needed, 'seat')} needed`
  // A day that is too full concerns every team that is in, seated or not.
  const subject: Subject = {
    day,
    floorId: null,
    areaId: null,
    teamIds: project.teams.filter((team) => isTeamDay(team, day)).map((team) => team.id),
  }
  switch (load.level) {
    case 'over': {
      const building = `${plural(desks, 'desk')} and ${plural(overflow, 'overflow seat')} in the building`
      return makeIssue(
        'day-over-capacity',
        subject,
        `${dayName} cannot fit`,
        `${needed}, ${building}: ${load.needed - desks - overflow} short`,
      )
    }
    case 'overflow': {
      const extra = load.needed - desks
      const who = extra === 1 ? '1 person would sit at an overflow seat' : `${extra} people would sit at overflow seats`
      return makeIssue(
        'day-needs-overflow',
        subject,
        `${dayName} only fits with overflow seats`,
        `${needed}, ${plural(desks, 'desk')}: ${who}`,
      )
    }
    case 'reserve': {
      const kept = wholePercent(project.settings.reserve)
      const plannable = `${plural(load.plannableDesks, 'desk')} plannable when ${kept} is kept free`
      return makeIssue(
        'day-uses-reserve',
        subject,
        `${dayName} eats into the reserve`,
        `${needed}, ${plannable} (${plural(desks, 'desk')} in total)`,
      )
    }
  }
}

/** The seats a team holds on one floor on one day. Rooms are left out: seats there are a
 *  mistake that `seats-in-room` reports, and they count for nothing else. */
interface FloorSeats {
  floor: Floor
  /** The seating areas where the team holds seats, in area order. */
  areas: { area: Area; seats: number }[]
  /** Seats on this floor in total. */
  seats: number
}

/** Where a team sits on a day, floor by floor in building order. Walks the floors rather
 *  than the seating record, so the result does not depend on the order of the record's keys. */
function seatsByFloor(project: Project, team: Team, day: Weekday): FloorSeats[] {
  const seating = seatingOn(team, day)
  const floors: FloorSeats[] = []
  for (const floor of project.floors) {
    const areas: FloorSeats['areas'] = []
    let total = 0
    for (const area of floor.areas) {
      const seats = seating[area.id] ?? 0
      if (seats <= 0 || !isSeatable(area.kind)) continue
      areas.push({ area, seats })
      total += seats
    }
    if (areas.length > 0) floors.push({ floor, areas, seats: total })
  }
  return floors
}

/** One team on one of its team days: is it seated (`team-unseated`, `team-short`,
 *  `team-over-seated`), where does it sit (`team-split-floors`, `team-scattered`,
 *  `overflow-used`, `off-home-floor`), and is the day as agreed (`seat-differs`,
 *  `unwanted-day`). */
function teamDayIssues(project: Project, team: Team, day: Weekday): Issue[] {
  const issues: Issue[] = []
  const dayName = WEEKDAY_NAME[day]
  const status = teamDayStatus(project, team, day)
  const floors = seatsByFloor(project, team, day)
  const home = findFloor(project, team.homeFloorId)
  // The floor to look at for this team on this day: where it sits, or else where it should.
  // Rules about one particular place say `where` themselves.
  const floorId = floors[0]?.floor.id ?? home?.id ?? null
  const add = (
    rule: IssueRule,
    title: string,
    detail: string,
    where: Pick<Subject, 'floorId' | 'areaId'> = { floorId, areaId: null },
  ) => {
    issues.push(makeIssue(rule, { day, ...where, teamIds: [team.id] }, title, detail))
  }

  if (status.state === 'unseated') {
    add('team-unseated', `${team.name} has no seats on ${dayName}`, `Needs ${plural(status.needed, 'seat')}`)
  } else if (status.state === 'short') {
    add(
      'team-short',
      `${team.name} is ${plural(status.needed - status.seated, 'seat')} short on ${dayName}`,
      `${status.seated} of ${plural(status.needed, 'seat')} placed`,
    )
  } else if (status.state === 'over') {
    add(
      'team-over-seated',
      `${team.name} holds ${plural(status.seated - status.needed, 'more seat')} than it needs on ${dayName}`,
      `${plural(status.seated, 'seat')} for ${status.needed} needed`,
    )
  }

  if (floors.length > 1) {
    add(
      'team-split-floors',
      `${team.name} is split over ${floors.length} floors on ${dayName}`,
      floors.map((f) => `${f.floor.name}: ${plural(f.seats, 'seat')}`).join('. '),
    )
  }

  for (const { floor, areas } of floors) {
    const groups = clusterAreas(floor, areas.map((a) => a.area.id))
    if (groups.length < 2) continue
    const groupNames = groups.map((group) =>
      areas
        .filter((a) => group.includes(a.area.id))
        .map((a) => a.area.name)
        .join(', '),
    )
    add(
      'team-scattered',
      `${team.name} sits in ${groups.length} separate places on ${floor.name} on ${dayName}`,
      groupNames.join(' / '),
      { floorId: floor.id, areaId: null },
    )
  }

  const overflowAreas = floors.flatMap((f) =>
    f.areas.filter((a) => a.area.kind === 'overflow').map((a) => ({ ...a, floorId: f.floor.id })),
  )
  const firstOverflow = overflowAreas[0]
  if (firstOverflow) {
    add(
      'overflow-used',
      `${team.name} uses ${plural(status.inOverflow, 'overflow seat')} on ${dayName}`,
      overflowAreas.map((a) => `${a.area.name} ${a.seats}`).join(', '),
      { floorId: firstOverflow.floorId, areaId: firstOverflow.area.id },
    )
  }

  // A day on which the team holds no seat at all is already listed as "still to seat";
  // saying that it also "sits somewhere else" would only be noise.
  if (hasDayException(team, day) && status.seated + status.inNoSeating > 0) {
    // What the team has on the days without a seating of their own. (The reducer sees to
    // it that there is such a day; the normal seating itself is the fallback.)
    const usual = team.seating
    const own = seatingOn(team, day)
    const sameAreas = sameKeys(own, usual)
    // The seat numbers are part of the detail on purpose: an accepted note opens again when
    // they change.
    const here = describeSeats(project, own) || 'not seated'
    const elsewhere = describeSeats(project, usual) || 'not seated'
    add(
      'seat-differs',
      sameAreas
        ? `${team.name} has a different number of seats on ${dayName}`
        : `${team.name} sits somewhere else on ${dayName}`,
      `${dayName}: ${here}. Other days: ${elsewhere}`,
    )
  }

  if (team.wishes[day] === 'cannot') {
    add(
      'unwanted-day',
      `${team.name} is planned on ${dayName} but cannot come`,
      `The team said it cannot come on ${dayName}`,
    )
  }

  if (home) {
    const away = floors.find((f) => f.floor.id !== home.id)
    if (away) {
      add(
        'off-home-floor',
        `${team.name} is not on its preferred floor on ${dayName}`,
        // With the numbers, so that an accepted note opens again when the team shifts further
        // away from its floor.
        `Preferred: ${home.name}. Seated on: ${joinAnd(floors.map((f) => `${f.floor.name} (${plural(f.seats, 'seat')})`))}`,
        { floorId: away.floor.id, areaId: null },
      )
    }
  }

  return issues
}

/** True when two seatings use exactly the same areas (whatever the seat numbers). */
function sameKeys(a: Seating, b: Seating): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => key in b)
}

/** A seating in words, with its numbers: "Floor 4: 4 in NE 1, 2 in NE 2". Empty when it
 *  holds no seat in an area of the project. */
function describeSeats(project: Project, seating: Seating): string {
  const parts: string[] = []
  for (const floor of project.floors) {
    const held = floor.areas.filter((area) => (seating[area.id] ?? 0) > 0)
    if (held.length > 0) parts.push(`${floor.name}: ${held.map((area) => `${seating[area.id]} in ${area.name}`).join(', ')}`)
  }
  return parts.join('; ')
}

/** A day the team asked for that is not planned (`wish-unmet`). It is about the week, not
 *  about a place, so it names no floor. */
function wishUnmet(team: Team, day: Weekday): Issue {
  return makeIssue(
    'wish-unmet',
    { day, floorId: null, areaId: null, teamIds: [team.id] },
    `${team.name} wants ${WEEKDAY_NAME[day]} but is not planned then`,
    team.days.length > 0 ? `Planned: ${dayNames(team.days)}` : 'No day planned',
  )
}

/** A team with people that never comes in (`no-team-days`). No day and no floor. */
function noTeamDays(team: Team): Issue {
  const wanted = WEEKDAYS.filter((day) => team.wishes[day] === 'want')
  return makeIssue(
    'no-team-days',
    { day: null, floorId: null, areaId: null, teamIds: [team.id] },
    `${team.name} has no team day yet`,
    wanted.length > 0 ? `Wanted: ${dayNames(wanted)}` : 'No day asked for',
  )
}

/** Puts issues in the order of the list: most serious first, then through the week, down
 *  the floors in project order, across each floor in area order and down the team list
 *  (by the first team involved). An issue without a day, floor, area or team comes after
 *  those that have one. The rule name settles what is left, so the order never depends on
 *  how the issues were collected. */
function inListOrder(project: Project, issues: readonly Issue[]): Issue[] {
  const LAST = Number.MAX_SAFE_INTEGER
  const floorAt = new Map<Id, number>()
  const areaAt = new Map<Id, number>()
  project.floors.forEach((floor, index) => {
    floorAt.set(floor.id, index)
    // The position on its own floor is enough: floors are compared first.
    floor.areas.forEach((area, position) => areaAt.set(area.id, position))
  })
  const teamAt = new Map(project.teams.map((team, index) => [team.id, index]))
  const positionIn = (order: ReadonlyMap<Id, number>, id: Id | null | undefined) =>
    id === null || id === undefined ? LAST : (order.get(id) ?? LAST)

  return issues
    .map((issue) => ({
      issue,
      level: SEVERITY_ORDER.indexOf(issue.severity),
      day: issue.day === null ? LAST : WEEKDAYS.indexOf(issue.day),
      floor: positionIn(floorAt, issue.floorId),
      area: positionIn(areaAt, issue.areaId),
      team: positionIn(teamAt, issue.teamIds[0]),
    }))
    .sort(
      (a, b) =>
        a.level - b.level ||
        a.day - b.day ||
        a.floor - b.floor ||
        a.area - b.area ||
        a.team - b.team ||
        compareText(a.issue.rule, b.issue.rule),
    )
    .map((ranked) => ranked.issue)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------------------
// Wording. Same rules as ui/format.ts, which the domain does not import.
// ---------------------------------------------------------------------------

/** "1 seat", "3 seats". */
function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Tuesday and Thursday". */
function dayNames(days: readonly Weekday[]): string {
  return joinAnd(days.map((day) => WEEKDAY_NAME[day]))
}

/** 0.1 becomes "10%": the reserve is set in whole percents. */
function wholePercent(share: number): string {
  return `${Math.round(share * 100)}%`
}
