import floor4Image from '../assets/floor-4.webp?inline'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from '../domain/floor4'
import { makeTeam } from '../domain/model'
import { orgDraft, placeByNames } from '../domain/org'
import type { Action } from '../domain/reducer'
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type DayWish, type Project, type Team, type Weekday } from '../domain/types'

/** What a new planner starts with: floor 4 as supplied, traced and ready, and no teams. */
export function startingProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Office plan',
    floors: [
      {
        id: 'floor-4',
        name: 'Floor 4',
        label: '4',
        plan: { src: floor4Image, width: FLOOR4_PLAN_SIZE.width, height: FLOOR4_PLAN_SIZE.height },
        areas: FLOOR4_AREAS.map((a) => ({ ...a, rect: { ...a.rect } })),
      },
    ],
    domains: [],
    arts: [],
    teams: [],
    settings: { ...DEFAULT_SETTINGS },
    accepted: {},
  }
}

interface ExampleTeam {
  name: string
  /** Domain and ART by name; either may be left out. */
  domain?: string
  art?: string
  size: number
  want: Weekday[]
  /** Days the team could also do. */
  can?: Weekday[]
}

/* Invented teams to try the planner with. Tuesday is deliberately too popular. They show
   every way to belong: on an ART in a domain, in a domain without an ART, and in neither. */
const EXAMPLES: ExampleTeam[] = [
  { name: 'Claims Intake', domain: 'Non-Life', art: 'Claims ART', size: 9, want: ['tue', 'thu'], can: ['wed'] },
  { name: 'Claims Handling', domain: 'Non-Life', art: 'Claims ART', size: 12, want: ['tue', 'thu'] },
  { name: 'Underwriting', domain: 'Non-Life', art: 'Policy ART', size: 10, want: ['tue', 'wed'], can: ['mon'] },
  { name: 'Policy Admin', domain: 'Non-Life', art: 'Policy ART', size: 8, want: ['mon', 'wed'] },
  { name: 'Customer Portal', domain: 'Digital', art: 'Digital Channels', size: 7, want: ['tue', 'thu'], can: ['wed', 'fri'] },
  { name: 'Data Platform', domain: 'Digital', art: 'Digital Channels', size: 6, want: ['tue', 'wed'], can: ['mon', 'thu'] },
  { name: 'Broker Channel', domain: 'Digital', art: 'Digital Channels', size: 8, want: ['tue', 'thu'] },
  { name: 'Finance Operations', domain: 'Corporate', size: 11, want: ['tue', 'fri'], can: ['mon'] },
  { name: 'Risk and Compliance', domain: 'Corporate', size: 6, want: ['mon', 'tue'] },
  { name: 'Architecture', size: 4, want: ['wed'], can: ['thu'] },
]

/** The edit that adds the example teams to the given project (fresh ids, colours that are
 *  free), together with the domains and ARTs they belong to that are not there yet. */
export function exampleTeams(project: Project): { action: Action; count: number } {
  const draft = orgDraft(project)
  const teams: Team[] = []
  for (const example of EXAMPLES) {
    const place = placeByNames(draft, example.domain ?? '', example.art ?? '')
    const current: Project = { ...project, domains: draft.domains, arts: draft.arts, teams: [...project.teams, ...teams] }
    const team = makeTeam(current, { name: example.name, size: example.size, days: example.want, ...place })
    const wishes: Record<Weekday, DayWish> = { ...team.wishes }
    for (const day of example.can ?? []) wishes[day] = 'can'
    teams.push({ ...team, wishes })
  }
  return { action: { type: 'batch', actions: [...draft.added, { type: 'team/addMany', teams }] }, count: teams.length }
}
