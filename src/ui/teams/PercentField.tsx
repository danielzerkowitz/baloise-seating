import { useId } from 'react'
import { Field } from '../primitives'
import { NumberInput } from './NumberInput'

/** A labelled field for a share that is stored as a fraction (0.8) and typed in percent (80). */
export function PercentField(props: {
  label: string
  hint: string
  /** The stored fraction. */
  share: number
  /** The range, in percent. */
  min: number
  max: number
  onChange: (share: number) => void
}) {
  const unitId = useId()
  return (
    <Field label={props.label} hint={props.hint}>
      {({ id, describedBy }) => (
        <span className="teams-percent">
          <NumberInput
            id={id}
            className="input input--num"
            // The unit is read out after the number, before the hint.
            aria-describedby={describedBy ? `${unitId} ${describedBy}` : unitId}
            min={props.min}
            max={props.max}
            step={5}
            value={Math.round(props.share * 100)}
            onChange={(percent) => props.onChange(percent / 100)}
          />
          <span id={unitId} className="muted">
            %
          </span>
        </span>
      )}
    </Field>
  )
}
