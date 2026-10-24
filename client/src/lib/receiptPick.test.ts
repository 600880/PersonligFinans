import { describe, expect, it } from 'vitest'
import { checkReceiptPick } from './receiptPick'

const TEN_MB = 10 * 1024 * 1024
const TWENTY_FIVE_MB = 25 * 1024 * 1024

function image(name: string, type = 'image/jpeg', size = 1024) {
  return new File([new Uint8Array(size)], name, { type })
}

describe('checkReceiptPick', () => {
  it('lets JPEG, PNG, WebP and GIF images go ahead, in pick order', () => {
    const files = [
      image('a.jpg', 'image/jpeg'),
      image('b.png', 'image/png'),
      image('c.webp', 'image/webp'),
      image('d.gif', 'image/gif'),
    ]

    expect(checkReceiptPick(files)).toEqual({ ok: true, receipts: files, leftOut: [] })
  })

  it('leaves out a file of another type, naming it and why', () => {
    const kept = image('kvittering.jpg')
    const pdf = image('kvittering.pdf', 'application/pdf')
    const heic = image('IMG_0042.heic', 'image/heic')

    expect(checkReceiptPick([pdf, kept, heic])).toEqual({
      ok: true,
      receipts: [kept],
      leftOut: [
        { filename: 'kvittering.pdf', message: 'The file is not a JPEG, PNG, WebP or GIF image.' },
        { filename: 'IMG_0042.heic', message: 'The file is not a JPEG, PNG, WebP or GIF image.' },
      ],
    })
  })

  it('leaves out an image larger than 25 MB, but keeps one of exactly 25 MB or between 10 and 25 MB', () => {
    const overTen = image('over-ten.jpg', 'image/jpeg', TEN_MB + 1)
    const atLimit = image('at-limit.jpg', 'image/jpeg', TWENTY_FIVE_MB)
    const tooLarge = image('too-large.png', 'image/png', TWENTY_FIVE_MB + 1)

    expect(checkReceiptPick([overTen, atLimit, tooLarge])).toEqual({
      ok: true,
      receipts: [overTen, atLimit],
      leftOut: [{ filename: 'too-large.png', message: 'The file is larger than 25 MB.' }],
    })
  })

  it('leaves every file out when none is an accepted image', () => {
    expect(checkReceiptPick([image('notes.txt', 'text/plain')])).toEqual({
      ok: true,
      receipts: [],
      leftOut: [{ filename: 'notes.txt', message: 'The file is not a JPEG, PNG, WebP or GIF image.' }],
    })
  })

  it('accepts a pick of 10 files', () => {
    const files = Array.from({ length: 10 }, (_, i) => image(`${i}.jpg`))

    expect(checkReceiptPick(files)).toEqual({ ok: true, receipts: files, leftOut: [] })
  })

  it('rejects a pick of more than 10 files outright, even when some would be left out anyway', () => {
    const files = [...Array.from({ length: 10 }, (_, i) => image(`${i}.jpg`)), image('notes.txt', 'text/plain')]

    expect(checkReceiptPick(files)).toEqual({ ok: false, message: 'Pick at most 10 receipts' })
  })
})
