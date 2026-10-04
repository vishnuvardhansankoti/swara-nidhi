import { driveFetch, DriveApiError } from '../drive/driveFetch'
import { cacheProvider } from './cacheProvider'
import { LARGE_FILE_THRESHOLD_BYTES, type Track } from '../types'

export type DownloadProgress = (loadedBytes: number, totalBytes: number | null) => void

/** Whole-file blob fetch — the only streaming path in v1 (PRD.md section 5). */
export async function fetchTrackBlob(track: Track, signal: AbortSignal, onProgress?: DownloadProgress): Promise<Blob> {
  const cached = await cacheProvider.getTrackBlob(track.id)
  if (cached) return cached

  const url = `https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`
  const res = await driveFetch(url, { signal })
  if (!res.ok) throw await DriveApiError.fromResponse(res)

  if (!res.body || !onProgress) {
    const blob = await res.blob()
    void cacheProvider.putTrackBlob(track.id, blob, track.modifiedTime)
    return blob
  }

  const totalBytes = Number(res.headers.get('Content-Length')) || track.sizeBytes || null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loadedBytes += value.byteLength
    onProgress(loadedBytes, totalBytes)
  }

  const blob = new Blob(chunks as BlobPart[], { type: track.mimeType })
  void cacheProvider.putTrackBlob(track.id, blob, track.modifiedTime)
  return blob
}

/**
 * Gapless prefetch of the next queued track, gated by LARGE_FILE_THRESHOLD_BYTES
 * so two large blobs are never held concurrently (PRD.md section 5.3).
 */
export class PrefetchManager {
  private blobs = new Map<string, Blob>()
  private controller: AbortController | null = null
  private inFlightTrackId: string | null = null

  maybePrefetch(current: Track, next: Track | null) {
    if (!next || this.blobs.has(next.id) || this.inFlightTrackId === next.id) return
    if (current.sizeBytes > LARGE_FILE_THRESHOLD_BYTES || next.sizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
      return // accept a transition gap instead of risking a double-large-blob memory spike
    }

    this.controller = new AbortController()
    this.inFlightTrackId = next.id
    fetchTrackBlob(next, this.controller.signal)
      .then((blob) => {
        if (this.inFlightTrackId === next.id) {
          this.blobs.set(next.id, blob)
          this.inFlightTrackId = null
        }
      })
      .catch(() => {
        this.inFlightTrackId = null
      })
  }

  /** Returns and removes a prefetched blob, if one is ready for this track. */
  take(trackId: string): Blob | null {
    const blob = this.blobs.get(trackId) ?? null
    if (blob) this.blobs.delete(trackId)
    return blob
  }

  /** Aborts any in-flight prefetch not matching the now-current track (e.g. user skipped). */
  cancelIfNotMatching(activeTrackId: string) {
    if (this.inFlightTrackId && this.inFlightTrackId !== activeTrackId) {
      this.controller?.abort()
      this.inFlightTrackId = null
    }
  }

  clear() {
    this.controller?.abort()
    this.blobs.clear()
    this.inFlightTrackId = null
  }
}
