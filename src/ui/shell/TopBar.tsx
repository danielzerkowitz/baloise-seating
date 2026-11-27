import { useEffect, useRef, useState } from 'react'
import {
  dispatch,
  keepMyPlan,
  loadLatestPlan,
  redo,
  savedIn,
  undo,
  useHistory,
  useProject,
  useSaveStatus,
} from '../../state/store'
import { setUi, useUi, type View } from '../../state/ui'
import { IconRedo, IconUndo, IconWarning } from '../icons'
import { Segmented, toast } from '../primitives'
import { FileMenu } from './FileMenu'
import { StatusSummary } from './StatusSummary'
import './shell.css'

const VIEWS: { value: View; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'teams', label: 'Teams and days' },
  { value: 'floors', label: 'Floors' },
]

const ON_MAC = typeof navigator !== 'undefined' && /Mac/.test(`${navigator.platform} ${navigator.userAgent}`)
/** The key that goes with Z for undo, as it is written on the keyboard. */
const MODIFIER = ON_MAC ? 'Cmd' : 'Ctrl'
const MODIFIER_KEY = ON_MAC ? 'Meta' : 'Control'

const NOT_SAVED_HELP: Record<typeof savedIn, string> = {
  browser: 'This browser does not allow storing the plan. Export a plan file to keep your work.',
  database:
    'The database cannot be reached. Your changes stay in this window and are saved once it is back. Keep the window open, or export a plan file.',
}

const CONFLICT_HELP =
  'Someone else saved the plan since you opened it. Load theirs (your latest changes are dropped) or keep yours (theirs are overwritten).'

/** After a conflict: take theirs or keep mine. */
function ConflictChoice() {
  const [busy, setBusy] = useState(false)
  const choose = (pick: () => Promise<void>) => {
    setBusy(true)
    void pick().finally(() => setBusy(false))
  }
  return (
    <span className="shell-conflict">
      <span className="badge badge--error" title={CONFLICT_HELP}>
        <IconWarning />
        Changed elsewhere
        <span className="visually-hidden">. {CONFLICT_HELP}</span>
      </span>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => choose(loadLatestPlan)}>
        Load theirs
      </button>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => choose(keepMyPlan)}>
        Keep mine
      </button>
    </span>
  )
}

/** Says whether the plan is kept, and where. */
function SaveStatus() {
  const status = useSaveStatus()
  const help = NOT_SAVED_HELP[savedIn]
  /* Once storing has failed, say so until a save succeeds: every further edit tries again,
     and showing "Saving" in between would look as if it worked. */
  const [failed, setFailed] = useState(status === 'failed')
  const explained = useRef(false)

  useEffect(() => {
    if (status === 'saved') {
      setFailed(false)
      explained.current = false
    } else if (status === 'failed') {
      setFailed(true)
      // The badge explains itself only on hover, so say it once in full as well.
      if (!explained.current) toast(help)
      explained.current = true
    } else if (status === 'conflict') {
      toast(CONFLICT_HELP)
    }
  }, [status, help])

  if (status === 'conflict') return <ConflictChoice />
  if (failed) {
    return (
      <span className="badge badge--warning" title={help}>
        <IconWarning />
        Not saved
        <span className="visually-hidden">. {help}</span>
      </span>
    )
  }
  if (status === 'loading' || status === 'unreachable') return null
  const saved = savedIn === 'database' ? 'Saved online' : 'Saved in this browser'
  return <span className="shell-save-text small muted">{status === 'saving' ? 'Saving' : saved}</span>
}

/** The bar on top: which plan this is, the three views, how the plan stands, undo and redo,
 *  and the File menu. */
export function TopBar() {
  const project = useProject()
  const ui = useUi()
  const history = useHistory()

  return (
    <header className="shell-bar">
      {/* Everything but the File menu scrolls sideways when the window is narrow. The menu
          stays outside, or the scrolling box would cut off its list. */}
      <div className="shell-scroll">
        <div className="shell-start">
          <h1 className="shell-product">Team day planner</h1>
          <input
            className="shell-plan-name"
            aria-label="Plan name"
            placeholder="Plan name"
            value={project.name}
            maxLength={80}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => dispatch({ type: 'project/rename', name: e.target.value }, { coalesce: 'plan-name' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </div>

        <Segmented label="View" options={VIEWS} value={ui.view} onChange={(view) => setUi({ view })} />

        <div className="shell-end">
          <StatusSummary />
          <div className="shell-history">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Undo"
              aria-keyshortcuts={`${MODIFIER_KEY}+Z`}
              title={`Undo (${MODIFIER}+Z)`}
              disabled={!history.canUndo}
              onClick={undo}
            >
              <IconUndo />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Redo"
              aria-keyshortcuts={`${MODIFIER_KEY}+Shift+Z`}
              title={`Redo (${MODIFIER}+Shift+Z)`}
              disabled={!history.canRedo}
              onClick={redo}
            >
              <IconRedo />
            </button>
          </div>
          <SaveStatus />
        </div>
      </div>

      <div className="shell-file">
        <FileMenu />
      </div>
    </header>
  )
}
