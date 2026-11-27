import { useRef } from 'react'
import { artsOf, freeName, makeArt, makeDomain } from '../../domain/model'
import type { Art, Domain, Id, Project } from '../../domain/types'
import { dispatch, undoAction } from '../../state/store'
import { plural } from '../format'
import { IconPlus, IconTrash } from '../icons'
import { Dialog, toast } from '../primitives'
import { MAX_ORG_NAME_LENGTH } from './limits'

/* Domains and ARTs: the organisation the teams belong to. A domain is made of ARTs and of
   teams on no ART; an ART can also stand on its own, outside any domain. Every change is
   applied at once and can be undone. */

function teamCount(project: Project, match: (team: Project['teams'][number]) => boolean): number {
  return project.teams.filter(match).length
}

/** "3 teams", or nothing for none. */
function teamsText(count: number): string {
  return count > 0 ? plural(count, 'team') : 'no teams'
}

function NameInput(props: { label: string; value: string; onChange: (name: string) => void }) {
  return (
    <input
      className="input input--sm"
      aria-label={props.label}
      maxLength={MAX_ORG_NAME_LENGTH}
      autoComplete="off"
      spellCheck={false}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

function ArtRow(props: { project: Project; art: Art }) {
  const { project, art } = props
  const name = art.name.trim() || 'Unnamed ART'
  const teams = teamCount(project, (team) => team.artId === art.id)
  return (
    <li className="org-art">
      <NameInput
        label={`Name of the ART ${name}`}
        value={art.name}
        onChange={(value) =>
          dispatch({ type: 'art/update', id: art.id, patch: { name: value } }, { coalesce: `art-name-${art.id}` })
        }
      />
      <select
        className="select select--sm org-art__domain"
        aria-label={`Domain of the ART ${name}`}
        value={art.domainId ?? ''}
        onChange={(event) =>
          dispatch({ type: 'art/update', id: art.id, patch: { domainId: event.target.value || null } })
        }
      >
        <option value="">No domain</option>
        {project.domains.map((domain) => (
          <option key={domain.id} value={domain.id}>
            {domain.name.trim() || 'Unnamed domain'}
          </option>
        ))}
      </select>
      <span className="muted small org-count">{teamsText(teams)}</span>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label={`Remove the ART ${name}`}
        title="Remove ART"
        onClick={() => {
          dispatch({ type: 'art/remove', id: art.id })
          toast(
            teams > 0 ? `Removed ${name}. Its ${teamsText(teams)} stay in the domain.` : `Removed ${name}`,
            undoAction(),
          )
        }}
      >
        <IconTrash />
      </button>
    </li>
  )
}

function addArt(project: Project, domainId: Id | null): void {
  const art = makeArt(freeName('New ART', project.arts.map((a) => a.name)), domainId)
  dispatch({ type: 'art/add', art })
  // The new ART's name field is the last one of its list: start typing there.
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>(`[data-org-list="${domainId ?? 'none'}"] .org-art:last-child input`)?.select()
  })
}

function DomainBlock(props: { project: Project; domain: Domain }) {
  const { project, domain } = props
  const name = domain.name.trim() || 'Unnamed domain'
  const arts = artsOf(project, domain.id)
  const teams = teamCount(project, (team) => team.domainId === domain.id)
  const withoutArt = teamCount(project, (team) => team.domainId === domain.id && team.artId === null)
  return (
    <section className="org-domain" aria-label={`Domain ${name}`} data-org-domain={domain.id}>
      <div className="org-domain__head">
        <NameInput
          label={`Name of the domain ${name}`}
          value={domain.name}
          onChange={(value) =>
            dispatch({ type: 'domain/rename', id: domain.id, name: value }, { coalesce: `domain-name-${domain.id}` })
          }
        />
        <span className="muted small org-count">
          {teamsText(teams)}
          {withoutArt > 0 && withoutArt < teams ? `, ${withoutArt} on no ART` : ''}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label={`Remove the domain ${name}`}
          title="Remove domain"
          onClick={() => {
            dispatch({ type: 'domain/remove', id: domain.id })
            const kept = [arts.length > 0 ? plural(arts.length, 'ART') : '', teams > 0 ? teamsText(teams) : '']
              .filter(Boolean)
              .join(' and ')
            toast(kept ? `Removed ${name}. Its ${kept} stay, without a domain.` : `Removed ${name}`, undoAction())
          }}
        >
          <IconTrash />
        </button>
      </div>
      <ul className="org-arts" data-org-list={domain.id}>
        {arts.map((art) => (
          <ArtRow key={art.id} project={project} art={art} />
        ))}
      </ul>
      <button type="button" className="btn btn--ghost btn--sm org-add" onClick={() => addArt(project, domain.id)}>
        <IconPlus />
        Add ART to {name}
      </button>
    </section>
  )
}

/** Edit the domains and ARTs. Open while `open` is true. */
export function OrgDialog(props: { project: Project; open: boolean; onClose: () => void }) {
  const { project, open, onClose } = props
  const addDomainRef = useRef<HTMLButtonElement>(null)
  const looseArts = artsOf(project, null)

  const addDomain = () => {
    const domain = makeDomain(freeName('New domain', project.domains.map((d) => d.name)))
    dispatch({ type: 'domain/add', domain })
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-org-domain="${domain.id}"] .org-domain__head input`)?.select()
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Domains and ARTs"
      wide
      initialFocus={addDomainRef}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="stack stack--loose org">
        <p className="muted small">
          A domain is made of ARTs and of teams on no ART, such as a management team. An ART can also be on no
          domain. Pick each team's domain and ART in the table; a team on an ART is in that ART's domain.
        </p>

        {project.domains.length === 0 && project.arts.length === 0 ? (
          <p className="small">No domains or ARTs yet.</p>
        ) : null}

        {project.domains.map((domain) => (
          <DomainBlock key={domain.id} project={project} domain={domain} />
        ))}

        {looseArts.length > 0 ? (
          <section className="org-domain" aria-label="ARTs on no domain">
            <h3 className="list-heading">ARTs on no domain</h3>
            <ul className="org-arts" data-org-list="none">
              {looseArts.map((art) => (
                <ArtRow key={art.id} project={project} art={art} />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="row row--wrap">
          <button ref={addDomainRef} type="button" className="btn" onClick={addDomain}>
            <IconPlus />
            Add domain
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => addArt(project, null)}>
            <IconPlus />
            Add ART on no domain
          </button>
        </div>
      </div>
    </Dialog>
  )
}
