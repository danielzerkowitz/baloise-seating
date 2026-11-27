import { useRef, useState } from 'react'
import type { PlanImage } from '../../domain/types'
import { readPlanImage } from './readImage'

/** Reads plan images for a form: `read(file)` starts, `busy` is true until the image is
 *  there, `error` holds what was wrong with the last file, in words for the planner. When
 *  a second file is picked while the first is still being read, only the second counts. */
export function usePlanImageReader(onRead: (image: PlanImage) => void): {
  busy: boolean
  error: string | null
  read: (file: File) => void
  /** Forgets the last problem and whatever is still being read. */
  reset: () => void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Counts the reads that were started; a result only counts while its number is the last.
  const latest = useRef(0)

  const read = (file: File) => {
    latest.current += 1
    const ticket = latest.current
    setBusy(true)
    setError(null)
    readPlanImage(file).then(
      (image) => {
        if (ticket !== latest.current) return
        setBusy(false)
        onRead(image)
      },
      (problem: unknown) => {
        if (ticket !== latest.current) return
        setBusy(false)
        setError(problem instanceof Error ? problem.message : 'This file could not be read.')
      },
    )
  }

  const reset = () => {
    latest.current += 1
    setBusy(false)
    setError(null)
  }

  return { busy, error, read, reset }
}
