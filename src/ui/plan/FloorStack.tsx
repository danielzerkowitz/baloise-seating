import { worstSeverity, type Issue } from '../../domain/conflicts'
import { floorLoad } from '../../domain/model'
import { WEEKDAY_NAME, type Id, type Project, type Weekday } from '../../domain/types'
import { setUi } from '../../state/ui'
import { Meter, SeverityIcon } from '../primitives'

/** The building as a stack of floors, top floor first, with how full each is on the shown
 *  day. Picks the floor the plan shows. */
export function FloorStack(props: {
  project: Project
  issues: readonly Issue[]
  day: Weekday
  /** The floor the plan shows, if the project has one. */
  floorId: Id | undefined
}) {
  const { project, issues, day } = props
  // Stored lowest floor first; a building is read from the top down.
  const floors = [...project.floors].reverse()

  return (
    <div className="plan-floors" role="group" aria-label="Floor">
      <div className="plan-floors__stack">
        {floors.map((floor) => {
          const load = floorLoad(project, floor, day)
          const conflict = worstSeverity(issues, { day, floorId: floor.id }, project) === 'error'
          const taken = `${load.usedDesks} of ${load.capacity.desks} desks taken on ${WEEKDAY_NAME[day]}`
          return (
            <button
              key={floor.id}
              type="button"
              className="plan-floor"
              aria-pressed={floor.id === props.floorId}
              aria-label={`${floor.name}, ${taken}${conflict ? ', has a conflict' : ''}`}
              title={floor.name}
              onClick={() => setUi({ floorId: floor.id, selectedAreaId: null })}
            >
              <span className="plan-floor__label sign">{floor.label}</span>
              <span className="plan-floor__count sign">
                {load.usedDesks}/{load.capacity.desks}
              </span>
              <Meter value={load.usedDesks} max={load.capacity.desks} />
              {conflict ? (
                <span className="plan-alert plan-floor__alert">
                  <SeverityIcon severity="error" withTitle />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <button type="button" className="link small plan-floors__edit" onClick={() => setUi({ view: 'floors' })}>
        Edit floors
      </button>
    </div>
  )
}
