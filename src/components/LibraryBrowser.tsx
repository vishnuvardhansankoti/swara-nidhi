import type { IndexedDBTrackRecord } from '../types'

interface Props {
  tracks: IndexedDBTrackRecord[]
  currentTrackId: string | null
  onPlay: (trackIds: string[], startTrackId: string) => void
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function LibraryBrowser({ tracks, currentTrackId, onPlay }: Props) {
  const sorted = [...tracks].sort((a, b) => {
    const albumA = a.tags.album ?? a.folderPath.join('/')
    const albumB = b.tags.album ?? b.folderPath.join('/')
    return albumA.localeCompare(albumB) || a.name.localeCompare(b.name)
  })
  const allIds = sorted.map((t) => t.id)

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No tracks indexed yet. Add a Drive folder from Settings to get started.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-slate-800">
      {sorted.map((track) => {
        const isActive = track.id === currentTrackId
        return (
          <li
            key={track.id}
            onClick={() => onPlay(allIds, track.id)}
            className={`flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-800/60 ${
              isActive ? 'bg-slate-800' : ''
            } ${track.availability === 'unavailable' ? 'opacity-40' : ''}`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-slate-700">
              {track.tags.albumArtDataUrl ? (
                <img src={track.tags.albumArtDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">♪</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${isActive ? 'text-emerald-400' : 'text-slate-100'}`}>
                {track.tags.title ?? track.name}
              </p>
              <p className="truncate text-xs text-slate-400">
                {[track.tags.artist, track.tags.album ?? track.folderPath.at(-1)].filter(Boolean).join(' — ')}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{formatDuration(track.tags.durationSeconds)}</span>
          </li>
        )
      })}
    </ul>
  )
}
