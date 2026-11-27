import { describe, expect, it } from 'vitest'
import { normalizeProject } from './files'
import { orgLabel } from './model'
import { orgDraft, placeByNames } from './org'
import { reduce, type Action } from './reducer'
import { floor, project, team, violations } from './testkit'
import type { Project } from './types'

/* Domains and ARTs: a domain is made of ARTs and of teams on no ART; an ART is in one domain
   or in none; a team on an ART is in that ART's domain. */

const org = () => ({
  domains: [
    { id: 'nonlife', name: 'Non-Life' },
    { id: 'mgmt', name: 'Management' },
  ],
  arts: [
    { id: 'claims', name: 'Claims ART', domainId: 'nonlife' },
    { id: 'policy', name: 'Policy ART', domainId: 'nonlife' },
    { id: 'loose', name: 'Platform ART', domainId: null },
  ],
})

const start = () =>
  project(
    [floor('f1', [])],
    [
      team('intake', 4, [], {}, { domainId: 'nonlife', artId: 'claims' }),
      team('board', 3, [], {}, { domainId: 'mgmt' }),
      team('platform', 5, [], {}, { artId: 'loose' }),
      team('free', 2),
    ],
    {},
    org(),
  )

function apply(p: Project, action: Action): Project {
  const next = reduce(p, action)
  expect(violations(next)).toEqual([])
  return next
}

const teamOf = (p: Project, id: string) => p.teams.find((t) => t.id === id)!
const update = (p: Project, id: string, patch: { domainId?: string | null; artId?: string | null }) =>
  apply(p, { type: 'team/update', id, patch })

describe('a team in the organisation', () => {
  it('starts sound, with every way of belonging', () => {
    expect(violations(start())).toEqual([])
  })

  it('takes the domain of the ART it goes on', () => {
    expect(teamOf(update(start(), 'free', { artId: 'policy' }), 'free')).toMatchObject({ domainId: 'nonlife', artId: 'policy' })
    expect(teamOf(update(start(), 'board', { artId: 'loose' }), 'board')).toMatchObject({ domainId: null, artId: 'loose' })
    // The ART wins over a domain given with it.
    expect(teamOf(update(start(), 'free', { domainId: 'mgmt', artId: 'claims' }), 'free')).toMatchObject({
      domainId: 'nonlife',
      artId: 'claims',
    })
  })

  it('leaves its ART for another domain, and keeps it within the same one', () => {
    expect(teamOf(update(start(), 'intake', { domainId: 'mgmt' }), 'intake')).toMatchObject({ domainId: 'mgmt', artId: null })
    expect(teamOf(update(start(), 'intake', { domainId: null }), 'intake')).toMatchObject({ domainId: null, artId: null })
    expect(update(start(), 'intake', { domainId: 'nonlife' })).toStrictEqual(start())
    // Off the ART, still in the domain: a domain team on no ART.
    expect(teamOf(update(start(), 'intake', { artId: null }), 'intake')).toMatchObject({ domainId: 'nonlife', artId: null })
  })

  it('goes nowhere that does not exist', () => {
    const p = start()
    expect(update(p, 'free', { domainId: 'ghost' })).toBe(p)
    expect(update(p, 'free', { artId: 'ghost' })).toBe(p)
    expect(teamOf(update(p, 'intake', { artId: 'ghost' }), 'intake')).toMatchObject({ domainId: 'nonlife', artId: null })
  })

  it('is made to fit when it is added as a whole', () => {
    const p = apply(start(), {
      type: 'team/add',
      team: team('new', 3, [], {}, { domainId: 'mgmt', artId: 'claims' }),
    })
    expect(teamOf(p, 'new')).toMatchObject({ domainId: 'nonlife', artId: 'claims' })
    const q = apply(start(), { type: 'team/add', team: team('lost', 3, [], {}, { domainId: 'ghost', artId: 'ghost' }) })
    expect(teamOf(q, 'lost')).toMatchObject({ domainId: null, artId: null })
  })

  it('is named by its domain and ART', () => {
    const p = start()
    expect(orgLabel(p, teamOf(p, 'intake'))).toBe('Non-Life · Claims ART')
    expect(orgLabel(p, teamOf(p, 'board'))).toBe('Management')
    expect(orgLabel(p, teamOf(p, 'platform'), ', ')).toBe('Platform ART')
    expect(orgLabel(p, teamOf(p, 'free'))).toBe('')
  })
})

