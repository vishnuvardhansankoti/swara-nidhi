import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTrackBlob, PrefetchManager } from '../playback/streamingEngine'
import { blobUrlManager } from '../playback/blobUrlManager'
import { loadPlaybackSession, emptyPlaybackSession, PlaybackSessionWriter } from '../playback/playbackSession'
import { setMediaSessionHandlers, updateMediaSessionMetadata, setMediaSessionPlaybackState } from '../playback/mediaSession'
import type { IndexedDBTrackRecord, PlaybackSession, RepeatMode } from '../types'

function shuffleOrder(trackIds: string[]): string[] {
  const arr = [...trackIds]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export interface PlayerState {
  session: PlaybackSession
  currentTrack: IndexedDBTrackRecord | null
  isPlaying: boolean
  isLoading: boolean
  downloadProgress: { loaded: number; total: number | null } | null
  error: string | null
  effectiveOrder: string[]
  playFromLibrary: (trackIds: string[], startTrackId: string) => void
  playShuffled: (trackIds: string[]) => void
  togglePlayPause: () => void
  skipNext: () => void
  skipPrevious: () => void
  seekTo: (seconds: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  setRepeatMode: (mode: RepeatMode) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  removeFromQueue: (trackId: string) => void
}

export function usePlayer(tracksById: Map<string, IndexedDBTrackRecord>): PlayerState {
  const [session, setSession] = useState<PlaybackSession>(() => loadPlaybackSession() ?? emptyPlaybackSession())
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ loaded: number; total: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(new Audio())
  const prefetchRef = useRef(new PrefetchManager())
  const writerRef = useRef(new PlaybackSessionWriter())
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const effectiveOrder = useMemo(
    () => session.shuffledOrder ?? session.queue.map((e) => e.trackId),
    [session.shuffledOrder, session.queue],
  )

  const currentTrack = session.currentTrackId ? tracksById.get(session.currentTrackId) ?? null : null

  const updateSession = useCallback((patch: Partial<PlaybackSession>, immediate = false) => {
    setSession((prev) => {
      const next = { ...prev, ...patch }
      if (immediate) writerRef.current.writeImmediate(next)
      else writerRef.current.writeThrottled(next)
      return next
    })
  }, [])

  const loadAndPlay = useCallback(
    async (track: IndexedDBTrackRecord, resumePositionSeconds: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      prefetchRef.current.cancelIfNotMatching(track.id)

      setIsLoading(true)
      setDownloadProgress(null)
      setError(null)

      try {
        const prefetched = prefetchRef.current.take(track.id)
        const blob =
          prefetched ??
          (await fetchTrackBlob(track, controller.signal, (loaded, total) =>
            setDownloadProgress({ loaded, total }),
          ))
        if (controller.signal.aborted) return

        const url = blobUrlManager.create(track.id, blob)
        const audio = audioRef.current
        audio.src = url
        audio.volume = sessionRef.current.volume

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => {
            audio.currentTime = resumePositionSeconds
            resolve()
          }
          audio.addEventListener('loadedmetadata', onLoaded, { once: true })
          audio.addEventListener('error', () => reject(new Error('Audio decode error')), { once: true })
        })

        await audio.play()
        blobUrlManager.confirmActive()
        setIsPlaying(true)
        updateMediaSessionMetadata(track)
        setMediaSessionPlaybackState('playing')

        const order = sessionRef.current.shuffledOrder ?? sessionRef.current.queue.map((e) => e.trackId)
        const idx = order.indexOf(track.id)
        const nextId = idx >= 0 ? order[idx + 1] : undefined
        const nextTrack = nextId ? tracksById.get(nextId) ?? null : null
        if (nextTrack) prefetchRef.current.maybePrefetch(track, nextTrack)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
          setIsPlaying(false)
        }
      } finally {
        setIsLoading(false)
      }
    },
    [tracksById],
  )

  const playFromLibrary = useCallback(
    (trackIds: string[], startTrackId: string) => {
      const queue = trackIds.map((trackId, queuePosition) => ({ trackId, queuePosition }))
      const shuffledOrder = sessionRef.current.shuffle ? shuffleOrder(trackIds) : null
      updateSession({ queue, shuffledOrder, currentTrackId: startTrackId, positionSeconds: 0 }, true)
      const track = tracksById.get(startTrackId)
      if (track) void loadAndPlay(track, 0)
    },
    [loadAndPlay, tracksById, updateSession],
  )

  /** "Shuffle All" entry points (global library, or a single folder's recursive track list) —
   * forces shuffle on immediately, independent of whatever the current toggle state was. */
  const playShuffled = useCallback(
    (trackIds: string[]) => {
      if (trackIds.length === 0) return
      const queue = trackIds.map((trackId, queuePosition) => ({ trackId, queuePosition }))
      const order = shuffleOrder(trackIds)
      updateSession({ queue, shuffledOrder: order, shuffle: true, currentTrackId: order[0], positionSeconds: 0 }, true)
      const track = tracksById.get(order[0])
      if (track) void loadAndPlay(track, 0)
    },
    [loadAndPlay, tracksById, updateSession],
  )

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!currentTrack) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      setMediaSessionPlaybackState('paused')
      updateSession({ positionSeconds: audio.currentTime }, true)
    } else if (audio.src) {
      void audio.play().then(() => {
        setIsPlaying(true)
        setMediaSessionPlaybackState('playing')
      })
    } else {
      void loadAndPlay(currentTrack, session.positionSeconds)
    }
  }, [currentTrack, isPlaying, loadAndPlay, session.positionSeconds, updateSession])

  const skipBy = useCallback(
    (direction: 1 | -1) => {
      const order = effectiveOrder
      const idx = session.currentTrackId ? order.indexOf(session.currentTrackId) : -1
      let nextIdx = idx + direction
      if (nextIdx >= order.length) nextIdx = session.repeatMode === 'all' ? 0 : -1
      if (nextIdx < 0 && direction === -1) nextIdx = 0
      if (nextIdx < 0) {
        audioRef.current.pause()
        setIsPlaying(false)
        return
      }
      const nextId = order[nextIdx]
      const track = tracksById.get(nextId)
      updateSession({ currentTrackId: nextId, positionSeconds: 0 }, true)
      if (track) void loadAndPlay(track, 0)
    },
    [effectiveOrder, loadAndPlay, session.currentTrackId, session.repeatMode, tracksById, updateSession],
  )

  const skipNext = useCallback(() => skipBy(1), [skipBy])
  const skipPrevious = useCallback(() => skipBy(-1), [skipBy])

  const seekTo = useCallback(
    (seconds: number) => {
      audioRef.current.currentTime = seconds
      updateSession({ positionSeconds: seconds }, true)
    },
    [updateSession],
  )

  const setVolume = useCallback(
    (v: number) => {
      audioRef.current.volume = v
      updateSession({ volume: v }, true)
    },
    [updateSession],
  )

  const toggleShuffle = useCallback(() => {
    setSession((prev) => {
      const shuffle = !prev.shuffle
      const shuffledOrder = shuffle ? shuffleOrder(prev.queue.map((e) => e.trackId)) : null
      const next = { ...prev, shuffle, shuffledOrder }
      writerRef.current.writeImmediate(next)
      return next
    })
  }, [])

  const setRepeatMode = useCallback(
    (mode: RepeatMode) => updateSession({ repeatMode: mode }, true),
    [updateSession],
  )

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSession((prev) => {
        const queue = [...prev.queue]
        const [moved] = queue.splice(fromIndex, 1)
        queue.splice(toIndex, 0, moved)
        const renumbered = queue.map((e, i) => ({ ...e, queuePosition: i }))
        const next = { ...prev, queue: renumbered }
        writerRef.current.writeImmediate(next)
        return next
      })
    },
    [],
  )

  const removeFromQueue = useCallback((trackId: string) => {
    setSession((prev) => {
      const queue = prev.queue.filter((e) => e.trackId !== trackId)
      const shuffledOrder = prev.shuffledOrder ? prev.shuffledOrder.filter((id) => id !== trackId) : null
      const next = { ...prev, queue, shuffledOrder }
      writerRef.current.writeImmediate(next)
      return next
    })
  }, [])

  // Auto-advance on track end; handle repeat-one.
  useEffect(() => {
    const audio = audioRef.current
    const onEnded = () => {
      if (sessionRef.current.repeatMode === 'one' && currentTrack) {
        void loadAndPlay(currentTrack, 0)
      } else {
        skipNext()
      }
    }
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [currentTrack, loadAndPlay, skipNext])

  // Throttled position persistence during playback.
  useEffect(() => {
    const audio = audioRef.current
    const onTimeUpdate = () => updateSession({ positionSeconds: audio.currentTime })
    audio.addEventListener('timeupdate', onTimeUpdate)
    return () => audio.removeEventListener('timeupdate', onTimeUpdate)
  }, [updateSession])

  // Immediate persistence on backgrounding (mobile tab reclaim resilience, PRD.md 6.3).
  useEffect(() => {
    const flush = () => writerRef.current.writeImmediate(sessionRef.current)
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  // MediaSession action handlers wired once.
  useEffect(() => {
    setMediaSessionHandlers({
      onPlay: togglePlayPause,
      onPause: togglePlayPause,
      onPrevious: skipPrevious,
      onNext: skipNext,
      onSeekTo: seekTo,
    })
  }, [seekTo, skipNext, skipPrevious, togglePlayPause])

  useEffect(() => {
    return () => blobUrlManager.revokeAll()
  }, [])

  return {
    session,
    currentTrack,
    isPlaying,
    isLoading,
    downloadProgress,
    error,
    effectiveOrder,
    playFromLibrary,
    playShuffled,
    togglePlayPause,
    skipNext,
    skipPrevious,
    seekTo,
    setVolume,
    toggleShuffle,
    setRepeatMode,
    reorderQueue,
    removeFromQueue,
  }
}
