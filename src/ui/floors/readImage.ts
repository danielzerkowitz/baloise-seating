import type { PlanImage } from '../../domain/types'

/* Turning a file the planner picked into the plan image of a floor: checked, measured and,
   when it is heavier than a floor plan needs to be, scaled down. The image is kept inside
   the project as a data URL, so its size is paid again in every save and every exported
   file. */

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'

const TYPE_BY_EXTENSION: Record<string, ImageType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const IMAGE_TYPES: ReadonlySet<string> = new Set(Object.values(TYPE_BY_EXTENSION))

/** For the `accept` attribute of a file input. */
export const PLAN_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

const MAX_FILE_BYTES = 25 * 1024 * 1024
/** A file heavier than this is encoded again, even when its pixel size is fine. */
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024
/** The longer side of a stored plan in pixels: enough to read desk outlines at full zoom. */
const MAX_SIDE = 3200
/** An SVG that states no size of its own is drawn on a sheet of these proportions. */
const SVG_FALLBACK_SIZE = { width: 2000, height: 1000 }

const UNREADABLE = 'This file could not be read as an image. Export it again as PNG or JPG and add that.'

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

function isImageType(type: string): type is ImageType {
  return IMAGE_TYPES.has(type)
}

/** The image type of a file, or null when a plan cannot be made of it. Browsers leave
 *  `type` empty for extensions the operating system does not know; the file name decides
 *  then. */
function imageTypeOf(file: File): ImageType | null {
  const declared = file.type.toLowerCase()
  if (isImageType(declared)) return declared
  if (declared !== '') return null
  return TYPE_BY_EXTENSION[extensionOf(file.name)] ?? null
}

function isPdf(file: File): boolean {
  const declared = file.type.toLowerCase()
  return declared === 'application/pdf' || (declared === '' && extensionOf(file.name) === 'pdf')
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(UNREADABLE))
    }
    reader.onerror = () => reject(new Error(UNREADABLE))
    reader.readAsDataURL(file)
  })
}

/** `readAsDataURL` labels the data with the file's own type. Where that was empty the
 *  label is useless, and an SVG is only drawn when it is labelled as one. */
function labelledAs(dataUrl: string, type: ImageType): string {
  const comma = dataUrl.indexOf(',')
  return comma < 0 ? dataUrl : `data:${type};base64,${dataUrl.slice(comma + 1)}`
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(UNREADABLE))
    image.src = src
  })
}

/** The size that fits a longer side of `max` while keeping the proportions, in whole
 *  pixels. A size that already fits comes back unchanged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (!(longer > max)) return { width, height }
  const scale = max / longer
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The image drawn at a new size and encoded again, or null when this browser cannot do
 *  that (no canvas, or a canvas too large for its memory). */
function reencode(image: HTMLImageElement, size: { width: number; height: number }): PlanImage | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, size.width, size.height)
    // WebP keeps line drawings sharp at a fraction of the size. A browser that cannot
    // write WebP answers with a PNG instead, which is used as it comes.
    const src = canvas.toDataURL('image/webp', 0.9)
    return src.startsWith('data:image/') ? { src, ...size } : null
  } catch {
    return null
  }
}

/** Reads a PNG, JPEG, WebP or SVG file as the plan image of a floor. Rejects with an
 *  `Error` whose message can be shown to the planner as it is. */
export async function readPlanImage(file: File): Promise<PlanImage> {
  if (isPdf(file)) throw new Error('This is a PDF. Export the page as PNG or JPG and add that.')
  const type = imageTypeOf(file)
  if (!type) throw new Error('Use a PNG, JPG, WebP or SVG image.')
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This image is larger than 25 MB. Export it smaller and add it again.')
  }

  const read = await readAsDataUrl(file)
  const src = file.type.toLowerCase() === type ? read : labelledAs(read, type)
  const image = await decode(src)
  const width = image.naturalWidth
  const height = image.naturalHeight

  if (type === 'image/svg+xml') {
    // A drawing made of lines has no pixels to save on; it is kept as it is. One that
    // states no size reports zero, and then only the sheet's proportions have to be chosen.
    return width > 0 && height > 0 ? { src, width, height } : { src, ...SVG_FALLBACK_SIZE }
  }
  if (!(width > 0 && height > 0)) throw new Error(UNREADABLE)

  const fits = Math.max(width, height) <= MAX_SIDE
  if (fits && file.size <= REENCODE_ABOVE_BYTES) return { src, width, height }

  const lighter = reencode(image, fitWithin(width, height, MAX_SIDE))
  // The original stays when the browser could not encode it again, and when encoding it
  // again at the same pixel size made it no lighter (a browser that answered with PNG).
  if (!lighter || (fits && lighter.src.length >= src.length)) return { src, width, height }
  return lighter
}
