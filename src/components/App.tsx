import { useMemo, useState } from 'react'
import { useAuth } from '../state/useAuth'
import { useLibrary } from '../state/useLibrary'
import { usePlayer } from '../state/usePlayer'
import { buildFolderTree } from '../state/folderTree'
import { SignInScreen } from './SignInScreen'
import { SettingsPanel } from './SettingsPanel'
import { LibraryBrowser } from './LibraryBrowser'
import { FoldersBrowser } from './FoldersBrowser'
import { QueuePanel } from './QueuePanel'
import { PlayerBar } from './PlayerBar'

export default function App() {
  const auth = useAuth()
  const library = useLibrary()
  const tracksById = useMemo(() => new Map(library.tracks.map((t) => [t.id, t])), [library.tracks])
  const folderTree = useMemo(() => buildFolderTree(library.tracks), [library.tracks])
  const player = usePlayer(tracksById)
  const [showSettings, setShowSettings] = useState(false)
  const [tab, setTab] = useState<'library' | 'folders' | 'queue'>('library')

  // Token requests are never auto-triggered on mount: GIS's requestAccessToken opens a
  // popup, and Chrome silently drops popups not opened from a direct user gesture (no
  // error callback fires — the request just hangs). The only entry points are the
  // explicit "Connect"/"Reconnect" clicks below. See PRD.md section 3.1.
  //
  // True first-run (no root folders ever configured) is the only case that blocks the
  // whole UI — a returning user sees their cached library/queue instantly (PRD.md 2.3/6.3)
  // even before reconnecting, and only needs to reconnect to actually stream audio.
  const isFirstRun = library.roots.length === 0
  if (isFirstRun && auth.status !== 'signed-in') {
    return (
      <SignInScreen
        onSignIn={() => void auth.signIn()}
        isAuthenticating={auth.status === 'authenticating'}
        errorMessage={auth.lastError?.message ?? null}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">swaranidhi</h1>
        <div className="flex items-center gap-3">
          {auth.status !== 'signed-in' && (
            <button
              onClick={() => void auth.signIn()}
              disabled={auth.status === 'authenticating'}
              className="rounded-full bg-emerald-500 px-3 py-1 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {auth.status === 'authenticating' ? 'Connecting…' : 'Reconnect Google Drive'}
            </button>
          )}
          <div className="flex rounded-lg bg-slate-800 p-0.5 text-sm">
            <button
              onClick={() => setTab('library')}
              className={`rounded-md px-3 py-1 ${tab === 'library' ? 'bg-slate-700' : ''}`}
            >
              Library
            </button>
            <button
              onClick={() => setTab('folders')}
              className={`rounded-md px-3 py-1 ${tab === 'folders' ? 'bg-slate-700' : ''}`}
            >
              Folders
            </button>
            <button
              onClick={() => setTab('queue')}
              className={`rounded-md px-3 py-1 ${tab === 'queue' ? 'bg-slate-700' : ''}`}
            >
              Queue
            </button>
          </div>
          <button onClick={() => setShowSettings(true)} className="text-sm text-slate-400 hover:text-slate-200">
            Settings
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'library' && (
          <LibraryBrowser
            tracks={library.tracks}
            currentTrackId={player.session.currentTrackId}
            onPlay={player.playFromLibrary}
            onShuffleAll={player.playShuffled}
          />
        )}
        {tab === 'folders' && (
          <FoldersBrowser
            tree={folderTree}
            tracksById={tracksById}
            currentTrackId={player.session.currentTrackId}
            onPlay={player.playFromLibrary}
            onShuffleFolder={player.playShuffled}
          />
        )}
        {tab === 'queue' && (
          <QueuePanel
            session={player.session}
            effectiveOrder={player.effectiveOrder}
            tracksById={tracksById}
            onReorder={player.reorderQueue}
            onRemove={player.removeFromQueue}
          />
        )}
      </main>

      <PlayerBar
        session={player.session}
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        isLoading={player.isLoading}
        downloadProgress={player.downloadProgress}
        onTogglePlayPause={player.togglePlayPause}
        onNext={player.skipNext}
        onPrevious={player.skipPrevious}
        onSeek={player.seekTo}
        onVolume={player.setVolume}
        onToggleShuffle={player.toggleShuffle}
        onSetRepeat={player.setRepeatMode}
      />

      {showSettings && (
        <SettingsPanel
          roots={library.roots}
          scanStates={library.scanStates}
          onAddRoot={library.addRoot}
          onRescanRoot={library.rescanRoot}
          onRemoveRoot={library.removeRoot}
          error={library.error}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
