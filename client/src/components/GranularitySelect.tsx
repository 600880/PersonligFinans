import { GRANULARITIES, type Granularity } from '../lib/period'
import { fieldLabelClass, fieldSelectClass } from './panel'

// The "Granularity" dropdown, offering Year, Quarter and Month.
export function GranularitySelect({
  value,
  onChange,
}: {
  value: Granularity
  onChange: (granularity: Granularity) => void
}) {
  return (
    <label className={fieldLabelClass}>
      Granularity
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Granularity)}
        className={fieldSelectClass}
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
