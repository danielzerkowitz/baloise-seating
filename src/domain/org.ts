import { makeArt, makeDomain } from './model'
import type { Action } from './reducer'
import type { Art, Domain, Id, Project } from './types'

/* Placing teams in the organisation by name, as a pasted team list or the example teams do:
   domains and ARTs that are named but do not exist yet are made, once each. */

export interface OrgDraft {
  domains: Domain[]
  arts: Art[]
  /** The domains and ARTs made so far, as actions to dispatch before the teams. */
  added: Action[]
}

export function orgDraft(project: Pick<Project, 'domains' | 'arts'>): OrgDraft {
  return { domains: [...project.domains], arts: [...project.arts], added: [] }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function domainNamed(draft: OrgDraft, name: string): Domain {
  let domain = draft.domains.find((d) => same(d.name, name))
  if (!domain) {
    domain = makeDomain(name.trim())
    draft.domains.push(domain)
    draft.added.push({ type: 'domain/add', domain })
  }
  return domain
}

function artNamed(draft: OrgDraft, name: string, domainId: Id | null): Art {
  let art = draft.arts.find((a) => same(a.name, name) && a.domainId === domainId)
  if (!art) {
    art = makeArt(name.trim(), domainId)
    draft.arts.push(art)
    draft.added.push({ type: 'art/add', art })
  }
  return art
}

/** The domain and ART for a team given by name; either may be empty.
 *  - With an ART name, the team goes on that ART: the one of that name in the named domain,
 *    or with no domain named, the one of that name anywhere. A new ART is made in the named
 *    domain (or in none).
 *  - With a domain name only, the team goes in that domain, made when needed. A name that is
 *    no domain but an existing ART puts the team on that ART: a list with one column for
 *    "domain or ART" reads as meant. */
export function placeByNames(draft: OrgDraft, domainName: string, artName: string): { domainId: Id | null; artId: Id | null } {
  const domainText = domainName.trim()
  const artText = artName.trim()
  if (artText !== '') {
    if (domainText === '') {
      const existing = draft.arts.find((a) => same(a.name, artText))
      const art = existing ?? artNamed(draft, artText, null)
      return { domainId: art.domainId, artId: art.id }
    }
    const domain = domainNamed(draft, domainText)
    return { domainId: domain.id, artId: artNamed(draft, artText, domain.id).id }
  }
  if (domainText === '') return { domainId: null, artId: null }
  if (!draft.domains.some((d) => same(d.name, domainText))) {
    const art = draft.arts.find((a) => same(a.name, domainText))
    if (art) return { domainId: art.domainId, artId: art.id }
  }
  return { domainId: domainNamed(draft, domainText).id, artId: null }
}
