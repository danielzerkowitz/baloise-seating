import { nextTeamColor, normalizeHex } from './color'
import {
  clampRect,
  floorLabelFromName,
  newId,
  sameSeating,
  seatingOn,
  seatsNeeded,
  sortDays,
  teamCode,
  teamOrg,
} from './model'
import { cleanText, LIMITS } from './limits'
import { MAX_RESERVE, MIN_ATTENDANCE, settleSeating } from './reducer'
import {
  AREA_KIND_NAME,
  DAY_WISH_NAME,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  WEEKDAY_NAME,
  WEEKDAYS,
  type AcceptedIssue,
  type Area,
  type Art,
  type DayWish,
  type Domain,
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

/* Reading and writing projects and team lists. Anything that comes from outside the app (a
   file, the browser's storage, pasted text) is untrusted and goes through `normalizeProject`
   or `parseTeamsText` before it becomes state. */

/** Thrown by `normalizeProject` with a message that can be shown to the planner as is. */
export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFormatError'
  }
}

const NOT_A_PLANNER_FILE = 'This is not a planner file.'
const NEWER_VERSION = 'This file was made with a newer version of the planner. Update the planner to open it.'
const TOO_LARGE = 'This file is too large to be a seating plan.'

// Beyond these sizes the data cannot be a seating plan: it is refused, not repaired.
const MAX_FLOORS = 200
const MAX_AREAS_PER_FLOOR = 2000
const MAX_TEAMS = 5000
const MAX_DOMAINS = 500
const MAX_ARTS = 2000

// The bounds that values are brought back to.
const MAX_NAME_LENGTH = LIMITS.name
const MAX_LABEL_LENGTH = LIMITS.label
const MAX_CODE_LENGTH = LIMITS.code
const MAX_ORG_NAME_LENGTH = LIMITS.orgName
const MAX_NOTES_LENGTH = LIMITS.notes
/** The seats of one area, and the seats one team can hold in one area. */
const MAX_SEATS = LIMITS.seats
const MAX_TEAM_SIZE = LIMITS.teamSize
const MAX_ACCEPTED = 2000

const DEFAULT_PROJECT_NAME = 'Office plan'

// ---------------------------------------------------------------------------
// Reading values that cannot be trusted
// ---------------------------------------------------------------------------

/** An object from outside the app: nothing is known about its fields. */
type Untrusted = Readonly<Record<string, unknown>>

const NO_FIELDS: Untrusted = Object.freeze({})