describe('domain and ART edits', () => {
  it('adds a domain once, named within bounds', () => {
    const p = apply(start(), { type: 'domain/add', domain: { id: 'life', name: `Life${'\u0000'}${'x'.repeat(80)}` } })
    expect(p.domains.at(-1)).toEqual({ id: 'life', name: `Life${'x'.repeat(56)}` })
    expect(reduce(p, { type: 'domain/add', domain: { id: 'life', name: 'Again' } })).toBe(p)
  })

  it('renames a domain, and changes nothing for the same name or a missing domain', () => {
    const p = apply(start(), { type: 'domain/rename', id: 'mgmt', name: 'Board' })
    expect(p.domains[1]).toEqual({ id: 'mgmt', name: 'Board' })
    expect(reduce(p, { type: 'domain/rename', id: 'mgmt', name: 'Board' })).toBe(p)
    expect(reduce(p, { type: 'domain/rename', id: 'ghost', name: 'X' })).toBe(p)
  })

  it('removes a domain: its ARTs and teams stay, without a domain', () => {
    const p = apply(start(), { type: 'domain/remove', id: 'nonlife' })
    expect(p.domains.map((d) => d.id)).toEqual(['mgmt'])
    expect(p.arts.find((a) => a.id === 'claims')?.domainId).toBeNull()
    expect(teamOf(p, 'intake')).toMatchObject({ domainId: null, artId: 'claims' })
    expect(teamOf(p, 'board')).toMatchObject({ domainId: 'mgmt' })
  })

  it('adds an ART in a domain that exists, or else in none', () => {
    const p = apply(start(), { type: 'art/add', art: { id: 'life-art', name: 'Life ART', domainId: 'ghost' } })
    expect(p.arts.at(-1)).toEqual({ id: 'life-art', name: 'Life ART', domainId: null })
    expect(reduce(p, { type: 'art/add', art: { id: 'claims', name: 'Twice', domainId: null } })).toBe(p)
  })

  it('moves an ART to another domain, and its teams along', () => {
    const p = apply(start(), { type: 'art/update', id: 'claims', patch: { domainId: 'mgmt' } })
    expect(teamOf(p, 'intake')).toMatchObject({ domainId: 'mgmt', artId: 'claims' })
    const q = apply(p, { type: 'art/update', id: 'claims', patch: { domainId: null, name: 'Claims' } })
    expect(q.arts[0]).toEqual({ id: 'claims', name: 'Claims', domainId: null })
    expect(teamOf(q, 'intake')).toMatchObject({ domainId: null, artId: 'claims' })
    expect(reduce(q, { type: 'art/update', id: 'claims', patch: { domainId: 'ghost' } })).toBe(q)
    expect(reduce(q, { type: 'art/update', id: 'ghost', patch: { name: 'X' } })).toBe(q)
  })

  it('removes an ART: its teams stay in the domain, on no ART', () => {
    const p = apply(start(), { type: 'art/remove', id: 'claims' })
    expect(p.arts.map((a) => a.id)).toEqual(['policy', 'loose'])
    expect(teamOf(p, 'intake')).toMatchObject({ domainId: 'nonlife', artId: null })
  })
})

