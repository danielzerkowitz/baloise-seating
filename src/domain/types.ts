/** Core data model of the planner. Everything the app saves is one `Project`.
 *
 *  Invariants. `normalizeProject` establishes them for anything loaded from storage or a
 *  file, and every reducer action keeps them:
 *  - ids are unique; area ids are unique across ALL floors
 *  - a seating never refers to an area that does not exist and never holds a count below 1
 *  - `team.days` has no duplicates and is in week order
 *  - `team.daySeating` only has entries for days that are in `team.days`
 *  - counts (team size, seats, capacity) are whole numbers of zero or more
 *  - rectangles lie inside the plan (all values 0..1, w and h above zero)
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_NAME: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
}

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
}

export type Id = string

/** What an area on a floor plan is for.
 *  - `desks`: regular workplaces. This is where teams are seated and it is the only kind
 *    that counts as capacity.
 *  - `overflow`: touchdown benches and open collaboration tables. Seats here are a fallback
 *    for busy days; they never count as regular capacity.
 *  - `no-seating`: meeting rooms, lounges, quiet rooms. Shown for orientation; teams are
 *    never seated here. `capacity` is informative (chairs in the room). */
export type AreaKind = 'desks' | 'overflow' | 'no-seating'

export const AREA_KIND_NAME: Record<AreaKind, string> = {
  desks: 'Desks',
  overflow: 'Overflow seats',
  'no-seating': 'No seating',
}

/** A rectangle on a floor plan, in fractions of the plan's width and height (0..1), so it
 *  is independent of image resolution and zoom. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A group of seats on a floor: a desk cluster, a bench, a collaboration table, a room. */
export interface Area {
  id: Id
  name: string
  kind: AreaKind
  /** Number of seats. */
  capacity: number
  rect: Rect
}

export interface PlanImage {
  /** A data URL (uploaded or bundled), so a project file is self-contained. */
  src: string
  /** Natural size in pixels; only the ratio matters. */
  width: number
  height: number
}

export interface Floor {
  id: Id
  /** "Floor 4" */
  name: string
  /** The floor's sign: one to three characters shown large, "4", "G", "-1". */
  label: string
  /** Null for a floor without a drawing: areas are then placed on a blank sheet. */
  plan: PlanImage | null
  areas: Area[]
}

/** What a team said about a weekday.
 *  - `want`: the team wants this as a team day
 *  - `can`: not a wish, but the team said it could come if a wanted day is full
 *  - `none`: nothing was said about this day (the default). Silence is not consent: a
 *    suggestion to move a team here is marked "ask first"
 *  - `cannot`: the team said it cannot come on this day */
export type DayWish = 'want' | 'can' | 'none' | 'cannot'

export const DAY_WISH_NAME: Record<DayWish, string> = {
  want: 'Wants this day',
  can: 'Could also come',
  none: 'Not asked',
  cannot: 'Cannot come',
}

/** Seats a team holds, per area: area id -> number of seats (always 1 or more). */
export type Seating = Record<Id, number>

export interface Team {
  id: Id
  name: string
  /** Short label painted on the plan, up to four characters. */
  code: string
  /** People in the team. */
  size: number
  /** '#rrggbb' */
  color: string
  /** Department, tribe or release train the team belongs to; '' for none. */
  group: string
  /** What the team asked for. */
  wishes: Record<Weekday, DayWish>
  /** The planned team days. Follows the wishes until the planner decides otherwise. */
  days: Weekday[]
  /** Share of the team expected in on a team day (above 0, up to 1). Null uses the
   *  project setting. */
  attendance: number | null
  /** The floor the team should preferably sit on, if any. */
  homeFloorId: Id | null
  /** Where the team sits on its team days. */
  seating: Seating
  /** Exceptions: a different seating on one particular day. A day without an entry uses
   *  `seating`. */
  daySeating: Partial<Record<Weekday, Seating>>
  notes: string
}

export interface Settings {
  /** Share of a team expected in the office on its team day, 0.1 to 1. With 1 every team
   *  member gets a seat. */
  attendance: number
  /** Share of the desks to keep free on every day for visitors and people who come in
   *  outside their team day, 0 to 0.5. A day that eats into this reserve gets a warning. */
  reserve: number
}

/** A warning or note the planner has looked at and accepted as it is. */
export interface AcceptedIssue {
  /** Why it is fine, in the planner's words; may be empty. */
  note: string
  /** The issue's detail text at the time. When the numbers behind the issue change, the
   *  detail changes and the acceptance no longer counts. */
  detail: string
}

export interface Project {
  schemaVersion: 1
  name: string
  /** In building order, lowest floor first. */
  floors: Floor[]
  teams: Team[]
  settings: Settings
  /** Accepted warnings and notes, by issue id. Conflicts cannot be accepted. */
  accepted: Record<string, AcceptedIssue>
}

export const SCHEMA_VERSION = 1 as const

export const DEFAULT_SETTINGS: Settings = { attendance: 1, reserve: 0 }

/** The seating scope of an edit: the team's seating on every team day, or an exception for
 *  one day. */
export type SeatingScope = 'all' | Weekday
