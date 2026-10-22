import { useState } from 'react'
import { signOut, type User } from '../lib/api'
import { DeleteDataSection } from './DeleteDataSection'
import { ErrorMessage } from './Messages'

interface UserPageProps {
  user: User
  // Called once the server has signed the User out.
  onSignedOut: () => void
  // Whether an Upload is in progress, during which nothing can be deleted.
  isUploading: boolean
  // Called after each delete of the User's data.
  onDataDeleted: () => void
}

// Who is signed in, the email or the Guest, with Sign out next to it, and below it the deletes.
export function UserPage({ user, onSignedOut, isUploading, onDataDeleted }: UserPageProps) {
  const [signOutFailed, setSignOutFailed] = useState(false)

  // Stays signed in, saying so, when the server couldn't be told.
  async function handleSignOut() {
    setSignOutFailed(false)
    if (await signOut()) onSignedOut()
    else setSignOutFailed(true)
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900">User</h2>

      {/* Sign out stays beside the email at any width; a long email breaks across lines instead. */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="min-w-0 text-sm break-all text-slate-600">
          Signed in as <span className="font-medium text-slate-900">{user.isGuest ? 'Guest' : user.email}</span>
        </p>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
      {signOutFailed && <ErrorMessage className="mt-3">Signing out failed. Try again.</ErrorMessage>}

      <DeleteDataSection isUploading={isUploading} onDeleted={onDataDeleted} />
    </section>
  )
}
