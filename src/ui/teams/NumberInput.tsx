import { useEffect, useState, type InputHTMLAttributes } from 'react'

type PassedOn = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'type'>

function parse(text: string): number | null {
  if (text.trim() === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** A whole-number field bound to a stored value.
 *
 *  While someone types in it the text is a draft: "8" on the way to "85" is not a value yet,
 *  and an emptied field does not mean zero. Every draft that is a number within the range is
 *  reported at once. On leaving the field or pressing Enter, a number outside the range is
 *  pulled into it and anything that is not a number gives way to the stored value. */
export function NumberInput(
  props: {
    value: number
    onChange: (value: number) => void
    min: number
    max: number
    step?: number
  } & PassedOn,
) {
  const { value, onChange, min, max, step, onBlur, onKeyDown, ...rest } = props
  const [draft, setDraft] = useState<string | null>(null)

  // When the stored value changes to something else than what is typed (an undo, for
  // example), the field shows the stored value again.
  useEffect(() => {
    setDraft((current) => (current !== null && parse(current) !== value ? null : current))
  }, [value])

  /** Ends the edit. A draft within the range was already reported when it was typed. */
  const settle = () => {
    if (draft === null) return
    const n = parse(draft)
    if (n !== null && (n < min || n > max)) onChange(Math.min(max, Math.max(min, n)))
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const n = parse(text)
        if (n !== null && n >= min && n <= max) onChange(n)
      }}
      onBlur={(event) => {
        settle()
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') settle()
        onKeyDown?.(event)
      }}
    />
  )
}
