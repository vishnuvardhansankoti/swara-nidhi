// Core domain types — PRD.md Appendix A.

export interface AuthState {
  status: 'signed-out' | 'authenticating' | 'signed-in' | 'expired'
  accessToken: string | null // in-memory only — never persisted to localStorage/IndexedDB/sessionStorage
  tokenExpiresAtEpochMs: number | null
  scope: 'https://www.googleapis.com/auth/drive.readonly'
  lastError: { code: number; message: string } | null
}

export interface DriveFolderNode {
  id: string
  name: string
  parentId: string | null
  isRoot: boolean
  modifiedTime: string // RFC3339
}

export interface TrackTags {
  title: string | null
  artist: string | null
  album: string | null
  durationSeconds: number | null
  albumArtDataUrl: string | null // downscaled (<=512x512) data: URI, from ID3v2 APIC frame
  tagExtractionStatus: 'pending' | 'success' | 'no-tags-found' | 'failed'
}

export interface Track {
  id: string // Drive file ID
  name: string // raw Drive filename, fallback display
  mimeType: string
  sizeBytes: number
  parentFolderId: string
  folderPath: string[] // breadcrumb from root to file
  modifiedTime: string // RFC3339 — drives rescan staleness detection
  isLargeFile: boolean // sizeBytes > LARGE_FILE_THRESHOLD_BYTES
  availability: 'available' | 'unavailable'
  tags: TrackTags
}

export interface QueueEntry {
  trackId: string
  queuePosition: number // stable original (non-shuffled) order
}

export type RepeatMode = 'off' | 'one' | 'all'

export interface PlaybackSession {
  version: 1
  queue: QueueEntry[]
  shuffledOrder: string[] | null
  currentTrackId: string | null
  positionSeconds: number
  volume: number // 0.0–1.0
  shuffle: boolean
  repeatMode: RepeatMode
  updatedAtEpochMs: number
}

export interface IndexedDBTrackRecord extends Track {
  rootFolderId: string
}

export interface ScanState {
  rootFolderId: string
  rootFolderName: string
  lastScannedAtEpochMs: number | null
  status: 'idle' | 'scanning' | 'error'
  lastError?: string
}

// Reserved extension point for the deferred (v2) offline LRU blob cache.
// v1 call sites are written against this interface so real caching can be
// introduced later with no changes outside the implementing module.
export interface CacheEntry {
  key: string // trackId
  blob: Blob
  sizeBytes: number
  lastAccessedEpochMs: number
  sourceModifiedTime: string
}

export interface CacheProvider {
  getTrackBlob(trackId: string): Promise<Blob | null>
  putTrackBlob(trackId: string, blob: Blob, sourceModifiedTime: string): Promise<void>
  evictLeastRecentlyUsed(targetFreeBytes: number): Promise<void>
}

export const LARGE_FILE_THRESHOLD_BYTES = 30 * 1024 * 1024
