import { useState, type CSSProperties, type DragEvent } from 'react'
import { teamStyle } from '../../domain/color'
import type { Issue } from '../../domain/conflicts'
import { dayOccupancy, findTeam, floorLoad, freeOnDays, isSeatable, planAspect, type AreaOccupancy } from '../../domain/model'
import { effectiveScope, placeIntent, scopedDays, type PlaceIntent } from '../../domain/placing'
import { WEEKDAY_NAME, type Area, type Floor, type Id, type Project, type Team, type Weekday } from '../../domain/types'
import type { Spotlight } from '../../state/ui'
import { Paper, Sheet, cx, rectStyle } from './Sheet'

/* A floor on one day: the plan with every area tinted in the colours of the teams sitting
   there, a legend and a title block. This is the picture the whole tool is about; the Plan
   view makes it interactive and print uses it as is. */

/** Drag-and-drop data type that carries a team id (set it when a team row starts a drag). */
export const TEAM_DRAG_TYPE = 'application/x-team-id'

export interface SeatingSheetProps {
  project: Project
  floor: Floor
  day: Weekday
  issues: readonly Issue[]
  /** The team being seated. Its seats stand out, every area shows how many seats are free
   *  for this team on its days, and previews what a click does. */
  activeTeamId?: Id | null
  seatScope?: 'all' | 'day'
  /** A team to make stand out without seating it (pointing at its row). */
  emphasisTeamId?: Id | null
  selectedAreaId?: Id | null
  spotlight?: Spotlight | null
  /** A static picture without buttons (print). */
  readOnly?: boolean
  onAreaClick?: (areaId: Id) => void
  /** A team row was dropped on an area. */
  onTeamDrop?: (areaId: Id, teamId: Id) => void
}

