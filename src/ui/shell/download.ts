/* The browser only starts reading the file after the click has been handled, so the
   address it reads from has to live a little longer than this function. */
const RELEASE_AFTER_MS = 10_000

/** Hands a text to the browser as a file to download. */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS)
}
