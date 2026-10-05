import { useState } from 'react'
import type { FolderNode } from '../state/folderTree'
import type { IndexedDBTrackRecord } from '../types'

interface Props {
  tree: FolderNode[]
  tracksById: Map<string, IndexedDBTrackRecord>
  currentTrackId: string | null
  onPlay: (trackIds: string[], startTrackId: string) => void
  onShuffleFolder: (trackIds: string[]) => void
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function FoldersBrowser({ tree, tracksById, currentTrackId, onPlay, onShuffleFolder }: Props) {
  const [path, setPath] = useState<FolderNode[]>([])

  if (tree.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No folders indexed yet. Add a Drive folder from Settings to get started.
      </div>
    )
  }

  const current = path.at(-1) ?? null
  const folders = current ? current.children : tree
  const directTracks = current ? current.trackIds.map((id) => tracksById.get(id)).filter((t) => t != null) : []

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-4 py-2 text-sm">
        <button onClick={() => setPath([])} className="text-slate-400 hover:text-slate-200">
          Folders
        </button>
        {path.map((node, i) => (
          <span key={node.key} className="flex items-center gap-1">
            <span className="text-slate-600">/</span>
            <button
              onClick={() => setPath(path.slice(0, i + 1))}
              className={i === path.length - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-200'}
            >
              {node.name}
            </button>
          </span>
        ))}
      </div>

      <ul className="divide-y divide-slate-800">
        {folders.map((node) => (
          <li
            key={node.key}
            onClick={() => setPath([...path, node])}
            className="group flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-slate-800/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-700 text-lg">
              🗀
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-100">{node.name}</p>
              <p className="text-xs text-slate-400">{node.allTrackIds.length} tracks</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay(node.allTrackIds, node.allTrackIds[0])
                }}
                title="Play"
                className="rounded-full bg-slate-700 px-2 py-1 text-sm hover:bg-slate-600"
              >
                ▶
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onShuffleFolder(node.allTrackIds)
                }}
                title="Shuffle"
                className="rounded-full bg-slate-700 px-2 py-1 text-sm hover:bg-slate-600"
              >
                🔀
              </button>
            </div>
          </li>
        ))}

        {directTracks.map((track) => {
          const isActive = track.id === currentTrackId
          return (
            <li
              key={track.id}
              onClick={() => onPlay(current!.allTrackIds, track.id)}
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
                <p className="truncate text-xs text-slate-400">{track.tags.artist ?? ''}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{formatDuration(track.tags.durationSeconds)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
