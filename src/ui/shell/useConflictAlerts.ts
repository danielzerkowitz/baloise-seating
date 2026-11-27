import { useEffect } from 'react'
import { COLLISION_RULES, type Issue } from '../../domain/conflicts'
import type { Project } from '../../domain/types'
import { issuesOf, projectStore, undoAction } from '../../state/store'
import { toast } from '../primitives'

function collisionsOf(project: Project): Issue[] {
  return issuesOf(project).filter((issue) => COLLISION_RULES.includes(issue.rule))
}

/** True when the whole plan was swapped for another one (a file was opened, the planner
 *  started over): the list of floors and the list of teams are both new, and not a single
 *  floor or team of the old plan is left. Removing a floor also renews both lists, but
 *  keeps the other floors and teams as they were. */
function isAnotherPlan(before: Project, after: Project): boolean {
  if (after.floors === before.floors || after.teams === before.teams) return false
  const old = new Set<unknown>([...before.floors, ...before.teams])
  return ![...after.floors, ...after.teams].some((item) => old.has(item))
}

/** Tells the planner at once when an edit made two things collide: a toast that names the
 *  new conflict and offers to undo the edit. The tool never blocks such an edit; this is how
 *  it does not go unnoticed. */
export function useConflictAlerts(): void {
  useEffect(() => {
    let previous = projectStore.getState()
    // Every state of the plan that was on screen before. Undo and redo only move between
    // these, and going back to an old conflict is not creating one.
    const seen = new WeakSet<Project>([previous])

    return projectStore.subscribe(() => {
      const { state: project, canUndo, canRedo } = projectStore.getSnapshot()
      const before = previous
      previous = project
      const isNew = !seen.has(project)
      seen.add(project)
      if (!isNew) return
      // No history at all means the plan was just loaded: that is where the planner starts,
      // not something an edit did.
      if (!canUndo && !canRedo) return
      // The conflicts of another plan were not created by an edit either.
      if (isAnotherPlan(before, project)) return

      const known = new Set(collisionsOf(before).map((issue) => issue.id))
      const created = collisionsOf(project).filter((issue) => !known.has(issue.id))
      const [first] = created
      if (!first) return
      toast(
        created.length === 1 ? `This created a conflict: ${first.title}` : `This created ${created.length} conflicts`,
        undoAction(),
      )
    })
  }, [])
}
