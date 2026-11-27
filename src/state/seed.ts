import floor4Image from '../assets/floor-4.webp?inline'
import { FLOOR4_AREAS, FLOOR4_PLAN_SIZE } from '../domain/floor4'
import { makeTeam } from '../domain/model'
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
    teams: [],
    settings: { ...DEFAULT_SETTINGS },
    accepted: {},
  }
}

interface ExampleTeam {
  name: string
  group: string
  size: number
  want: Weekday[]
  /** Days the team could also do. */
  can?: Weekday[]
}

/* Invented teams to try the planner with. Tuesday is deliberately too popular. */
const EXAMPLES: ExampleTeam[] = [
  { name: 'Claims Intake', group: 'Claims', size: 9, want: ['tue', 'thu'], can: ['wed'] },
  { name: 'Claims Handling', group: 'Claims', size: 12, want: ['tue', 'thu'] },
  { name: 'Underwriting', group: 'Policy', size: 10, want: ['tue', 'wed'], can: ['mon'] },
  { name: 'Policy Admin', group: 'Policy', size: 8, want: ['mon', 'wed'] },
  { name: 'Customer Portal', group: 'Digital', size: 7, want: ['tue', 'thu'], can: ['wed', 'fri'] },
  { name: 'Data Platform', group: 'Digital', size: 6, want: ['tue', 'wed'], can: ['mon', 'thu'] },
  { name: 'Broker Channel', group: 'Digital', size: 8, want: ['tue', 'thu'] },
  { name: 'Finance Operations', group: 'Corporate', size: 11, want: ['tue', 'fri'], can: ['mon'] },
  { name: 'Risk and Compliance', group: 'Corporate', size: 6, want: ['mon', 'tue'] },
  { name: 'Architecture', group: 'Corporate', size: 4, want: ['wed'], can: ['thu'] },
]

/** Example teams, ready to add to the given project (fresh ids, colours that are free). */
export function exampleTeams(project: Project): Team[] {
  const teams: Team[] = []
  for (const example of EXAMPLES) {
    const draft: Project = { ...project, teams: [...project.teams, ...teams] }
    const team = makeTeam(draft, {
      name: example.name,
      size: example.size,
      days: example.want,
      group: example.group,
    })
    const wishes: Record<Weekday, DayWish> = { ...team.wishes }
    for (const day of example.can ?? []) wishes[day] = 'can'
    teams.push({ ...team, wishes })
  }
  return teams
}
