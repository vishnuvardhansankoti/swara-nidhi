import type { PlaybackSession } from '../types'

const STORAGE_KEY = 'swaranidhi:playbackSession:v1'

export function loadPlaybackSession(): PlaybackSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PlaybackSession
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function savePlaybackSession(session: PlaybackSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function emptyPlaybackSession(): PlaybackSession {
  return {
    version: 1,
    queue: [],
    shuffledOrder: null,
    currentTrackId: null,
    positionSeconds: 0,
    volume: 1,
    shuffle: false,
    repeatMode: 'off',
    updatedAtEpochMs: Date.now(),
  }
}

/** Throttles position writes to once per 5s during active playback (PRD.md 6.3); other writes are immediate. */
export class PlaybackSessionWriter {
  private lastWriteAt = 0
  private readonly throttleMs = 5000

  writeImmediate(session: PlaybackSession) {
    this.lastWriteAt = Date.now()
    savePlaybackSession({ ...session, updatedAtEpochMs: this.lastWriteAt })
  }

  writeThrottled(session: PlaybackSession) {
    const now = Date.now()
    if (now - this.lastWriteAt >= this.throttleMs) {
      this.writeImmediate(session)
    }
  }
}
