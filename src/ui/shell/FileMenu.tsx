import { useRef, useState, type ChangeEvent } from 'react'
import { csvSeparatorFor, exportFileName, parseProjectFile, seatingCsv, serializeProject } from '../../domain/files'
import { startingProject } from '../../state/seed'
import { dispatch, getProject, undoAction } from '../../state/store'
import { setUi } from '../../state/ui'
import { IconDownload, IconPrint, IconTable, IconTrash, IconUpload } from '../icons'
import { Dialog, Menu, toast, type MenuItem } from '../primitives'
import { openPrintDialog } from '../print/printState'
import { downloadText } from './download'
import { markAsFile, useUnexportedChanges } from './exportTracking'

const UNEXPORTED = 'Changes since the last exported file'

/** A floor, a team or an area chosen in one plan means nothing in another plan. */
function forgetPlanSelection(): void {
  setUi({ floorId: null, activeTeamId: null, selectedAreaId: null, spotlight: null, focusTeamId: null })
}

/** The File menu: plan files in and out, the seating as CSV, print, and starting over. */
export function FileMenu() {
  const unexported = useUnexportedChanges()
  const fileInput = useRef<HTMLInputElement>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [confirmingStartOver, setConfirmingStartOver] = useState(false)

  const exportPlan = () => {
    const project = getProject()
    const fileName = exportFileName(project, 'json')
    downloadText(fileName, serializeProject(project), 'application/json')
    markAsFile(project)
    toast(`Exported ${fileName}`)
  }

  const exportCsv = () => {
    const project = getProject()
    const fileName = exportFileName(project, 'csv')
    // Semicolons where this computer's spreadsheet expects them (comma as decimal sign).
    downloadText(fileName, seatingCsv(project, csvSeparatorFor()), 'text/csv')
    toast(`Exported ${fileName}`)
  }

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Empty the field, or choosing the same file again would not count as a change.
    input.value = ''
    if (!file) return

    let text: string
    try {
      text = await file.text()
    } catch {
      setOpenError('The file could not be read. Check that it is still there and open it again.')
      return
    }
    const result = parseProjectFile(text)
    if (!result.ok) {
      setOpenError(result.error)
      return
    }
    dispatch({ type: 'project/replace', project: result.project })
    markAsFile(result.project)
    forgetPlanSelection()
    toast(`Opened ${result.project.name.trim() || 'the plan file'}`, undoAction())
  }

  const startOver = () => {
    setConfirmingStartOver(false)
    dispatch({ type: 'project/replace', project: startingProject() })
    forgetPlanSelection()
    toast('Started over', undoAction())
  }

  const items: MenuItem[] = [
    { key: 'export', label: 'Export plan file', icon: <IconDownload />, onSelect: exportPlan },
    { key: 'open', label: 'Open plan file', icon: <IconUpload />, onSelect: () => fileInput.current?.click() },
    { key: 'csv', label: 'Export seating as CSV', icon: <IconTable />, onSelect: exportCsv },
    { key: 'print', label: 'Print', icon: <IconPrint />, onSelect: openPrintDialog },
    {
      key: 'start-over',
      label: 'Start over',
      icon: <IconTrash />,
      onSelect: () => setConfirmingStartOver(true),
      danger: true,
      separated: true,
    },
  ]

  return (
    <>
      <Menu label="File" items={items}>
        {/* The dot is too small to point at, so its explanation shows on the word as well. */}
        <span className="shell-file-label" title={unexported ? UNEXPORTED : undefined}>
          File
          {unexported ? <span className="shell-file-dot" /> : null}
        </span>
      </Menu>
      {/* The button's accessible name is fixed, so say what the dot means next to it. */}
      {unexported ? <span className="visually-hidden">{UNEXPORTED}</span> : null}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Plan file to open"
        hidden
        onChange={(event) => void openFile(event)}
      />

      <Dialog
        open={openError !== null}
        onClose={() => setOpenError(null)}
        title="This file cannot be opened"
        footer={
          <button type="button" className="btn btn--primary" onClick={() => setOpenError(null)}>
            Close
          </button>
        }
      >
        <p>{openError}</p>
      </Dialog>

      <Dialog
        open={confirmingStartOver}
        onClose={() => setConfirmingStartOver(false)}
        title="Start over?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmingStartOver(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" onClick={startOver}>
              Start over
            </button>
          </>
        }
      >
        <p>
          This removes every team and every floor you added and brings back the starting floor. You can undo it.
        </p>
      </Dialog>
    </>
  )
}
