import { summarizeIssues } from '../../domain/conflicts'
import { useIssues, useProject } from '../../state/store'
import { setUi } from '../../state/ui'
import { plural } from '../format'
import { IconCheck } from '../icons'

/** How the plan stands, in the top bar: conflicts, teams still to seat and warnings. One
 *  button that leads to the list of them. */
export function StatusSummary() {
  const project = useProject()
  const issues = useIssues()
  const { conflicts, teamsToSeat, warnings } = summarizeIssues(project, issues)

  const inWords = [
    conflicts > 0 ? plural(conflicts, 'conflict') : 'no conflicts',
    teamsToSeat > 0 ? `${plural(teamsToSeat, 'team')} to seat` : null,
    warnings > 0 ? plural(warnings, 'warning') : null,
  ].filter((part) => part !== null)

  return (
    <button
      type="button"
      className="btn btn--ghost"
      aria-label={`Show conflicts: ${inWords.join(', ')}`}
      onClick={() => setUi({ view: 'plan', sideTab: 'conflicts' })}
    >
      {conflicts > 0 ? (
        <span className="badge badge--error">{plural(conflicts, 'conflict')}</span>
      ) : (
        <span className="badge badge--ok">
          <IconCheck />
          No conflicts
        </span>
      )}
      {teamsToSeat > 0 ? <span className="badge badge--quiet">{teamsToSeat} to seat</span> : null}
      {warnings > 0 ? <span className="badge badge--warning">{plural(warnings, 'warning')}</span> : null}
    </button>
  )
}