function isRecord(value: unknown): value is Untrusted {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One field of an untrusted object. Only what the object itself carries counts, never what
 *  it inherits, so nothing can arrive by way of a prototype. */
function field(source: Untrusted, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined
}

/** True when `value` is a key of a table such as WEEKDAY_NAME, which by its type lists every
 *  allowed value. */
function isKeyOf<K extends string>(table: Readonly<Record<K, unknown>>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(table, value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A whole number from 0 to `max`; 0 for anything that is not a finite number. */
function wholeNumber(value: unknown, max: number): number {
  return clamp(Math.round(finiteNumber(value) ?? 0), 0, max)
}

/** `text` shortened to `max` characters. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  // Do not keep the first half of a pair of code units (an emoji, say): it would show as a
  // broken character.
  const last = text.charCodeAt(max - 1)
  const next = text.charCodeAt(max)
  const splitsPair = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  return text.slice(0, splitsPair ? max - 1 : max)
}

/** Free text of at most `max` characters; '' when the value is not a string. */
function freeText(value: unknown, max: number): string {
  return typeof value === 'string' ? cut(cleanText(value), max) : ''
}

/** A name: trimmed and of at most 120 characters. `fallback` when the value is not a string
 *  or nothing of it is left. */
function readName(value: unknown, fallback: string): string {
  // Cutting can leave a space at the end. It is trimmed off as well, so that reading the
  // result a second time changes nothing.
  // Without characters that cannot be stored (a NUL makes the database refuse the plan).
  const name = typeof value === 'string' ? cut(cleanText(value).trim(), MAX_NAME_LENGTH).trimEnd() : ''
  return name === '' ? fallback : name
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Names that every object already answers to (`constructor`, `toString`, `__proto__`, ...).
 *  Ids and issue ids become keys of plain objects, where such a name would be mistaken for
 *  what the object inherits, or with `__proto__` even replace it. They are never accepted. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  ...Object.getOwnPropertyNames(Object.prototype),
])

/** The id of a floor, area or team: its own when that is well formed and not taken yet,
 *  otherwise a new one. `taken` collects the ids handed out.
 *
 *  Of two things with the same id the first keeps it. What referred to a replaced id is not
 *  pointed at the new one (of two with the same id, it cannot be known which was meant): the
 *  caller drops every reference that no longer leads anywhere. */
function claimId(value: unknown, taken: Set<Id>, prefix: string): Id {
  const wellFormed = typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_KEYS.has(value)
  let id = wellFormed ? value : newId(prefix)
  // A loop, because a new id could be taken as well, however unlikely that is.
  while (taken.has(id)) id = newId(prefix)
  taken.add(id)
  return id
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** The ids in use so far, per kind of thing. Area ids are shared by all floors. */
interface KnownIds {
  floors: Set<Id>
  areas: Set<Id>
  teams: Set<Id>
  domains: Set<Id>
  arts: Set<Id>
}

/** Domains and ARTs as read so far. Teams of a version 1 plan add a domain for their group. */
interface Org {
  domains: Domain[]
  arts: Art[]
}

/** Turns unknown data into a valid project that satisfies every invariant in types.ts.
 *
 *  Takes a bare project (as kept in the browser's storage) or the envelope of a project
 *  file. Throws `ProjectFormatError` when the data is not a project at all, was written by a
 *  newer version of the app or is absurdly large. Everything else is repaired: the result is
 *  built from scratch out of the known fields only, numbers are brought within their bounds,
 *  days are sorted, defaults are filled in, bad and duplicate ids are replaced, and whatever
 *  refers to something that does not exist is dropped. The input is not modified, and
 *  normalizing the result again changes nothing. */
export function normalizeProject(input: unknown): Project {
  if (!isRecord(input)) throw new ProjectFormatError(NOT_A_PLANNER_FILE)
  const raw = projectIn(input)
  // Before looking at the shape: a newer version may well keep its floors and teams differently.
  if (isNewerVersion(input) || isNewerVersion(raw)) throw new ProjectFormatError(NEWER_VERSION)
  const rawFloors = field(raw, 'floors')
  const rawTeams = field(raw, 'teams')
  if (!Array.isArray(rawFloors) || !Array.isArray(rawTeams)) throw new ProjectFormatError(NOT_A_PLANNER_FILE)
  if (rawFloors.length > MAX_FLOORS || rawTeams.length > MAX_TEAMS) throw new ProjectFormatError(TOO_LARGE)
  const rawDomains = listField(raw, 'domains')
  const rawArts = listField(raw, 'arts')
  if (rawDomains.length > MAX_DOMAINS || rawArts.length > MAX_ARTS) throw new ProjectFormatError(TOO_LARGE)

  const ids: KnownIds = { floors: new Set(), areas: new Set(), teams: new Set(), domains: new Set(), arts: new Set() }
  const floors: Floor[] = []
  for (const entry of rawFloors) {
    if (isRecord(entry)) floors.push(readFloor(entry, floors.length + 1, ids))
  }
  const org: Org = { domains: [], arts: [] }
  for (const entry of rawDomains) {
    if (isRecord(entry)) org.domains.push(readDomain(entry, org.domains.length + 1, ids))
  }
  // ARTs after the domains, teams after everything: what they refer to must be known by now.
  for (const entry of rawArts) {
    if (isRecord(entry)) org.arts.push(readArt(entry, org.arts.length + 1, ids))
  }
  const teams: Team[] = []
  for (const entry of rawTeams) {
    if (isRecord(entry)) teams.push(readTeam(entry, teams, ids, org))
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    name: readName(field(raw, 'name'), DEFAULT_PROJECT_NAME),
    floors,
    domains: org.domains,
    arts: org.arts,
    teams,
    settings: readSettings(field(raw, 'settings')),
    accepted: readAccepted(field(raw, 'accepted')),
  }
}

/** The project in what was read: the object itself when it has floors and teams, whatever
 *  else it carries; otherwise the `project` inside the envelope of a file. */
function projectIn(input: Untrusted): Untrusted {
  const isProject = Array.isArray(field(input, 'floors')) && Array.isArray(field(input, 'teams'))
  const wrapped = field(input, 'project')
  return !isProject && isRecord(wrapped) ? wrapped : input
}

/** A list field; empty when it is missing or not a list (a version 1 plan has no domains). */
function listField(source: Untrusted, key: string): unknown[] {
  const value = field(source, key)
  return Array.isArray(value) ? value : []
}

/** The name of a domain or ART, read like any other name but within their own bound. */
function readOrgName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? cut(cleanText(value).trim(), MAX_ORG_NAME_LENGTH).trimEnd() : ''
  return name === '' ? fallback : name
}

function readDomain(raw: Untrusted, position: number, ids: KnownIds): Domain {
  return {
    id: claimId(field(raw, 'id'), ids.domains, 'domain'),
    name: readOrgName(field(raw, 'name'), `Domain ${position}`),
  }
}

function readArt(raw: Untrusted, position: number, ids: KnownIds): Art {
  const domainId = field(raw, 'domainId')
  return {
    id: claimId(field(raw, 'id'), ids.arts, 'art'),
    name: readOrgName(field(raw, 'name'), `ART ${position}`),
    domainId: typeof domainId === 'string' && ids.domains.has(domainId) ? domainId : null,
  }
}

/** A team's domain and ART. An ART that exists decides the domain. A plan from before
 *  domains had a free-text group: it becomes a domain of that name, shared by all teams
 *  with the same group (ignoring case). */
function readTeamOrg(raw: Untrusted, ids: KnownIds, org: Org): { domainId: Id | null; artId: Id | null } {
  const artId = field(raw, 'artId')
  const art = typeof artId === 'string' && ids.arts.has(artId) ? org.arts.find((a) => a.id === artId) : undefined
  if (art) return { domainId: art.domainId, artId: art.id }
  const domainId = field(raw, 'domainId')
  if (typeof domainId === 'string' && ids.domains.has(domainId)) return { domainId, artId: null }
  const group = field(raw, 'group')
  if (domainId !== undefined || artId !== undefined || typeof group !== 'string') return { domainId: null, artId: null }
  const name = readOrgName(group, '')
  if (name === '') return { domainId: null, artId: null }
  const key = name.toLowerCase()
  let domain = org.domains.find((d) => d.name.toLowerCase() === key)
  if (!domain) {
    if (org.domains.length >= MAX_DOMAINS) return { domainId: null, artId: null }
    domain = { id: claimId(undefined, ids.domains, 'domain'), name }
    org.domains.push(domain)
  }
  return { domainId: domain.id, artId: null }
}

function isNewerVersion(source: Untrusted): boolean {
  const version = field(source, 'schemaVersion')
  return typeof version === 'number' && version > SCHEMA_VERSION
}

/** `position` is the floor's place in the list, counted from 1; a floor without a name is
 *  called after it. */
function readFloor(raw: Untrusted, position: number, ids: KnownIds): Floor {
  const rawAreas = field(raw, 'areas')
  const areaEntries: unknown[] = Array.isArray(rawAreas) ? rawAreas : []
  if (areaEntries.length > MAX_AREAS_PER_FLOOR) throw new ProjectFormatError(TOO_LARGE)
  const areas: Area[] = []
  for (const entry of areaEntries) {
    if (isRecord(entry)) areas.push(readArea(entry, areas.length + 1, ids))
  }
  const name = readName(field(raw, 'name'), `Floor ${position}`)
  const label = field(raw, 'label')
  return {
    id: claimId(field(raw, 'id'), ids.floors, 'floor'),
    name,
    // As in makeFloor: only a missing label is made from the name. One that the planner
    // emptied stays empty, so that a saved plan comes back as it was.
    label: cut(typeof label === 'string' ? label : floorLabelFromName(name), MAX_LABEL_LENGTH),
    plan: readPlan(field(raw, 'plan')),
    areas,
  }
}

function readPlan(raw: unknown): PlanImage | null {
  if (!isRecord(raw)) return null
  const src = field(raw, 'src')
  const width = finiteNumber(field(raw, 'width'))
  const height = finiteNumber(field(raw, 'height'))
  // Only a picture that is inside the file itself. Any other address (http, file, blob)
  // would make the app fetch something when the plan is shown, and it must never do that.
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return null
  if (width === null || height === null || width <= 0 || height <= 0) return null
  return { src, width, height }
}

/** `position` is the area's place on its floor, counted from 1. */
function readArea(raw: Untrusted, position: number, ids: KnownIds): Area {
  const kind = field(raw, 'kind')
  return {
    id: claimId(field(raw, 'id'), ids.areas, 'area'),
    name: readName(field(raw, 'name'), `Area ${position}`),
    kind: isKeyOf(AREA_KIND_NAME, kind) ? kind : 'desks',
    capacity: wholeNumber(field(raw, 'capacity'), MAX_SEATS),
    rect: readRect(field(raw, 'rect')),
  }
}

function readRect(raw: unknown): Rect {
  const source = isRecord(raw) ? raw : NO_FIELDS
  // clampRect puts its own default in the place of anything that is not a finite number.
  const side = (key: string) => finiteNumber(field(source, key)) ?? Number.NaN
  return clampRect({ x: side('x'), y: side('y'), w: side('w'), h: side('h') })
}

/** `earlier` are the teams before this one in the list, already read: a team without a code
 *  or colour gets one that they do not use. */
function readTeam(raw: Untrusted, earlier: readonly Team[], ids: KnownIds, org: Org): Team {
  const name = readName(field(raw, 'name'), `Team ${earlier.length + 1}`)
  const code = field(raw, 'code')
  const color = field(raw, 'color')
  const attendance = finiteNumber(field(raw, 'attendance'))
  const homeFloorId = field(raw, 'homeFloorId')
  const days = readDays(field(raw, 'days'))
  const seating = readSeating(field(raw, 'seating'), ids.areas)
  // The same rule as after every edit: the normal seating is never hidden behind a seating
  // of its own on every team day (plans saved by an earlier version can have that).
  return settleSeating({
    id: claimId(field(raw, 'id'), ids.teams, 'team'),
    name,
    // As in makeTeam: only a missing code is made up; an emptied one stays empty.
    code: cut(typeof code === 'string' ? code : teamCode(name, earlier.map((team) => team.code)), MAX_CODE_LENGTH),
    size: wholeNumber(field(raw, 'size'), MAX_TEAM_SIZE),
    color:
      (typeof color === 'string' ? normalizeHex(color) : null) ?? nextTeamColor(earlier.map((team) => team.color)),
    ...readTeamOrg(raw, ids, org),
    wishes: readWishes(field(raw, 'wishes')),
    days,
    attendance: attendance === null ? null : clamp(attendance, MIN_ATTENDANCE, 1),
    homeFloorId: typeof homeFloorId === 'string' && ids.floors.has(homeFloorId) ? homeFloorId : null,
    seating,
    daySeating: readDaySeating(field(raw, 'daySeating'), days, seating, ids.areas),
    notes: freeText(field(raw, 'notes'), MAX_NOTES_LENGTH),
  })
}

function readWishes(raw: unknown): Record<Weekday, DayWish> {
  const source = isRecord(raw) ? raw : NO_FIELDS
  const wishes = {} as Record<Weekday, DayWish>
  for (const day of WEEKDAYS) {
    const wish = field(source, day)
    wishes[day] = isKeyOf(DAY_WISH_NAME, wish) ? wish : 'none'
  }
  return wishes
}

/** Real weekdays only, each once, in week order. */
function readDays(raw: unknown): Weekday[] {
  if (!Array.isArray(raw)) return []
  return sortDays(raw.filter((day: unknown): day is Weekday => isKeyOf(WEEKDAY_NAME, day)))
}

/** Seats per area: only in areas that exist, as whole numbers of 1 or more. A count that
 *  rounds to less than one seat is no seat. */
function readSeating(raw: unknown, areaIds: ReadonlySet<Id>): Seating {
  const seating: Seating = {}
  if (!isRecord(raw)) return seating
  for (const areaId of Object.keys(raw)) {
    if (!areaIds.has(areaId)) continue
    const seats = wholeNumber(raw[areaId], MAX_SEATS)
    if (seats >= 1) seating[areaId] = seats
  }
  return seating
}

function readDaySeating(
  raw: unknown,
  days: readonly Weekday[],
  seating: Seating,
  areaIds: ReadonlySet<Id>,
): Partial<Record<Weekday, Seating>> {
  const daySeating: Partial<Record<Weekday, Seating>> = {}
  if (!isRecord(raw)) return daySeating
  // Only team days can have an exception.
  for (const day of days) {
    const exception = field(raw, day)
    if (!isRecord(exception)) continue
    const cleaned = readSeating(exception, areaIds)
    // The same seats as on the other days is not an exception. An EMPTY one that differs is:
    // it says that the team has no seats on this day.
    if (!sameSeating(cleaned, seating)) daySeating[day] = cleaned
  }
  return daySeating
}

function readSettings(raw: unknown): Settings {
  const source = isRecord(raw) ? raw : NO_FIELDS
  const attendance = finiteNumber(field(source, 'attendance'))
  const reserve = finiteNumber(field(source, 'reserve'))
  return {
    attendance: attendance === null ? DEFAULT_SETTINGS.attendance : clamp(attendance, MIN_ATTENDANCE, 1),
    reserve: reserve === null ? DEFAULT_SETTINGS.reserve : clamp(reserve, 0, MAX_RESERVE),
  }
}

function readAccepted(raw: unknown): Record<string, AcceptedIssue> {
  const accepted: Record<string, AcceptedIssue> = {}
  if (!isRecord(raw)) return accepted
  let kept = 0
  for (const issueId of Object.keys(raw)) {
    if (kept === MAX_ACCEPTED) break
    if (RESERVED_KEYS.has(issueId)) continue
    const entry = raw[issueId]
    if (!isRecord(entry)) continue
    const note = field(entry, 'note')
    const detail = field(entry, 'detail')
    if (typeof note !== 'string' || typeof detail !== 'string') continue
    // The detail is compared with the issue's text as it is, so it must come back whole:
    // its bound lies far above anything the planner generates.
    accepted[issueId] = { note: cut(cleanText(note), LIMITS.acceptNote), detail: cut(cleanText(detail), LIMITS.acceptDetail) }
    kept += 1
  }
  return accepted
}

/** The text of a project file: a JSON envelope
 *  `{ "app": "team-day-planner", "schemaVersion": 1, "savedAt": "<ISO date>", "project": {...} }`,
 *  indented so that a person can read it and two versions can be compared line by line. */
export function serializeProject(project: Project, savedAt: Date = new Date()): string {
  const envelope = { app: 'team-day-planner', schemaVersion: SCHEMA_VERSION, savedAt: savedAt.toISOString(), project }
  return JSON.stringify(envelope, null, 2)
}

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string }

/** Reads the text of a project file (the envelope above, or a bare project object). Never
 *  throws: problems come back as a message for the planner. */
export function parseProjectFile(text: string): ParseResult {
  try {
    // Trimming also removes a byte order mark, which JSON does not allow.
    const json = text.trim()
    if (json === '') return { ok: false, error: 'This file is empty.' }
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      return { ok: false, error: 'This file is not a planner file: it is not valid JSON.' }
    }
    return { ok: true, project: normalizeProject(data) }
  } catch (error) {
    return { ok: false, error: error instanceof ProjectFormatError ? error.message : 'This file could not be read.' }
  }
}

