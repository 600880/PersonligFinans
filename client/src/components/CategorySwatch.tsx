// A dot in a Category's colour, as categoryColour gives it, so it matches the Dashboard in Light and
// Dark. Named for screen readers, since the colour is all it shows. Without a name it is hidden from
// them instead, for where something beside it already names the Category.
export function CategorySwatch({ colour, name }: { colour: string; name?: string }) {
  return (
    <span
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${name} colour` })}
      className="inline-block size-3 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/10"
      style={{ backgroundColor: colour }}
    />
  )
}
