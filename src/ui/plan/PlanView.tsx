import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { summarizeIssues } from '../../domain/conflicts'
import { dayLoad, findTeam, indexAreas } from '../../domain/model'
import { WEEKDAY_NAME, type Id } from '../../domain/types'
import { useIssues, useProject } from '../../state/store'
import { currentFloor, setUi, useUi } from '../../state/ui'
import { ConflictList } from '../conflicts/ConflictList'
import { plural } from '../format'
import { IconInfo } from '../icons'
import { Segmented } from '../primitives'
import { SeatingSheet } from '../sheet/SeatingSheet'
import { SheetViewport } from '../sheet/Sheet'
import {
  AREA_INSPECTOR_ID,
  deselectArea,
  focusFirstTeamRow,
  placeTeam,
  seatEveryoneAutomatically,
  seatNextTeam,
  stopSeating,
  type AutoSeatReport,
} from './actions'
import { AreaInspector } from './AreaInspector'
import { AutoSeatDialog } from './AutoSeatDialog'
import { DayStrip } from './DayStrip'
import { FloorStack } from './FloorStack'
import { PlacingBar } from './PlacingBar'
import { TeamTray } from './TeamTray'
import './plan.css'

/** The main screen: one floor on one weekday. Pick a team in the tray, click areas on the
 *  plan to seat it, and see conflicts as they arise. */
export function PlanView() {
  const project = useProject()
  const issues = useIssues()
  const ui = useUi()
  // The team whose row is pointed at or focused: its seats stand out on the plan.
  const [emphasisTeamId, setEmphasisTeamId] = useState<Id | null>(null)
  const [autoSeatReport, setAutoSeatReport] = useState<AutoSeatReport | null>(null)

  const floor = currentFloor(project, ui)
  const activeTeam = findTeam(project, ui.activeTeamId)
  // While a team is being seated the panel belongs to that team, so the inspector waits.
  const inspected = activeTeam || !ui.selectedAreaId ? undefined : indexAreas(project).get(ui.selectedAreaId)
  const load = dayLoad(project, ui.day)
  const conflicts = summarizeIssues(project, issues).conflicts

  const emphasize = useCallback((teamId: Id, on: boolean) => {
    // Leaving one row and entering the next can arrive in either order: only the row that
    // holds the emphasis may drop it.
    setEmphasisTeamId((current) => (on ? teamId : current === teamId ? null : current))
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      // Fields keep their keys for typing. An open dialog owns the keyboard: Escape closes
      // it, and nothing behind it should change meanwhile.
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (document.querySelector('dialog[open]')) return
      if (e.key === 'Escape') {
        stopSeating()
        deselectArea()
      } else if (e.key === 'n' || e.key === 'N') {
        seatNextTeam()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const clickArea = (areaId: Id) => {
    if (activeTeam) placeTeam(activeTeam.id, areaId)
    else setUi({ selectedAreaId: ui.selectedAreaId === areaId ? null : areaId })
  }

  const dropTeam = (areaId: Id, teamId: Id) => {
    if (!findTeam(project, teamId)) return
    setUi({ activeTeamId: teamId })
    placeTeam(teamId, areaId)
  }

  const closeAutoSeatReport = () => {
    // Rendered at once: the dialog closes, and the browser hands the focus back to the
    // button that opened it. When every team got its seats that button is gone, and the
    // focus moves on to the tray instead of getting lost.
    flushSync(() => setAutoSeatReport(null))
    if (document.activeElement === document.body) focusFirstTeamRow()
  }

  const sideTabs = [
    { value: 'teams', label: 'Teams' },
    { value: 'conflicts', label: conflicts > 0 ? `Conflicts ${conflicts}` : 'Conflicts' },
  ] as const

  return (
    <div className="view plan">
      <FloorStack project={project} issues={issues} day={ui.day} floorId={floor?.id} />

      <section className="plan-canvas" aria-label="Plan">
        <DayStrip project={project} issues={issues} day={ui.day} />
        {activeTeam ? (
          <PlacingBar project={project} team={activeTeam} day={ui.day} seatScope={ui.seatScope} />
        ) : null}
        {floor ? (
          <>
            {floor.areas.length === 0 ? (
              <p className="note plan-canvas__note">
                <IconInfo />
                <span>
                  This floor has no seating areas yet.{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => setUi({ view: 'floors', floorId: floor.id })}
                  >
                    Draw them in Floors
                  </button>
                </span>
              </p>
            ) : null}
            <SheetViewport resetKey={floor.id}>
              <SeatingSheet
                project={project}
                floor={floor}
                day={ui.day}
                issues={issues}
                activeTeamId={activeTeam?.id ?? null}
                seatScope={ui.seatScope}
                emphasisTeamId={emphasisTeamId}
                selectedAreaId={ui.selectedAreaId}
                spotlight={ui.spotlight}
                onAreaClick={clickArea}
                onTeamDrop={dropTeam}
              />
            </SheetViewport>
          </>
        ) : (
          <div className="plan-canvas__empty">
            <div className="empty">
              <h2 className="empty__title">No floor yet</h2>
              <p className="empty__text">Add a floor plan to start seating teams.</p>
              <button type="button" className="btn btn--primary" onClick={() => setUi({ view: 'floors' })}>
                Add a floor
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="panel plan-side" aria-label="Teams and conflicts">
        <div className="plan-side__header">
          <h2 className="subtitle">{WEEKDAY_NAME[ui.day]}</h2>
          <p className="muted small">
            {plural(load.teams, 'team')}, {plural(load.needed, 'seat')} needed
          </p>
          <div className="plan-side__tabs">
            <Segmented
              label="Teams or conflicts"
              options={sideTabs}
              value={ui.sideTab}
              onChange={(sideTab) => setUi({ sideTab })}
            />
          </div>
        </div>
        <div className="plan-side__body">
          {inspected ? (
            <div id={AREA_INSPECTOR_ID} className="plan-side__inspector">
              <AreaInspector project={project} selected={inspected} day={ui.day} onClose={deselectArea} />
            </div>
          ) : null}
          {ui.sideTab === 'teams' ? (
            <TeamTray
              project={project}
              issues={issues}
              day={ui.day}
              activeTeamId={activeTeam?.id ?? null}
              seatScope={ui.seatScope}
              onEmphasis={emphasize}
              onSeatEveryone={() => setAutoSeatReport(seatEveryoneAutomatically())}
            />
          ) : (
            <div className="plan-side__conflicts">
              <ConflictList day={ui.day} />
            </div>
          )}
        </div>
        <AutoSeatDialog project={project} report={autoSeatReport} onClose={closeAutoSeatReport} />
      </aside>
    </div>
  )
}