// ---------------------------------------------------------------------------
// Export for spreadsheets
// ---------------------------------------------------------------------------

/** Tells Excel that the text is UTF-8; without it accented letters come out garbled. */
const BYTE_ORDER_MARK = '\uFEFF'

/** Regions whose spreadsheets separate CSV columns with semicolons although they write
 *  decimals with a point. */
const SEMICOLON_REGIONS: readonly string[] = ['CH', 'LI']

/** The separator a spreadsheet on this computer expects in a CSV file. Excel follows the
 *  regional settings: where the decimal sign is a comma (Belgium, Luxembourg, Germany,
 *  France, the Netherlands), and in Switzerland, it reads columns separated by semicolons
 *  and would put a comma-separated file into one column. Without `locale` the browser's own
 *  setting is used. */
export function csvSeparatorFor(locale?: string): ',' | ';' {
  try {
    const format = new Intl.NumberFormat(locale)
    const decimal = format.formatToParts(1.5).find((part) => part.type === 'decimal')
    if (decimal?.value === ',') return ';'
    const region = new Intl.Locale(format.resolvedOptions().locale).maximize().region
    return region !== undefined && SEMICOLON_REGIONS.includes(region) ? ';' : ','
  } catch {
    return ','
  }
}

/** The seating plan as CSV text for a spreadsheet: separated by commas (or by semicolons,
 *  see `csvSeparatorFor`), quoted where needed, lines ending in CRLF, with a header row:
 *  Day, Team, Code, Domain, ART, People, Seats needed, Floor, Area, Seats. Ordered by weekday,
 *  then team, floor and area. One row per team, day and area; a team day without seats
 *  still gets one row with empty Floor/Area and 0 seats. */