interface AreaView {
  area: Area
  occupancy: AreaOccupancy | undefined
  teams: { team: Team; seats: number }[]
  used: number
  free: number
  /** Over capacity, or seats in a room. */
  conflict: boolean
  horizontal: boolean
  intent: PlaceIntent | null
  /** Seats free for the active team on all the days an edit would touch; null when no team
   *  is being seated or the area is a room. */
  freeForActive: number | null
  mine: boolean
  spot: boolean
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function describeArea(view: AreaView, day: Weekday): string {
  const { area, teams, free } = view
  const dayName = WEEKDAY_NAME[day]
  if (area.kind === 'no-seating') {
    const who = teams.map((t) => `${t.team.name} ${t.seats}`).join(', ')
    return who ? `${area.name}: not for seating, but ${who} placed here on ${dayName}` : `${area.name}: not for seating`
  }
  const what = area.kind === 'desks' ? plural(area.capacity, 'desk', 'desks') : plural(area.capacity, 'overflow seat', 'overflow seats')
  if (teams.length === 0) return `${area.name}: ${what}, all free on ${dayName}`
  const who = teams.map((t) => `${t.team.name} ${t.seats}`).join(', ')
  const rest = free > 0 ? `${free} free` : free === 0 ? 'full' : `${-free} over capacity`
  return `${area.name}: ${what}. ${dayName}: ${who}; ${rest}`
}

function previewText(intent: PlaceIntent | null): string | null {
  if (!intent) return null
  if (intent.type === 'add') return `+${intent.seats}`
  if (intent.type === 'remove') return `−${intent.seats}`
  return null
}

export function SeatingSheet(props: SeatingSheetProps) {
  const { project, floor, day, issues, readOnly } = props
  const [dragOverId, setDragOverId] = useState<Id | null>(null)
  const occupancy = dayOccupancy(project, day)
  const aspect = planAspect(floor)
  const active = readOnly ? undefined : findTeam(project, props.activeTeamId)
  const scope = props.seatScope ?? 'all'
  const spotlight = props.spotlight ?? null
  const activeDays = active && active.days.includes(day) ? scopedDays(active, effectiveScope(active, day, scope)) : []
  const emphasisId = active?.id ?? (readOnly ? null : (props.emphasisTeamId ?? null))

  const flagged = new Set<Id>()
  for (const issue of issues) {
    if (issue.severity === 'error' && issue.day === day && issue.areaId) flagged.add(issue.areaId)
  }

  const views: AreaView[] = floor.areas.map((area) => {
    const occ = occupancy.get(area.id)
    const teams: { team: Team; seats: number }[] = []
    for (const entry of occ?.teams ?? []) {
      const team = findTeam(project, entry.teamId)
      if (team) teams.push({ team, seats: entry.seats })
    }
    const used = occ?.used ?? 0
    const conflict = flagged.has(area.id) || (area.kind === 'no-seating' ? used > 0 : used > area.capacity)
    return {
      area,
      occupancy: occ,
      teams,
      used,
      free: area.capacity - used,
      conflict,
      horizontal: area.rect.w * aspect >= area.rect.h,
      intent: active ? placeIntent(project, active, area, day, scope) : null,
      freeForActive:
        active && activeDays.length > 0 && isSeatable(area.kind)
          ? freeOnDays(project, area.id, activeDays, active.id)
          : null,
      mine: active !== undefined && teams.some((t) => t.team.id === active.id),
      spot:
        spotlight !== null &&
        (spotlight.areaId === area.id ||
          (spotlight.teamId !== null && teams.some((t) => t.team.id === spotlight.teamId))),
    }
  })

  const load = floorLoad(project, floor, day)
  const legend = project.teams
    .filter((t) => load.teamIds.includes(t.id))
    .map((team) => {
      let seats = 0
      for (const v of views) for (const t of v.teams) if (t.team.id === team.id) seats += t.seats
      return { team, seats }
    })

  const onDragOver = (areaId: Id) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(TEAM_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== areaId) setDragOverId(areaId)
  }
  const onDrop = (areaId: Id) => (e: DragEvent) => {
    const teamId = e.dataTransfer.getData(TEAM_DRAG_TYPE)
    setDragOverId(null)
    if (!teamId) return
    e.preventDefault()
    props.onTeamDrop?.(areaId, teamId)
  }

