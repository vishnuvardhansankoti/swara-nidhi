import type { Track } from '../types'

export interface MediaSessionHandlers {
  onPlay: () => void
  onPause: () => void
  onPrevious: () => void
  onNext: () => void
  onSeekTo: (seconds: number) => void
}

/** Lock-screen / notification controls — a v1 requirement given mobile usage (PRD.md 6.1). */
export function setMediaSessionHandlers(handlers: MediaSessionHandlers) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.setActionHandler('play', handlers.onPlay)
  navigator.mediaSession.setActionHandler('pause', handlers.onPause)
  navigator.mediaSession.setActionHandler('previoustrack', handlers.onPrevious)
  navigator.mediaSession.setActionHandler('nexttrack', handlers.onNext)
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') handlers.onSeekTo(details.seekTime)
  })
}

export function updateMediaSessionMetadata(track: Track) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.tags.title ?? track.name,
    artist: track.tags.artist ?? 'Unknown Artist',
    album: track.tags.album ?? track.folderPath.at(-1) ?? '',
    artwork: track.tags.albumArtDataUrl
      ? [{ src: track.tags.albumArtDataUrl, sizes: '512x512', type: 'image/png' }]
      : [],
  })
}

export function setMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none') {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = state
}
