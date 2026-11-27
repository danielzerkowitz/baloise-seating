import { useState, type InputHTMLAttributes } from 'react'

const notBlank = (text: string) => text.trim() !== ''

/** A field for a value that lives in the project. Every edit that `accepts` lets through
 *  is passed on at once, so the plan follows the typing and the field always shows what is
 *  stored. Text that cannot be stored (an emptied name, half a number) is only held here
 *  while the planner is typing, and is dropped when the field is left. */
export function DraftInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'> & {
    /** The stored value. */
    value: string
    onChange: (text: string) => void
    /** Which texts may be stored. Default: anything but blank. */
    accepts?: (text: string) => boolean
  },
) {
  const { value, onChange, accepts = notBlank, ...rest } = props
  const [rejected, setRejected] = useState<string | null>(null)

  return (
    <input
      {...rest}
      value={rejected ?? value}
      onChange={(e) => {
        const text = e.target.value
        if (accepts(text)) {
          setRejected(null)
          onChange(text)
        } else {
          setRejected(text)
        }
      }}
      onBlur={() => {
        setRejected(null)
        // Spaces around a name are typing leftovers, not part of it.
        const trimmed = value.trim()
        if (trimmed !== value && accepts(trimmed)) onChange(trimmed)
      }}
    />
  )
}
