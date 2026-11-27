import { useEffect } from 'react'
import { projectStore, savedIn, startPersistence, useSaveStatus } from './state/store'
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
          <p className="empty__text">
            {savedIn === 'database'
              ? 'The database with the plan cannot be reached. Check the connection and try again.'
              : 'The plan saved in this browser cannot be read.'}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => void startPersistence()}>
            Try again
          </button>
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