  const footer = (
    <>
      <ul className="legend" aria-label={`Teams on ${floor.name} on ${WEEKDAY_NAME[day]}`}>
        {legend.length === 0 ? (
          <li className="legend__empty">Nobody is seated on this floor on {WEEKDAY_NAME[day]}.</li>
        ) : (
          legend.map(({ team, seats }) => (
            <li key={team.id} className="legend__item">
              <span className="chip" style={teamStyle(team.color) as CSSProperties}>
                {team.code}
              </span>
              <span className="legend__name">{team.name}</span>
              <span className="legend__seats sign">{seats}</span>
            </li>
          ))
        )}
      </ul>
      <dl className="titleblock">
        <div className="titleblock__cell titleblock__cell--floor">
          <dt className="visually-hidden">Floor</dt>
          <dd className="titleblock__floor sign">{floor.label}</dd>
        </div>
        <div className="titleblock__cell">
          <dt className="titleblock__main">{floor.name}</dt>
          <dd className="titleblock__sub">{project.name}</dd>
        </div>
        <div className="titleblock__cell">
          <dt className="titleblock__main">{WEEKDAY_NAME[day]}</dt>
          <dd className="titleblock__sub">{plural(load.teamIds.length, 'team', 'teams')}</dd>
        </div>
        <div className="titleblock__cell titleblock__cell--count">
          <dt className="titleblock__sub">Desks taken</dt>
          <dd className={cx('titleblock__count sign', load.usedDesks > load.capacity.desks && 'is-over')}>
            {load.usedDesks}
            <span className="titleblock__of">/{load.capacity.desks}</span>
          </dd>
        </div>
        {load.capacity.overflow > 0 ? (
          <div className="titleblock__cell titleblock__cell--count">
            <dt className="titleblock__sub">Overflow</dt>
            <dd className={cx('titleblock__count sign', load.usedOverflow > load.capacity.overflow && 'is-over')}>
              {load.usedOverflow}
              <span className="titleblock__of">/{load.capacity.overflow}</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  )

  return (
    <Paper footer={footer}>
      <Sheet
        floor={floor}
        className={cx(active && 'has-active', emphasisId && 'has-emphasis', readOnly && 'is-static')}
        style={active ? (teamStyle(active.color) as CSSProperties) : undefined}
      >
        {/* Colour first, as its own layer straight on the drawing, so it can blend with it. */}
        <div className="sheet__tints" aria-hidden="true">
          {views.map((v) =>
            v.teams.length === 0 ? null : (
              <div key={v.area.id} className={cx('tint', !v.horizontal && 'is-col')} style={rectStyle(v.area.rect)}>
                {v.teams.map(({ team, seats }) => (
                  <span
                    key={team.id}
                    className={cx('tint__band', emphasisId === team.id && 'is-active')}
                    style={{ ...(teamStyle(team.color) as CSSProperties), flexGrow: seats }}
                  />
                ))}
                {v.free > 0 ? <span className="tint__free" style={{ flexGrow: v.free }} /> : null}
              </div>
            ),
          )}
        </div>

        <div className="sheet__areas">
          {views.map((v) => {
            const { area } = v
            const label = describeArea(v, day)
            const preview = previewText(v.intent)
            const className = cx(
              'area',
              `area--${area.kind}`,
              v.conflict && 'is-conflict',
              v.mine && 'is-mine',
              v.intent && `can-${v.intent.type}`,
              props.selectedAreaId === area.id && 'is-selected',
              dragOverId === area.id && 'is-dragover',
            )
            const content = (
              <>
                <span className="area__tag">
                  <span className="area__name">{area.name}</span>
                  {area.kind === 'no-seating' ? null : v.freeForActive !== null ? (
                    <span className="area__count area__count--free sign">
                      {v.freeForActive > 0 ? `${v.freeForActive} free` : 'full'}
                    </span>
                  ) : (
                    <span className="area__count sign">{v.used > 0 ? `${v.used}/${area.capacity}` : area.capacity}</span>
                  )}
                </span>
                {v.teams.length > 0 ? (
                  <span className={cx('area__cells', !v.horizontal && 'is-col')}>
                    {v.teams.map(({ team, seats }) => (
                      <span key={team.id} className="area__cell" style={{ flexGrow: seats }}>
                        <span className="chip area__chip" style={teamStyle(team.color) as CSSProperties}>
                          {team.code}
                          <span className="area__seats">{seats}</span>
                        </span>
                      </span>
                    ))}
                    {v.free > 0 ? <span className="area__cell area__cell--free" style={{ flexGrow: v.free }} /> : null}
                  </span>
                ) : null}
                {preview ? (
                  <span className="area__preview sign" aria-hidden="true">
                    {preview}
                  </span>
                ) : null}
                {v.spot && spotlight ? <span key={spotlight.token} className="area__spot" aria-hidden="true" /> : null}
              </>
            )
            if (readOnly) {
              return (
                <div key={area.id} className={className} style={rectStyle(area.rect)}>
                  {content}
                </div>
              )
            }
            return (
              <button
                key={area.id}
                type="button"
                className={className}
                style={rectStyle(area.rect)}
                aria-label={label}
                aria-pressed={props.selectedAreaId === area.id}
                title={label}
                onClick={() => props.onAreaClick?.(area.id)}
                onDragOver={onDragOver(area.id)}
                onDragLeave={() => setDragOverId((id) => (id === area.id ? null : id))}
                onDrop={onDrop(area.id)}
              >
                {content}
              </button>
            )
          })}
        </div>
      </Sheet>
    </Paper>
  )
}
