import { describe, it, expect } from 'vitest'
import { imagesFromPaste, imagesFromDrop, dragCarriesImage } from './incomingImages'

const file = (type: string, name = '') => ({ type, name }) as File
const dt = (files: File[], items: Array<{ kind: string; type: string }> = []) =>
  ({ files: files as unknown as FileList, items: items as unknown as DataTransferItemList }) as DataTransfer

describe('imagesFromPaste', () => {
  it('finds a pasted screenshot, which carries no name', () => {
    expect(imagesFromPaste(dt([file('image/png')]))).toEqual([{ file: file('image/png'), mime: 'image/png', name: null }])
  })

  it('returns nothing for a text paste, so typing is never swallowed', () => {
    expect(imagesFromPaste(dt([]))).toEqual([])
    expect(imagesFromPaste(null)).toEqual([])
  })

  it('ignores a PDF — a file the handwriting flow must never claim', () => {
    // Dropping an answer key into a flow whose premise is "your own work"
    // would be worse than doing nothing.
    expect(imagesFromPaste(dt([file('application/pdf', 'solutions.pdf')]))).toEqual([])
  })
})

describe('imagesFromDrop', () => {
  it('keeps OS order, which is the page order for a multi-select drag', () => {
    const found = imagesFromDrop(dt([file('image/jpeg', 'p1.jpg'), file('image/jpeg', 'p2.jpg')]))
    expect(found.map((f) => f.name)).toEqual(['p1.jpg', 'p2.jpg'])
  })

  it('drops non-images out of a mixed selection rather than failing the whole drop', () => {
    const found = imagesFromDrop(dt([file('image/png', 'a.png'), file('text/plain', 'notes.txt')]))
    expect(found.map((f) => f.name)).toEqual(['a.png'])
  })

  it('accepts every type the main-process writer can actually save', () => {
    const types = ['image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp', 'image/gif', 'image/tiff']
    expect(imagesFromDrop(dt(types.map((t) => file(t)))).length).toBe(types.length)
  })
})

describe('dragCarriesImage', () => {
  it('reads items, since files is empty during dragover by design', () => {
    expect(dragCarriesImage(dt([], [{ kind: 'file', type: 'image/png' }]))).toBe(true)
  })

  it('stays quiet for a dragged text selection', () => {
    expect(dragCarriesImage(dt([], [{ kind: 'string', type: 'text/plain' }]))).toBe(false)
    expect(dragCarriesImage(dt([], [{ kind: 'file', type: 'application/pdf' }]))).toBe(false)
    expect(dragCarriesImage(null)).toBe(false)
  })
})
