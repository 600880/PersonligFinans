import { GRANULARITIES, type Granularity } from '../lib/period'

// The "Granularity" dropdown, offering Year, Quarter and Month.
export function GranularitySelect({
  value,
  onChange,
}: {
  value: Granularity
  onChange: (granularity: Granularity) => void
}) {
  return (
    <label className="flex w-fit flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
      Granularity
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Granularity)}
        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal"
      >
        {GRANULARITIES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}
