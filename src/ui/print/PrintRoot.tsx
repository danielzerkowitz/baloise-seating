import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { Issue } from '../../domain/conflicts'
import { dayLoad, describeSeating, findArt, findDomain, isTeamDay, planAspect, seatsNeeded } from '../../domain/model'
import { WEEKDAYS, WEEKDAY_NAME, type Floor, type Project, type Weekday } from '../../domain/types'
import { getProject, useIssues, useProject } from '../../state/store'
import { plural } from '../format'
import { SeverityIcon, Swatch } from '../primitives'
import { SeatingSheet } from '../sheet/SeatingSheet'
import { defaultPrintJob, getPrintState, setPrintJob, usePrintState, type PrintJob } from './printState'
import './print.css'

/* A page is A4 landscape with 10 mm margins (see print.css), which leaves 190 mm of height.
   The plan gets what remains once the legend, the title block and the lines under them
   have their room. */
const PAGE_HEIGHT_MM = 190
const BELOW_PLAN_MM = 50

/** One floor on one day. */
function FloorPage(props: { project: Project; floor: Floor; day: Weekday; issues: readonly Issue[]; foot: ReactNode }) {
  const { project, floor, day, issues, foot } = props
  const conflicts = issues.filter(
    (issue) => issue.severity === 'error' && issue.day === day && issue.floorId === floor.id,
  ).length
  // As wide as the page, unless the plan would then be too tall to fit on it.
  const planWidth = `${Math.round((PAGE_HEIGHT_MM - BELOW_PLAN_MM) * planAspect(floor))}mm`

  return (
    <section className="print-page">
      <div className="print-sheet" style={{ '--print-plan-width': planWidth } as CSSProperties}>
        <SeatingSheet readOnly project={project} floor={floor} day={day} issues={issues} />
      </div>
      {conflicts > 0 ? (
        <p className="print-draft">
          <SeverityIcon severity="error" />
          Draft: {plural(conflicts, 'conflict')} open on this floor
        </p>
      ) : null}
      {foot}
    </section>
  )
}

/** Every team with where it sits on each of its days, and how full each day is. */
function WeekPage(props: { project: Project; foot: ReactNode }) {
  const { project, foot } = props
  return (
    <section className="print-page">
      <h2 className="title print-heading">
        {project.name} <span className="print-heading-view">Week overview</span>
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">Domain</th>
            <th scope="col">ART</th>
            <th scope="col" className="num">
              People
            </th>
            <th scope="col" className="num">
              Seats needed
            </th>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col">
                {WEEKDAY_NAME[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {project.teams.length === 0 ? (
            <tr>
              <td colSpan={5 + WEEKDAYS.length} className="muted">
                There are no teams in this plan yet.
              </td>
            </tr>
          ) : null}
          {project.teams.map((team) => (
            <tr key={team.id} className="print-row">
              <td>
                <span className="row">
                  <Swatch color={team.color} />
                  {team.name}
                </span>
              </td>
              <td>{findDomain(project, team.domainId)?.name}</td>
              <td>{findArt(project, team.artId)?.name}</td>
              <td className="num">
                <span className="sign print-number">{team.size}</span>
              </td>
              <td className="num">
                <span className="sign print-number">{seatsNeeded(team, project.settings)}</span>
              </td>
              {WEEKDAYS.map((day) => (
                <td key={day}>
                  {isTeamDay(team, day)
                    ? describeSeating(project, team, day) || <span className="muted">not seated</span>
                    : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="print-row">
            <td colSpan={5}>
              <span className="print-total">Seats needed</span>
            </td>
            {WEEKDAYS.map((day) => {
              const load = dayLoad(project, day)
              return (
                <td key={day}>
                  <span className="sign print-number">{load.needed}</span> of {plural(load.plannableDesks, 'desk')}
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>
      {foot}
    </section>
  )
}

/** The pages of a job: every chosen day in week order, each with the chosen floors from the
 *  top of the building down, and the week overview last. */
function PrintPages(props: { job: PrintJob }) {
  const { job } = props
  const project = useProject()
  const issues = useIssues()
  const days = WEEKDAYS.filter((day) => job.days.includes(day))
  // Floors are stored lowest first.
  const floors = [...project.floors].reverse().filter((floor) => job.floorIds.includes(floor.id))
  const foot = (
    <p className="print-foot">
      <span>{project.name}</span>
      <span>Printed {new Date().toLocaleDateString()}</span>
    </p>
  )

  return (
    <>
      {days.map((day) =>
        floors.map((floor) => (
          <FloorPage key={`${day}-${floor.id}`} project={project} floor={floor} day={day} issues={issues} foot={foot} />
        )),
      )}
      {job.week ? <WeekPage project={project} foot={foot} /> : null}
    </>
  )
}

/** What goes to paper. Always in the document and only visible in print (see app.css);
 *  filled while a print job is stored. */
export function PrintRoot() {
  const { job } = usePrintState()

  useEffect(() => {
    const beforePrint = () => {
      if (getPrintState().job !== null) return
      // The planner printed from the browser's own menu, or with Ctrl+P, instead of from the
      // File menu. Print the usual selection then, not an empty page. It has to be in the
      // document before this handler returns, hence the synchronous render.
      flushSync(() => setPrintJob(defaultPrintJob(getProject())))
    }
    const afterPrint = () => setPrintJob(null)
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  return <div className="print-root">{job ? <PrintPages job={job} /> : null}</div>
}
