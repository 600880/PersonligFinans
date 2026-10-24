// A picked Receipt is shrunk in the browser before anything is sent, so reading it sends far less.
// 2048×2048 costs the reading nothing, since the LLM scales every image down to fit it anyway, and
// keeps the small print sharp.
const MAX_SIDE = 2048
const JPEG_QUALITY = 0.85

// The reduced Receipt as a JPEG, or ok: false when the browser can't decode the picked file.
export type ReducedReceipt = { ok: true; jpeg: Blob } | { ok: false }

// The size an image of the given size is reduced to: within 2048×2048 with its proportions kept,
// and never enlarged.
export function reducedSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// Decodes the picked file (only the first frame of a GIF), scales it to its reduced size and encodes
// it as JPEG. Even a small JPEG is encoded again, so a Receipt is always the same kind of image and
// the photo's metadata, such as where it was taken, is never sent. Never rejects: whatever goes wrong
// on the way, such as running out of memory, counts as can't decode.
export async function reduceReceipt(file: File): Promise<ReducedReceipt> {
  let image: ImageBitmap
  try {
    // Turned upright as the photo's orientation says, which browsers do by default. Passing the
    // orientation explicitly would fail outright where a browser doesn't know the option.
    image = await createImageBitmap(file)
  } catch {
    return { ok: false }
  }

  const canvas = document.createElement('canvas')
  try {
    const { width, height } = reducedSize(image.width, image.height)
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return { ok: false }
    // A JPEG has no transparency, and a transparent PNG would otherwise come out on black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return jpeg === null ? { ok: false } : { ok: true, jpeg }
  } catch {
    return { ok: false }
  } finally {
    image.close()
    // Frees the canvas's memory now rather than whenever it is collected, which some phones need
    // with several Receipts reduced one after another.
    canvas.width = 0
    canvas.height = 0
  }
}