export function seatingCsv(project: Project, separator: ',' | ';' = ','): string {
  const csvLine = (cells: readonly (string | number)[]) =>
    cells.map((cell) => (typeof cell === 'number' ? String(cell) : csvText(cell, separator))).join(separator)
  const lines = [csvLine(['Day', 'Team', 'Code', 'Domain', 'ART', 'People', 'Seats needed', 'Floor', 'Area', 'Seats'])]
  for (const day of WEEKDAYS) {
    for (const team of project.teams) {
      if (!team.days.includes(day)) continue
      const { domain, art } = teamOrg(project, team)
      const aboutTeam = [
        WEEKDAY_NAME[day],
        team.name,
        team.code,
        domain?.name ?? '',
        art?.name ?? '',
        team.size,
        seatsNeeded(team, project.settings),
      ]
      const seating = seatingOn(team, day)
      let seated = false
      for (const floor of project.floors) {
        for (const area of floor.areas) {
          const seats = seating[area.id] ?? 0
          if (seats <= 0) continue
          lines.push(csvLine([...aboutTeam, floor.name, area.name, seats]))
          seated = true
        }
      }
      if (!seated) lines.push(csvLine([...aboutTeam, '', '', 0]))
    }
  }
  return BYTE_ORDER_MARK + lines.map((line) => `${line}\r\n`).join('')
}

