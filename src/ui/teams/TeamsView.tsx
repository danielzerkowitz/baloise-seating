import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { findTeam } from '../../domain/model'
import type { Id } from '../../domain/types'
import { useProject } from '../../state/store'
import { IconChevronDown, IconPlus } from '../icons'
import { Menu, type MenuItem } from '../primitives'
import { Assumptions } from './Assumptions'
import { Legend } from './Legend'
import { PasteTeamsDialog } from './PasteTeamsDialog'
import { TeamNotesDialog } from './TeamNotesDialog'
import { TeamsTable } from './TeamsTable'
import { addExampleTeams, removeAllTeams } from './teamActions'
import './teams.css'

/** "Teams and days": where teams are entered and where the week is balanced. */
export function TeamsView() {
  const project = useProject()
  // Without teams the view shows an invitation instead of the table, unless the planner has
  // started typing teams in: then the table stays, also while it is still or again empty.
  const [keepTable, setKeepTable] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [notesTeamId, setNotesTeamId] = useState<Id | null>(null)
  // The places the focus is sent to: the two buttons in the header that are always there,
  // and the name field of the table's last row.
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const pasteButtonRef = useRef<HTMLButtonElement>(null)
  const quickAddNameRef = useRef<HTMLInputElement>(null)

  const hasTeams = project.teams.length > 0

  /** "Add team": puts the focus in the last row of the table, where a team is typed in. */
  const startAdding = () => {
    // Without teams the table is not on screen yet. It is rendered right now, so that its
    // last row is there to take the focus.
    flushSync(() => setKeepTable(true))
    quickAddNameRef.current?.focus()
  }

  /** Opens the dialog for pasting teams. The focus goes to the button in the header first:
   *  a dialog hands the focus back to where it was when it closes, and of the two buttons
   *  that open this one, the one in the invitation may be gone by then. */
  const openPaste = () => {
    pasteButtonRef.current?.focus()
    setPasteOpen(true)
  }

  /** "Try with example teams" in the invitation. The invitation goes away with its buttons
   *  once there are teams; the focus moves to the header first, so it is not lost with them. */
  const tryExampleTeams = () => {
    addButtonRef.current?.focus()
    addExampleTeams()
  }

  const moreItems: MenuItem[] = [
    { key: 'examples', label: 'Add example teams', onSelect: addExampleTeams },
    {
      key: 'remove-all',
      label: 'Remove all teams',
      danger: true,
      separated: true,
      disabled: !hasTeams,
      onSelect: () => {
        removeAllTeams()
        setKeepTable(false)
      },
    },
  ]

  return (
    <div className="view view--page teams">
      <div className="view__inner">
        <header className="view__header">
          <div className="teams-heading">
            <h2 className="title">Teams and days</h2>
            <p className="muted teams-intro">
              Enter each team, its size and the days it wants to come in. A filled day is a planned team day.
            </p>
          </div>
          <div className="row row--wrap">
            <button ref={addButtonRef} type="button" className="btn btn--primary" onClick={startAdding}>
              <IconPlus />
              Add team
            </button>
            <button ref={pasteButtonRef} type="button" className="btn" onClick={openPaste}>
              Paste from a spreadsheet
            </button>
            <Menu label="More" items={moreItems}>
              More
              <IconChevronDown />
            </Menu>
          </div>
        </header>

        <Assumptions settings={project.settings} />

        {hasTeams || keepTable ? (
          <>
            <TeamsTable
              project={project}
              quickAddNameRef={quickAddNameRef}
              onOpenNotes={setNotesTeamId}
              onRemoveLast={() => setKeepTable(true)}
            />
            <Legend />
          </>
        ) : (
          <div className="empty teams-empty">
            <h3 className="empty__title">No teams yet</h3>
            <p className="empty__text">
              Add your teams one by one, or paste a list from a spreadsheet with name, size and days.
            </p>
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary" onClick={startAdding}>
                Add team
              </button>
              <button type="button" className="btn" onClick={openPaste}>
                Paste from a spreadsheet
              </button>
              <button type="button" className="btn" onClick={tryExampleTeams}>
                Try with example teams
              </button>
            </div>
          </div>
        )}
      </div>

      <PasteTeamsDialog project={project} open={pasteOpen} onClose={() => setPasteOpen(false)} />
      <TeamNotesDialog team={findTeam(project, notesTeamId) ?? null} onClose={() => setNotesTeamId(null)} />
    </div>
  )
}
