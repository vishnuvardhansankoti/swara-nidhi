import type { IndexedDBTrackRecord, PlaybackSession, RepeatMode } from '../types'

interface Props {
  session: PlaybackSession
  currentTrack: IndexedDBTrackRecord | null
  isPlaying: boolean
  isLoading: boolean
  downloadProgress: { loaded: number; total: number | null } | null
  onTogglePlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onSeek: (seconds: number) => void
  onVolume: (v: number) => void
  onToggleShuffle: () => void
  onSetRepeat: (mode: RepeatMode) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PlayerBar({
  session,
  currentTrack,
  isPlaying,
  isLoading,
  downloadProgress,
  onTogglePlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolume,
  onToggleShuffle,
  onSetRepeat,
}: Props) {
  const duration = currentTrack?.tags.durationSeconds ?? 0

  return (
    <div className="border-t border-slate-800 bg-slate-900 px-4 py-3">
      {downloadProgress && downloadProgress.total && (
        <div className="mb-2 h-1 w-full overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, (downloadProgress.loaded / downloadProgress.total) * 100)}%` }}
          />
        </div>
      )}

      <div className="flex items-center gap-4">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-slate-700">
          {currentTrack?.tags.albumArtDataUrl && (
            <img src={currentTrack.tags.albumArtDataUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {currentTrack ? currentTrack.tags.title ?? currentTrack.name : 'Nothing playing'}
          </p>
          <p className="truncate text-xs text-slate-400">{currentTrack?.tags.artist ?? ''}</p>

          <div className="mt-1 flex items-center gap-2">
            <span className="w-9 text-right text-[10px] text-slate-500">{formatTime(session.positionSeconds)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={session.positionSeconds}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="h-1 flex-1 accent-emerald-500"
            />
            <span className="w-9 text-[10px] text-slate-500">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={onToggleShuffle}
            className={`text-lg ${session.shuffle ? 'text-emerald-400' : 'text-slate-500'}`}
            title="Shuffle"
          >
            🔀
          </button>
          <button onClick={onPrevious} className="text-xl text-slate-200" title="Previous">⏮</button>
          <button
            onClick={onTogglePlayPause}
            disabled={isLoading}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-slate-950 disabled:opacity-50"
          >
            {isLoading ? '…' : isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={onNext} className="text-xl text-slate-200" title="Next">⏭</button>
          <button
            onClick={() => onSetRepeat(session.repeatMode === 'off' ? 'all' : session.repeatMode === 'all' ? 'one' : 'off')}
            className={`text-lg ${session.repeatMode !== 'off' ? 'text-emerald-400' : 'text-slate-500'}`}
            title={`Repeat: ${session.repeatMode}`}
          >
            {session.repeatMode === 'one' ? '🔂' : '🔁'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={session.volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-1 w-20 accent-emerald-500"
          />
        </div>
      </div>
    </div>
  )
}