function csvText(text: string, separator: ',' | ';'): string {
  // A spreadsheet runs a cell that starts with one of these characters as a formula, and
  // names can come from someone else's file. With an apostrophe in front it stays text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** A file name for an export: "office-plan-2026-11-27.json". */
export function exportFileName(project: Project, extension: string, date: Date = new Date()): string {
  const slug =
    project.name
      .toLowerCase()
      // Split letters from their accents and drop the accents: "Büro" becomes "buro".
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'office-plan'
  // The local date: shortly after midnight the UTC date would still be yesterday's.
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${slug}-${day}.${extension}`
}

// ---------------------------------------------------------------------------
// Teams pasted as text
// ---------------------------------------------------------------------------

export interface ParsedTeamRow {
  name: string
  size: number
  days: Weekday[]
  /** The first other text on the line: a domain, or the name of an ART that exists. */
  domain: string
  /** The second other text: an ART. */
  art: string
  /** 1-based line number in the pasted text. */
  line: number
}

export interface ParsedTeams {
  rows: ParsedTeamRow[]
  /** Lines that could not be used, each as a sentence: "Line 4: no team size found". */
  problems: string[]
}

const MAX_PASTED_TEAMS = 500

/** Reads teams pasted from a spreadsheet or typed by hand: one team per line with name,
 *  size, optional days, an optional domain and an optional ART, separated by tabs, semicolons
 *  or commas.
 *
 *  The first field is the name and the first later field that starts with a number is the
 *  size ("8", "7,5 FTE", "12 people"; rounded). Of the other fields, those that consist of
 *  weekdays only are the days, the first that does not is the domain and the second the ART. Days may be written
 *  in English, Dutch, German or French, full or abbreviated, e.g. "Tue Thu", "di/do",
 *  "Dienstag, Donnerstag". A hyphen does not separate days: "Tue-Thu" could mean two days or
 *  three, so it is not read as days.
 *
 *  Blank lines and a header line are skipped. A line without a name or without a size of 0
 *  to 5000, a name that was read before and everything after 500 teams are left out and
 *  reported in `problems`. */
export function parseTeamsText(text: string): ParsedTeams {
  const rows: ParsedTeamRow[] = []
  const problems: string[] = []
  const namesRead = new Set<string>()
  let headerMayFollow = true
  for (const { text: lineText, line } of splitRecords(text)) {
    const fields = splitLine(lineText)
    if (fields.every((value) => value === '')) continue
    // Only the first line with something on it can be the header.
    const isFirst = headerMayFollow
    headerMayFollow = false
    if (isFirst && isHeaderLine(lineText, fields)) continue

    const name = readName(fields[0], '')
    if (name === '') {
      problems.push(`Line ${line}: no team name found`)
      continue
    }
    let size: number | null = null
    const days = new Set<Weekday>()
    let domain = ''
    let art = ''
    for (const value of fields.slice(1)) {
      if (value === '') continue
      if (size === null) {
        size = leadingNumber(value)
        if (size !== null) continue
      }
      const weekdays = weekdaysIn(value)
      if (weekdays !== null) for (const day of weekdays) days.add(day)
      else if (domain === '') domain = cut(value, MAX_ORG_NAME_LENGTH).trimEnd()
      else if (art === '') art = cut(value, MAX_ORG_NAME_LENGTH).trimEnd()
    }
    if (size === null) {
      problems.push(`Line ${line}: no team size found for ${name}`)
      continue
    }
    if (size > MAX_TEAM_SIZE) {
      problems.push(`Line ${line}: the team size for ${name} must be between 0 and ${MAX_TEAM_SIZE}`)
      continue
    }
    const nameKey = name.toLowerCase()
    if (namesRead.has(nameKey)) {
      problems.push(`Line ${line}: ${name} appears twice; the second one was skipped`)
      continue
    }
    if (rows.length === MAX_PASTED_TEAMS) {
      problems.push(
        `Line ${line}: more than ${MAX_PASTED_TEAMS} teams were pasted; this line and everything after it was skipped`,
      )
      break
    }
    namesRead.add(nameKey)
    rows.push({ name, size, days: sortDays(days), domain, art, line })
  }
  return { rows, problems }
}

/** The fields of one line, trimmed and without quotes around them. The line is split at
 *  tabs when it has any, else at semicolons when it has any, else at commas. A field in
 *  double quotes can contain the separator (spreadsheets write such cells that way); inside
 *  it, two quotes stand for one. */
/** The pasted text as one record per team, each with the line it starts on. A spreadsheet
 *  copies a cell that has a line break in it inside quotes: such a break does not end the
 *  record, it becomes a space ("Claims" + "Intake" in one cell is the team Claims Intake).
 *  When a quote is never closed the text is simply read line by line. */
function splitRecords(text: string): { text: string; line: number }[] {
  const records: { text: string; line: number }[] = []
  let current = ''
  let line = 1
  let startLine = 1
  let inQuotes = false
  let atFieldStart = true
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    const isBreak = char === '\r' || char === '\n'
    if (isBreak && char === '\r' && text.charAt(i + 1) === '\n') i += 1
    if (inQuotes) {
      if (isBreak) {
        line += 1
        current += ' '
      } else if (char === '"' && text.charAt(i + 1) === '"') {
        current += '""'
        i += 1
      } else {
        if (char === '"') inQuotes = false
        current += char
      }
    } else if (isBreak) {
      records.push({ text: current, line: startLine })
      current = ''
      line += 1
      startLine = line
      atFieldStart = true
    } else {
      // As in splitLine: a quote only opens a quoted cell at the start of a cell.
      if (char === '"' && atFieldStart) inQuotes = true
      atFieldStart = char === '\t' || char === ';' || char === ',' || (atFieldStart && char === ' ')
      current += char
    }
  }
  records.push({ text: current, line: startLine })
  if (inQuotes) return text.split(/\r\n|\r|\n/).map((each, index) => ({ text: each, line: index + 1 }))
  return records
}

function splitLine(line: string): string[] {
  const separator = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ','
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  // A quote only opens a quoted field when nothing but spaces came before it in the field.
  let onlySpacesSoFar = true
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i)
    if (inQuotes) {
      if (char !== '"') {
        current += char
      } else if (line.charAt(i + 1) === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = false
      }
    } else if (char === '"' && onlySpacesSoFar) {
      inQuotes = true
      onlySpacesSoFar = false
    } else if (char === separator) {
      fields.push(current)
      current = ''
      onlySpacesSoFar = true
    } else {
      current += char
      if (char.trim() !== '') onlySpacesSoFar = false
    }
  }
  fields.push(current)
  return fields.map((value) => withoutSingleQuotes(value.trim()))
}

/** "'Claims'" as typed by hand, without its quotes. */
function withoutSingleQuotes(value: string): string {
  const quoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'")
  return quoted ? value.slice(1, -1).trim() : value
}

/** Lower case and without accents: "Équipe" becomes "equipe". */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const LEADING_NUMBER = /^\d+(?:[.,]\d+)?/

/** The number a field starts with, rounded: 8 for "8", "8.0" and "8 people", 8 for "7,5 FTE".
 *  Null when the field starts with something else. */
function leadingNumber(value: string): number | null {
  const match = LEADING_NUMBER.exec(value)
  return match ? Math.round(Number(match[0].replace(',', '.'))) : null
}

/** How the weekdays are written in English, Dutch, German and French. */
const WEEKDAY_WORDS: Record<Weekday, string> = {
  mon: 'mon monday mondays ma maandag maandagen mo montag montags lun lundi lundis',
  tue: 'tue tues tuesday tuesdays di dinsdag dinsdagen dienstag dienstags mar mardi mardis',
  wed: 'wed weds wednesday wednesdays wo woe woensdag woensdagen mi mittwoch mittwochs mer mercredi mercredis',
  thu: 'thu thur thurs thursday thursdays do donderdag donderdagen donnerstag donnerstags jeu jeudi jeudis',
  fri: 'fri friday fridays vr vrij vrijdag vrijdagen fr freitag freitags ven vendredi vendredis',
}

const WEEKDAY_OF_WORD: ReadonlyMap<string, Weekday> = new Map(
  WEEKDAYS.flatMap((day) => WEEKDAY_WORDS[day].split(' ').map((word): [string, Weekday] => [word, day])),
)

/** "Tue and Thu", "di en do", "Di und Do", "mar et jeu". */
const LINKING_WORDS: ReadonlySet<string> = new Set(['and', 'en', 'und', 'et'])

/** The weekdays a field lists when EVERY word in it is a weekday ("Tue/Thu", "di en do");
 *  null for any other field, so that a group called "Marketing" is not taken for a Tuesday. */
function weekdaysIn(value: string): ReadonlySet<Weekday> | null {
  const days = new Set<Weekday>()
  for (const word of plain(value).split(/[\s,;/+&]+/)) {
    // "Tue." is an abbreviation with its dot.
    const bare = word.endsWith('.') ? word.slice(0, -1) : word
    if (bare === '' || LINKING_WORDS.has(bare)) continue
    const day = WEEKDAY_OF_WORD.get(bare)
    if (day === undefined) return null
    days.add(day)
  }
  return days.size > 0 ? days : null
}

/** Words that column headings for name, size, days and group are made of, in the four
 *  languages, in the form `plain` gives them. */
const HEADING_WORDS: ReadonlySet<string> = new Set(
  [
    'name team teams teamname size teamsize people persons headcount head count fte ftes members employees staff',
    'number of days day teamdays weekdays office group department dept division unit tribe',
    'domain domains art arts release train trains agile',
    'naam teamnaam grootte omvang aantal personen mensen medewerkers leden dagen dag teamdagen weekdagen',
    'kantoordagen groep afdeling van domein domeinen',
    'große grosse groesse teamgroße teamgrosse anzahl mitarbeiter mitarbeitende kopfe tage tag teamtage',
    'wochentage burotage gruppe abteilung bereich',
    'nom equipe equipes taille effectif effectifs personnes nombre nb jours jour groupe departement service',
    'de du des d l',
  ].flatMap((words) => words.split(' ')),
)

/** True for a line of column headings, such as "Team; Size; Days; Group": it has no digit
 *  (a line with a digit could be a team with its size), it lists no days, and at least one
 *  of its fields is a heading we know. The other columns may be called anything.
 *
 *  A line without a digit can never be a usable team, so all that is decided here is whether
 *  the line is passed over in silence or reported as a team without a size. */
function isHeaderLine(line: string, fields: readonly string[]): boolean {
  if (/\d/.test(line)) return false
  if (fields.some((value) => weekdaysIn(value) !== null)) return false
  return fields.some(isHeading)
}

/** True for "Team", "Team name", "Nombre de personnes": text made of heading words only. */
function isHeading(value: string): boolean {
  const words = plain(value)
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== '')
  return words.length > 0 && words.every((word) => HEADING_WORDS.has(word))
}
