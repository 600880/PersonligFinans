import type { Category } from './api'

// Neutral grey, so Uncategorized stands apart from the Categories, which never get it.
const UNCATEGORIZED_COLOUR = '#94a3b8'
// For a Category missing from those loaded.
const FALLBACK_COLOUR = '#475569'

// In Dark, a colour's lightness is moved halfway to this, so the darker palette colours stand out on
// the dark background, and the lighter ones stay lighter than them.
const DARK_LIGHTNESS = 0.85

// The colour of a Category among those loaded, or of Uncategorized when categoryId is null. Shared
// by the Dashboard's donut and Spending trend, so a Category looks the same in both, whichever
// Period or Span is shown, and in Dark is the same lightened version of it in both.
export function categoryColour(categoryId: number | null, categories: Category[], dark: boolean): string {
  const colour =
    categoryId === null
      ? UNCATEGORIZED_COLOUR
      : (categories.find((c) => c.id === categoryId)?.colour ?? FALLBACK_COLOUR)
  return dark ? lightened(colour) : colour
}

// The colour, as #rrggbb, with its OKLCH lightness moved halfway to DARK_LIGHTNESS and its hue and
// chroma kept, so it still looks like itself. A channel pushed out of sRGB is clipped.
function lightened(hex: string): string {
  const [lightness, a, b] = toOklab(hex)
  if (lightness >= DARK_LIGHTNESS) return hex
  return fromOklab((lightness + DARK_LIGHTNESS) / 2, a, b)
}

// From Björn Ottosson's definition of Oklab, https://bottosson.github.io/posts/oklab/.
function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab(lightness: number, a: number, b: number): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const bytes = channels.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255))
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function toLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}
