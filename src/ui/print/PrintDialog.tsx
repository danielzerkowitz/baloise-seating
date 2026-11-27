import { useState } from 'react'
import { WEEKDAYS, WEEKDAY_NAME } from '../../domain/types'
import { useProject } from '../../state/store'
import { IconPrint } from '../icons'
import { Dialog } from '../primitives'
import { closePrintDialog, defaultPrintJob, pageCount, setPrintJob, usePrintState, type PrintJob } from './printState'
import './print.css'

/** How long printing waits for plan images before it goes ahead without them. */
const IMAGE_PATIENCE_MS = 3000

function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((each) => each !== item) : [...list, item]
}

/** Why the "Print" button is off, and what turns it on. */
function nothingToPrint(job: PrintJob, floorCount: number): string {
  if (floorCount === 0) return 'There is no floor to print. Choose the week overview.'
  if (job.days.length === 0) return 'Nothing to print. Choose a day or the week overview.'
  return 'Nothing to print. Choose a floor or the week overview.'
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** Resolves when every plan in the print root is ready to be drawn. The plan of a floor
 *  that was not on screen yet still has to be decoded, and a page printed before that comes
 *  out without its drawing. */
function plansReady(): Promise<void> {
  const images = [...document.querySelectorAll<HTMLImageElement>('.print-root img')]
  const decoded = images.map((image) =>
    // A plan that cannot be decoded must not hold up the rest.
    typeof image.decode === 'function' ? image.decode().catch(() => undefined) : undefined,
  )
  return new Promise((resolve) => {
    const giveUp = window.setTimeout(resolve, IMAGE_PATIENCE_MS)
    void Promise.all(decoded).then(() => {
      window.clearTimeout(giveUp)
      resolve()
    })
  })
}

/** Puts the job on the print pages and opens the browser's print dialog. */
async function sendToPrinter(job: PrintJob): Promise<void> {
  setPrintJob(job)
  // Two frames: one for the pages to be rendered, one for the browser to lay them out.
  await nextFrame()
  await nextFrame()
  await plansReady()
  window.print()
}

/** Choose what goes to paper: which days, which floors, and the week overview. */
export function PrintDialog() {
  const { dialogOpen } = usePrintState()
  const project = useProject()
  // Null until the planner changes something: the usual selection then follows the plan.
  const [chosen, setChosen] = useState<PrintJob | null>(null)
  const job = chosen ?? defaultPrintJob(project)
  const pages = pageCount(job)
  const change = (patch: Partial<PrintJob>) => setChosen({ ...job, ...patch })

  const close = () => {
    closePrintDialog()
    // The next time the dialog opens, it starts from the usual selection again.
    setChosen(null)
  }

  return (
    <Dialog
      open={dialogOpen}
      onClose={close}
      title="Print the plan"
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={pages === 0}
            onClick={() => {
              void sendToPrinter(job)
              close()
            }}
          >
            <IconPrint />
            Print
          </button>
        </>
      }
    >
      <div className="print-options">
        <fieldset className="print-group">
          <legend className="print-legend">Days</legend>
          <div className="print-checks">
            {WEEKDAYS.map((day) => (
              <label key={day} className="print-check">
                <input
                  type="checkbox"
                  className="print-box"
                  checked={job.days.includes(day)}
                  onChange={() => change({ days: toggled(job.days, day) })}
                />
                {WEEKDAY_NAME[day]}
              </label>
            ))}
          </div>
        </fieldset>

        {project.floors.length > 1 ? (
          <fieldset className="print-group">
            <legend className="print-legend">Floors</legend>
            <div className="print-checks">
              {[...project.floors].reverse().map((floor) => (
                <label key={floor.id} className="print-check">
                  <input
                    type="checkbox"
                    className="print-box"
                    checked={job.floorIds.includes(floor.id)}
                    onChange={() => change({ floorIds: toggled(job.floorIds, floor.id) })}
                  />
                  {floor.name.trim() || `Floor ${floor.label}`}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <label className="print-check">
          <input
            type="checkbox"
            className="print-box"
            checked={job.week}
            onChange={() => change({ week: !job.week })}
          />
          Include the week overview
        </label>

        <p className="print-paper" aria-live="polite">
          {pages === 0 ? (
            nothingToPrint(job, project.floors.length)
          ) : (
            <>
              <span className="sign print-count">{pages}</span> {pages === 1 ? 'page' : 'pages'}, landscape
            </>
          )}
        </p>
      </div>
    </Dialog>
  )
}
