import type { ReactNode } from 'react'
import { IconCheck, IconClose, IconDesk, IconWarning } from '../icons'

/** A day cell as it looks in the table, small and not clickable. The legend draws its
 *  samples in ink (see teams.css): a hue would stand for a team. */
function Sample(props: { look?: 'planned' | 'wanted'; children?: ReactNode }) {
  const slot = props.look ? `teams-slot teams-slot--${props.look}` : 'teams-slot'
  return (
    <span className={`${slot} teams-legend__sample`} aria-hidden="true">
      {props.children}
    </span>
  )
}

/** What the day cells show, in samples and words. */
export function Legend() {
  return (
    <div className="teams-legend">
      <ul className="teams-legend__list" aria-label="What a day shows">
        <li className="teams-legend__item">
          <Sample look="planned" />
          Planned team day
        </li>
        <li className="teams-legend__item">
          <Sample look="wanted" />
          Wanted, not planned
        </li>
        <li className="teams-legend__item">
          <Sample>
            <span className="teams-day__ring" />
          </Sample>
          Could also come
        </li>
        <li className="teams-legend__item">
          <Sample>
            <IconClose className="teams-day__icon" />
          </Sample>
          Cannot come
        </li>
      </ul>
      <ul className="teams-legend__list" aria-label="What a planned team day shows">
        <li className="teams-legend__item">
          <Sample look="planned">
            <IconCheck className="teams-day__icon" />
          </Sample>
          All seats placed
        </li>
        <li className="teams-legend__item">
          <Sample look="planned">
            <span className="sign teams-day__count">7/9</span>
          </Sample>
          Seats placed so far
        </li>
        <li className="teams-legend__item">
          <Sample look="planned">
            <IconDesk className="teams-day__icon" />
          </Sample>
          Still to seat
        </li>
        <li className="teams-legend__item">
          <Sample look="planned">
            <IconWarning className="teams-day__icon" />
          </Sample>
          Planned although the team cannot come
        </li>
      </ul>
      <p className="muted small">Click a day to switch it on or off. Right-click for more.</p>
    </div>
  )
}
