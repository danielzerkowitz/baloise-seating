import type { Settings } from '../../domain/types'
import { dispatch } from '../../state/store'
import { PercentField } from './PercentField'

/** The two numbers every count on this page rests on: how much of a team shows up, and how
 *  many desks stay out of the planning. */
export function Assumptions({ settings }: { settings: Settings }) {
  return (
    <section className="teams-assumptions" aria-label="Assumptions">
      <div className="teams-assumptions__field">
        <PercentField
          label="Expected attendance"
          hint="Seats are planned for this share of each team."
          min={10}
          max={100}
          share={settings.attendance}
          onChange={(attendance) =>
            dispatch({ type: 'settings/update', patch: { attendance } }, { coalesce: 'attendance' })
          }
        />
      </div>
      <div className="teams-assumptions__field">
        <PercentField
          label="Keep free"
          hint="Desks held back every day for visitors and people who come in on other days."
          min={0}
          max={50}
          share={settings.reserve}
          onChange={(reserve) => dispatch({ type: 'settings/update', patch: { reserve } }, { coalesce: 'reserve' })}
        />
      </div>
    </section>
  )
}
