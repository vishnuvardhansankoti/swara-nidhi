interface Props {
  onSignIn: () => void
  isAuthenticating: boolean
  errorMessage: string | null
}

export function SignInScreen({ onSignIn, isAuthenticating, errorMessage }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">swaranidhi</h1>
      <p className="max-w-sm text-sm text-slate-400">
        Stream your own music library straight from Google Drive. Nothing is uploaded anywhere else —
        your access token and library index stay in this browser.
      </p>
      <button
        onClick={onSignIn}
        disabled={isAuthenticating}
        className="rounded-full bg-emerald-500 px-6 py-3 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {isAuthenticating ? 'Connecting…' : 'Connect Google Drive'}
      </button>
      {errorMessage && <p className="max-w-sm text-sm text-red-400">{errorMessage}</p>}
    </div>
  )
}