describe('reading domains and ARTs', () => {
  it('turns the groups of a version 1 plan into domains, one per name whatever its case', () => {
    const p = normalizeProject({
      schemaVersion: 1,
      floors: [],
      teams: [
        { name: 'Intake', group: 'Claims' },
        { name: 'Handling', group: ' claims ' },
        { name: 'Board', group: 'Management' },
        { name: 'Free', group: '' },
        { name: 'Odd', group: 7 },
      ],
    })
    expect(p.schemaVersion).toBe(2)
    expect(p.domains.map((d) => d.name)).toEqual(['Claims', 'Management'])
    expect(p.arts).toEqual([])
    const [claims, management] = p.domains
    expect(p.teams.map((t) => [t.domainId, t.artId])).toEqual([
      [claims?.id, null],
      [claims?.id, null],
      [management?.id, null],
      [null, null],
      [null, null],
    ])
    expect(violations(p)).toEqual([])
    expect(normalizeProject(p)).toStrictEqual(p)
  })

  it('keeps what fits and drops every reference that leads nowhere', () => {
    const p = normalizeProject({
      schemaVersion: 2,
      floors: [],
      domains: [{ id: 'nonlife', name: ' Non-Life ' }, { id: 'nonlife', name: 'Twice' }, { id: 'bad id!', name: '' }, 'junk'],
      arts: [
        { id: 'claims', name: 'Claims ART', domainId: 'nonlife' },
        { id: 'stray', name: 'Stray ART', domainId: 'bad id!' },
        { id: 'orphan', domainId: 'ghost' },
      ],
      teams: [
        { name: 'Intake', domainId: 'ghost', artId: 'claims' },
        { name: 'Board', domainId: 'nonlife', artId: 'ghost' },
        { name: 'Stray', artId: 'stray', group: 'Ignored' },
        { name: 'Lost', domainId: 'bad id!' },
      ],
    })
    expect(violations(p)).toEqual([])
    expect(p.domains.map((d) => d.name)).toEqual(['Non-Life', 'Twice', 'Domain 3'])
    expect(p.domains[0]?.id).toBe('nonlife')
    expect(p.arts.map((a) => [a.id, a.name, a.domainId])).toEqual([
      ['claims', 'Claims ART', 'nonlife'],
      // The domain it named got a new id: which of two was meant cannot be known.
      ['stray', 'Stray ART', null],
      ['orphan', 'ART 3', null],
    ])
    expect(p.teams.map((t) => [t.name, t.domainId, t.artId])).toEqual([
      // The ART decides the domain.
      ['Intake', 'nonlife', 'claims'],
      ['Board', 'nonlife', null],
      // A version 2 team's group is not read.
      ['Stray', null, 'stray'],
      ['Lost', null, null],
    ])
    expect(normalizeProject(p)).toStrictEqual(p)
  })

  it('refuses more domains or ARTs than a plan can have', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }))
    expect(() => normalizeProject({ floors: [], teams: [], domains: many(501) })).toThrow()
    expect(() => normalizeProject({ floors: [], teams: [], arts: many(2001) })).toThrow()
  })
})

describe('placing teams by name', () => {
  const draft = () => orgDraft(org())

  it('finds what exists, ignoring case and spaces', () => {
    const d = draft()
    expect(placeByNames(d, ' non-life ', 'claims art')).toEqual({ domainId: 'nonlife', artId: 'claims' })
    expect(placeByNames(d, '', 'Platform ART')).toEqual({ domainId: null, artId: 'loose' })
    expect(placeByNames(d, 'Management', '')).toEqual({ domainId: 'mgmt', artId: null })
    expect(placeByNames(d, '', '')).toEqual({ domainId: null, artId: null })
    expect(d.added).toEqual([])
  })

  it('reads one name that is an ART as the ART', () => {
    expect(placeByNames(draft(), 'Policy ART', '')).toEqual({ domainId: 'nonlife', artId: 'policy' })
  })

  it('makes what is named but missing, once', () => {
    const d = draft()
    const first = placeByNames(d, 'Life', 'Life ART')
    const second = placeByNames(d, 'life', 'LIFE ART')
    expect(second).toEqual(first)
    // An ART of a name that exists in another domain is a different ART.
    const other = placeByNames(d, 'Management', 'Claims ART')
    expect(other.artId).not.toBe('claims')
    expect(d.added.map((action) => action.type)).toEqual(['domain/add', 'art/add', 'art/add'])
    let p = project([], [], {}, org())
    for (const action of d.added) p = apply(p, action)
    expect(p.domains.map((x) => x.name)).toEqual(['Non-Life', 'Management', 'Life'])
    expect(p.arts.map((x) => x.name)).toEqual(['Claims ART', 'Policy ART', 'Platform ART', 'Life ART', 'Claims ART'])
  })
})
