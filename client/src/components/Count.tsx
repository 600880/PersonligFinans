import { formatCount, plural } from '../lib/count'

// A count with what it counts beside it. The noun is shown on a phone, where the column headers are
// hidden, and read out everywhere.
export function Count({ count, noun }: { count: number; noun: string }) {
  return (
    <>
      {formatCount(count)}{' '}
      <span className="text-slate-500 dark:text-slate-400 sm:sr-only">{plural(count, noun)}</span>
    </>
  )
}
