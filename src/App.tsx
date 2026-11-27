import { useEffect } from 'react'
import { projectStore, savedIn, startNewPlanInBrowser, startPersistence, useSaveStatus } from './state/store'
import { useUi } from './state/ui'
import { FloorsView } from './ui/floors/FloorsView'
import { PlanView } from './ui/plan/PlanView'
import { PrintDialog } from './ui/print/PrintDialog'
import { PrintRoot } from './ui/print/PrintRoot'
import { refreshToasts, ToastRegion } from './ui/primitives'
import { TopBar } from './ui/shell/TopBar'
import { useConflictAlerts } from './ui/shell/useConflictAlerts'
import { useShortcuts } from './ui/shell/useShortcuts'
import { TeamsView } from './ui/teams/TeamsView'

export function App() {
  const status = useSaveStatus()
  const ui = useUi()
  useShortcuts()
  useConflictAlerts()
  // An Undo offered in a toast goes away once the change it would undo is no longer there.
  useEffect(() => projectStore.subscribe(refreshToasts), [])

  if (status === 'loading') {
    return (
      <div className="app app--loading" aria-busy="true">
        Opening your plan
      </div>
    )
  }

  if (status === 'unreachable') {
    return (
      <div className="app app--loading" role="alert">
        <div className="empty">
          <h1 className="empty__title">Could not open the plan</h1>
          {savedIn === 'database' ? (
            <>
              <p className="empty__text">
                The database with the plan cannot be reached, or the plan was saved by a newer
                version of the planner. Check the connection and reload.
              </p>
              {/* A reload also fetches the newest version of the planner. */}
              <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </>
          ) : (
            <>
              <p className="empty__text">
                The plan saved in this browser cannot be read. It may have been saved by a newer
                version of the planner. Starting a new plan keeps the old one aside in this
                browser; it is not deleted.
              </p>
              <div className="row">
                <button type="button" className="btn" onClick={() => void startPersistence()}>
                  Try again
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void startNewPlanInBrowser().catch((error: unknown) => console.warn(error))}
                >
                  Start a new plan
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="app">
        <TopBar />
        <main className="app__main">
          {ui.view === 'plan' ? <PlanView /> : null}
          {ui.view === 'teams' ? <TeamsView /> : null}
          {ui.view === 'floors' ? <FloorsView /> : null}
        </main>
        <ToastRegion />
        <PrintDialog />
      </div>
      <PrintRoot />
    </>
  )
}
