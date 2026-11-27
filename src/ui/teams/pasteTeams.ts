import type { ParsedTeamRow } from '../../domain/files'
import { makeTeam } from '../../domain/model'
import { orgDraft, placeByNames, type OrgDraft } from '../../domain/org'
import { reduce, type Action } from '../../domain/reducer'
import { WEEKDAYS, type Id, type Project, type Team } from '../../domain/types'
import { plural } from '../format'

/* What pasting a list of teams does to the plan. Worked out as plain data first, so that
   the dialog can say what will happen before it happens, and so that it all becomes one
   edit that is undone in one step. */

/** What happens with one pasted row.
 *  - `add`: it becomes a new team
 *  - `update`: a team of that name is in the plan and changes
 *  - `same`: a team of that name is in the plan and already is as pasted
 *  - `kept`: a team of that name is in the plan and is left alone (updating is switched off) */
export type PasteEffect = 'add' | 'update' | 'same' | 'kept'

export interface PastePlan {
  /** The edits, to dispatch as one batch. */
  actions: Action[]
  /** New teams. */
  added: number
  /** Teams that were in the plan before and change. */
  updated: number
  /** Every row with what happens to it, in the order of the rows. */
  rows: { row: ParsedTeamRow; effect: PasteEffect }[]
}

/** Teams are matched by name; capitals and spaces around the name do not matter. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

type Place = { domainId: Id | null; artId: Id | null }

/** The edits that turn a team into what the row says: the row's size, its domain and ART
 *  when it names them, and when it has days, exactly those days as the wanted ones. Edits
 *  that turn out to change nothing are dropped by the caller. */
function editsFor(team: Team, row: ParsedTeamRow, place: Place | null): Action[] {
  const edits: Action[] = [
    { type: 'team/update', id: team.id, patch: place ? { size: row.size, ...place } : { size: row.size } },
  ]
  if (row.days.length === 0) return edits
  for (const day of WEEKDAYS) {
    const listed = row.days.includes(day)
    const wanted = team.wishes[day] === 'want'
    if (listed && !wanted) edits.push({ type: 'team/setWish', id: team.id, day, wish: 'want' })
    if (!listed && wanted) edits.push({ type: 'team/setWish', id: team.id, day, wish: 'none' })
  }
  return edits
}

/** Works out what pasting `rows` into `project` does. The rows are taken one after another,
 *  each against the plan as the rows before it leave it. A row whose name is the name of a
 *  team concerns that team: the team is updated, or with `updateExisting` off left alone.
 *  Every other row becomes a new team. */
export function planPaste(project: Project, rows: readonly ParsedTeamRow[], updateExisting: boolean): PastePlan {
  const actions: Action[] = []
  const planned: PastePlan['rows'] = []
  const added = new Set<Id>()
  const updated = new Set<Id>()
  // The plan as it will be after the rows so far. A new team gets a colour and a code that
  // the new teams before it did not take.
  let draft = project
  const org = orgDraft(project)

  /** Where the row puts its team, making the domains and ARTs it names that are not there
   *  yet; null when it names neither. */
  const placeOf = (row: ParsedTeamRow, organisation: OrgDraft): Place | null => {
    if (row.domain.trim() === '' && row.art.trim() === '') return null
    const madeBefore = organisation.added.length
    const place = placeByNames(organisation, row.domain, row.art)
    for (const action of organisation.added.slice(madeBefore)) {
      actions.push(action)
      draft = reduce(draft, action)
    }
    return place
  }

  for (const row of rows) {
    const match = draft.teams.find((team) => nameKey(team.name) === nameKey(row.name))
    if (!match) {
      const place = placeOf(row, org)
      const team = makeTeam(draft, { name: row.name.trim(), size: row.size, days: row.days, ...place })
      const action: Action = { type: 'team/add', team }
      actions.push(action)
      draft = reduce(draft, action)
      added.add(team.id)
      planned.push({ row, effect: 'add' })
      continue
    }
    if (!updateExisting) {
      planned.push({ row, effect: 'kept' })
      continue
    }
    const before = draft
    for (const edit of editsFor(match, row, placeOf(row, org))) {
      const next = reduce(draft, edit)
      if (next === draft) continue
      actions.push(edit)
      draft = next
    }
    planned.push({ row, effect: draft === before ? 'same' : 'update' })
    // A change to a team that this paste added itself is part of adding it.
    if (draft !== before && !added.has(match.id)) updated.add(match.id)
  }

  return { actions, added: added.size, updated: updated.size, rows: planned }
}

const SUMMARY_WORDS = {
  present: { add: 'Add', update: 'Update', andUpdate: 'and update' },
  past: { add: 'Added', update: 'Updated', andUpdate: 'and updated' },
} as const

/** The effect as the button says it ("Add 6 teams and update 2") or, in the past tense, as
 *  the message afterwards says it ("Added 6 teams and updated 2"). Null when there is
 *  nothing to do. */
export function pasteSummary(plan: Pick<PastePlan, 'added' | 'updated'>, tense: 'present' | 'past'): string | null {
  const { added, updated } = plan
  const words = SUMMARY_WORDS[tense]
  if (added > 0 && updated > 0) return `${words.add} ${plural(added, 'team')} ${words.andUpdate} ${updated}`
  if (added > 0) return `${words.add} ${plural(added, 'team')}`
  if (updated > 0) return `${words.update} ${plural(updated, 'team')}`
  return null
}
