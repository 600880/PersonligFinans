// The image types a Receipt can be picked as, which the picker also offers.
export const RECEIPT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const MAX_RECEIPTS = 10
// Large enough for a full-resolution phone photo. The Receipt is reduced before it is sent.
const MAX_FILE_MB = 25
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

// Also why a picked image the browser can't decode is left out.
export const NOT_A_RECEIPT_IMAGE = 'The file is not a JPEG, PNG, WebP or GIF image.'

// A picked file left out of a Receipt scan, named by its filename, with why.
export interface LeftOutReceipt {
  filename: string
  message: string
}

// A pick of more than 10 files is rejected outright. Otherwise the images that can be read go
// ahead in pick order, and the rest are left out before anything is sent.
export type ReceiptPick =
  | { ok: true; receipts: File[]; leftOut: LeftOutReceipt[] }
  | { ok: false; message: string }

// The type is the one the browser gives the file, from its name. The server still checks the bytes.
export function checkReceiptPick(files: File[]): ReceiptPick {
  if (files.length > MAX_RECEIPTS) return { ok: false, message: `Pick at most ${MAX_RECEIPTS} receipts` }

  const receipts: File[] = []
  const leftOut: LeftOutReceipt[] = []
  for (const file of files) {
    if (!RECEIPT_IMAGE_TYPES.includes(file.type)) {
      leftOut.push({ filename: file.name, message: NOT_A_RECEIPT_IMAGE })
    } else if (file.size > MAX_FILE_BYTES) {
      leftOut.push({ filename: file.name, message: `The file is larger than ${MAX_FILE_MB} MB.` })
    } else {
      receipts.push(file)
    }
  }
  return { ok: true, receipts, leftOut }
}
