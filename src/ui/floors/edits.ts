import { copyFloor, findFloor, indexAreas, makeArea, seatingOn } from '../../domain/model'
import type { Id, Project, Rect, Team, Weekday } from '../../domain/types'
import { dispatch, getProject, undoAction } from '../../state/store'
import { getUi, setUi } from '../../state/ui'
import { toast } from '../primitives'
import { DUPLICATE_OFFSET, moveRect } from './rects'

/* The edits of the Floors view that are more than one dispatch: they also move the
   selection and say what was lost. They read the project at the moment they run, so
   buttons and keyboard shortcuts share them. */

export interface AreaUse {
  team: Team
  /** The team days on which the team holds seats there. */
  days: Weekday[]
}

/** The teams that hold seats in at least one of the given areas on one of their team days,
 *  in team-list order. */
export function teamsUsing(project: Project, areaIds: readonly Id[]): AreaUse[] {
  const wanted = new Set(areaIds)
  const uses: AreaUse[] = []
  for (const team of project.teams) {
    const days = team.days.filter((day) => {
      const seating = seatingOn(team, day)
      for (const areaId in seating) {
        if (wanted.has(areaId) && (seating[areaId] ?? 0) > 0) return true
      }
      return false
    })
    if (days.length > 0) uses.push({ team, days })
  }
  return uses
}

/** What the toast says after removing a floor or an area on which `teams` teams sat. */
function removedMessage(name: string, teams: number): string {
  if (teams === 0) return `Removed ${name}`
  const lost = teams === 1 ? '1 team lost its seats there.' : `${teams} teams lost their seats there.`
  return `Removed ${name}. ${lost}`
}

/** Adds an area with this rectangle to a floor and selects it. Returns the new area's id,
 *  or null when the floor is gone. */
export function addArea(floorId: Id, rect: Rect): Id | null {
  const floor = findFloor(getProject(), floorId)
  if (!floor) return null
  const area = makeArea(floor, rect)
  dispatch({ type: 'area/add', floorId, area })
  setUi({ selectedAreaId: area.id })
  return area.id
}

/** Adds a copy of an area a little to the right and below it, with the same use, seats and
 *  size and the next free name, and selects the copy. Returns the copy's id. */
export function duplicateArea(areaId: Id): Id | null {
  const ref = indexAreas(getProject()).get(areaId)
  if (!ref) return null
  const { area, floor } = ref
  // The copy stays inside the plan: next to the right or bottom edge it moves less far.
  const copy = makeArea(floor, moveRect(area.rect, DUPLICATE_OFFSET, DUPLICATE_OFFSET), {
    kind: area.kind,
    capacity: area.capacity,
  })
  dispatch({ type: 'area/add', floorId: floor.id, area: copy })
  setUi({ selectedAreaId: copy.id })
  return copy.id
}

/** Removes an area together with the seats teams held there, and offers to undo it. */
export function removeArea(areaId: Id): void {
  const project = getProject()
  const ref = indexAreas(project).get(areaId)
  if (!ref) return
  const teams = teamsUsing(project, [areaId]).length
  dispatch({ type: 'area/remove', id: areaId })
  if (getUi().selectedAreaId === areaId) setUi({ selectedAreaId: null })
  toast(removedMessage(ref.area.name, teams), undoAction())
}

/** Adds a copy of a floor (same sign, image and areas, no teams) on top of the building
 *  and shows it. */
export function duplicateFloor(floorId: Id): void {
  const floor = findFloor(getProject(), floorId)
  if (!floor) return
  // The sign is passed on as it is: one that was typed by hand would not survive being
  // worked out again from the new name.
  const copy = copyFloor(floor, `${floor.name} copy`, floor.label)
  dispatch({ type: 'floor/add', floor: copy })
  setUi({ floorId: copy.id, selectedAreaId: null })
}

/** Removes a floor with its areas and the seats teams held there, and offers to undo it.
 *  The view's floor is left as it is: the top floor shows while this one is gone, and
 *  undoing brings the planner back to it. */
export function removeFloor(floorId: Id): void {
  const project = getProject()
  const floor = findFloor(project, floorId)
  if (!floor) return
  const areaIds = floor.areas.map((area) => area.id)
  const teams = teamsUsing(project, areaIds).length
  dispatch({ type: 'floor/remove', id: floorId })
  const selected = getUi().selectedAreaId
  if (selected !== null && areaIds.includes(selected)) setUi({ selectedAreaId: null })
  toast(removedMessage(floor.name, teams), undoAction())
}
