// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitWithin, readPlanImage } from './readImage'

describe('fitWithin', () => {
  it('leaves a size that fits as it is', () => {
    expect(fitWithin(2000, 710, 3200)).toEqual({ width: 2000, height: 710 })
    expect(fitWithin(3200, 100, 3200)).toEqual({ width: 3200, height: 100 })
    expect(fitWithin(100, 3200, 3200)).toEqual({ width: 100, height: 3200 })
  })

  it('scales the longer side down to the maximum and keeps the proportions', () => {
    expect(fitWithin(6400, 3200, 3200)).toEqual({ width: 3200, height: 1600 })
    expect(fitWithin(4000, 8000, 3200)).toEqual({ width: 1600, height: 3200 })
    expect(fitWithin(5000, 5000, 3200)).toEqual({ width: 3200, height: 3200 })
  })

  it('gives whole pixels', () => {
    expect(fitWithin(10000, 3333, 3200)).toEqual({ width: 3200, height: 1067 })
  })

  it('never makes a side disappear', () => {
    expect(fitWithin(100000, 1, 3200)).toEqual({ width: 3200, height: 1 })
  })
})

describe('readPlanImage: files it refuses', () => {
  it('says what to do with a PDF', async () => {
    const pdf = new File(['%PDF-1.7'], 'floor-4.pdf', { type: 'application/pdf' })
    await expect(readPlanImage(pdf)).rejects.toThrow('This is a PDF. Export the page as PNG or JPG and add that.')
  })

  it('recognises a PDF by its name when the browser gives no type', async () => {
    const pdf = new File(['%PDF-1.7'], 'Floor 4.PDF', { type: '' })
    await expect(readPlanImage(pdf)).rejects.toThrow('This is a PDF.')
  })

  it('names the image types it takes for anything else', async () => {
    const message = 'Use a PNG, JPG, WebP or SVG image.'
    await expect(readPlanImage(new File(['GIF89a'], 'plan.gif', { type: 'image/gif' }))).rejects.toThrow(message)
    await expect(readPlanImage(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(message)
    await expect(readPlanImage(new File(['?'], 'plan', { type: '' }))).rejects.toThrow(message)
  })

  it('refuses an image above 25 MB', async () => {
    const huge = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'plan.png', { type: 'image/png' })
    await expect(readPlanImage(huge)).rejects.toThrow(
      'This image is larger than 25 MB. Export it smaller and add it again.',
    )
  })
})

/* jsdom decodes no images and has no canvas. For the rest of the way a stand-in image
   reports a size, or fails, as soon as it is given a source. */
describe('readPlanImage: reading', () => {
  let decoded = { width: 0, height: 0 }
  let decodes = true

  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 0
    naturalHeight = 0

    set src(_value: string) {
      queueMicrotask(() => {
        if (!decodes) {
          this.onerror?.()
          return
        }
        this.naturalWidth = decoded.width
        this.naturalHeight = decoded.height
        this.onload?.()
      })
    }
  }

  function withImage(width: number, height: number) {
    decoded = { width, height }
    decodes = true
    vi.stubGlobal('Image', FakeImage)
  }

  /** Stands in for the canvas: records how it was used and encodes to `encoded`. */
  function withCanvas(encoded: string) {
    const drawImage = vi.fn()
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(encoded)
    return { drawImage, getContext, toDataURL }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps a small image as it is, as a data URL with its size', async () => {
    withImage(2000, 710)
    const canvas = withCanvas('data:image/webp;base64,AAAA')
    const plan = await readPlanImage(new File(['png bytes'], 'floor-4.png', { type: 'image/png' }))
    expect(plan.src).toBe(`data:image/png;base64,${btoa('png bytes')}`)
    expect(plan.width).toBe(2000)
    expect(plan.height).toBe(710)
    expect(canvas.getContext).not.toHaveBeenCalled()
  })

  it('goes by the file name when the browser gives no type', async () => {
    withImage(800, 600)
    const plan = await readPlanImage(new File(['jpeg bytes'], 'Floor 4.JPG', { type: '' }))
    expect(plan.src).toBe(`data:image/jpeg;base64,${btoa('jpeg bytes')}`)
  })

  it('keeps an SVG as it is and gives it a sheet when it states no size', async () => {
    withImage(0, 0)
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'plan.svg', { type: '' })
    const plan = await readPlanImage(svg)
    expect(plan.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(plan.width).toBe(2000)
    expect(plan.height).toBe(1000)
  })

  it('uses the size an SVG states', async () => {
    withImage(1200, 400)
    const svg = new File(['<svg width="1200" height="400"/>'], 'plan.svg', { type: 'image/svg+xml' })
    expect(await readPlanImage(svg)).toMatchObject({ width: 1200, height: 400 })
  })

  it('scales an image down whose longer side is above 3200 pixels', async () => {
    withImage(6400, 3200)
    const canvas = withCanvas('data:image/webp;base64,AAAA')
    const plan = await readPlanImage(new File(['png bytes'], 'big.png', { type: 'image/png' }))
    expect(plan).toEqual({ src: 'data:image/webp;base64,AAAA', width: 3200, height: 1600 })
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/webp', 0.9)
    expect(canvas.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 3200, 1600)
  })

  it('takes whatever type the browser encodes to', async () => {
    withImage(6400, 3200)
    withCanvas('data:image/png;base64,BBBB')
    const plan = await readPlanImage(new File(['png bytes'], 'big.png', { type: 'image/png' }))
    expect(plan.src).toBe('data:image/png;base64,BBBB')
  })

  it('encodes a heavy file again at the same size', async () => {
    withImage(3000, 1000)
    withCanvas('data:image/webp;base64,AAAA')
    const heavy = new File([new Uint8Array(2 * 1024 * 1024)], 'scan.jpg', { type: 'image/jpeg' })
    expect(await readPlanImage(heavy)).toEqual({ src: 'data:image/webp;base64,AAAA', width: 3000, height: 1000 })
  })

  it('keeps a heavy file when encoding it again does not make it lighter', async () => {
    withImage(3000, 1000)
    const bytes = 2 * 1024 * 1024
    withCanvas(`data:image/png;base64,${'A'.repeat(bytes * 2)}`)
    const heavy = new File([new Uint8Array(bytes)], 'scan.jpg', { type: 'image/jpeg' })
    const plan = await readPlanImage(heavy)
    expect(plan.src.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(plan).toMatchObject({ width: 3000, height: 1000 })
  })

  it('keeps the original when the browser cannot encode', async () => {
    withImage(6400, 3200)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const plan = await readPlanImage(new File(['png bytes'], 'big.png', { type: 'image/png' }))
    expect(plan).toEqual({ src: `data:image/png;base64,${btoa('png bytes')}`, width: 6400, height: 3200 })
  })

  it('says so when the file is not an image after all', async () => {
    vi.stubGlobal('Image', FakeImage)
    decodes = false
    const broken = new File(['not a png'], 'broken.png', { type: 'image/png' })
    await expect(readPlanImage(broken)).rejects.toThrow(
      'This file could not be read as an image. Export it again as PNG or JPG and add that.',
    )
  })
})
