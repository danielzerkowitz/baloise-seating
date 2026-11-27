import { dayOccupancy, findTeam, isSeatable, type AreaRef } from '../../domain/model'
import { AREA_KIND_NAME, WEEKDAYS, WEEKDAY_NAME, WEEKDAY_SHORT, type Project, type Weekday } from '../../domain/types'
import { setUi } from '../../state/ui'
import { plural } from '../format'
import { IconClose, IconError, IconPencil } from '../icons'
import { TeamChip } from '../primitives'

/** "3 free", "full" or "2 over". */
function freeText(free: number): string {
  if (free > 0) return `${free} free`
  return free === 0 ? 'full' : `${-free} over`
}

/** The selected area: what it is for and who sits there on each day of the week. */
export function AreaInspector(props: {
  project: Project
  selected: AreaRef
  /** The shown day; its row is marked. */
  day: Weekday
  onClose: () => void
}) {
  const { project, day } = props
  const { area, floor } = props.selected

  return (
    <section aria-label={`Area ${area.name}`}>
      <div className="plan-inspector__head">
        <div>
          <h3 className="subtitle">{area.name}</h3>
          <p className="muted small">
            {AREA_KIND_NAME[area.kind]}, {plural(area.capacity, 'seat')}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Close area details"
          onClick={props.onClose}
        >
          <IconClose />
        </button>
      </div>

      {isSeatable(area.kind) ? (
        <>
          <h4 className="list-heading">This week</h4>
          <ul className="plan-week">
            {WEEKDAYS.map((weekday) => {
              const occupancy = dayOccupancy(project, weekday).get(area.id)
              const free = occupancy?.free ?? area.capacity
              const teams = (occupancy?.teams ?? []).flatMap(({ teamId, seats }) => {
                const team = findTeam(project, teamId)
                return team ? [{ team, seats }] : []
              })
              const who = teams.map(({ team, seats }) => `${team.name} ${seats}`).join(', ') || 'nobody'
              return (
                <li key={weekday}>
                  <button
                    type="button"
                    className="plan-week__row"
                    aria-current={weekday === day ? 'true' : undefined}
                    aria-label={`${WEEKDAY_NAME[weekday]}: ${who}, ${freeText(free)}`}
                    onClick={() => setUi({ day: weekday })}
                  >
                    <span>{WEEKDAY_SHORT[weekday]}</span>
                    <span className="plan-week__teams">
                      {teams.map(({ team, seats }) => (
                        <TeamChip key={team.id} color={team.color} title={team.name}>
                          {team.code} {seats}
                        </TeamChip>
                      ))}
                    </span>
                    {free < 0 ? (
                      <span className="plan-week__free plan-week__free--over small">
                        <IconError className="plan-icon" />
                        {freeText(free)}
                      </span>
                    ) : (
                      <span className="plan-week__free muted small">{freeText(free)}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="small plan-inspector__text">Not for seating. Teams cannot be placed here.</p>
      )}

      <div className="plan-inspector__edit">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setUi({ view: 'floors', floorId: floor.id, selectedAreaId: area.id })}
        >
          <IconPencil />
          Edit this area
        </button>
      </div>
    </section>
  )
}
