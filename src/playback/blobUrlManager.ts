/**
 * Single choke point for URL.createObjectURL / revokeObjectURL so blob-URL
 * lifecycle discipline (PRD.md 7.4) is enforced in one auditable place
 * rather than scattered through playback code. The previous URL is only
 * revoked once a new one is confirmed playing, never preemptively.
 */
class BlobUrlManager {
  private current: { trackId: string; url: string } | null = null
  private pendingRevoke: string | null = null

  create(trackId: string, blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.pendingRevoke = this.current?.url ?? null
    this.current = { trackId, url }
    return url
  }

  /** Call once the new URL's track has actually started playing. */
  confirmActive() {
    if (this.pendingRevoke) {
      URL.revokeObjectURL(this.pendingRevoke)
      this.pendingRevoke = null
    }
  }

  revokeAll() {
    if (this.current) URL.revokeObjectURL(this.current.url)
    if (this.pendingRevoke) URL.revokeObjectURL(this.pendingRevoke)
    this.current = null
    this.pendingRevoke = null
  }
}

export const blobUrlManager = new BlobUrlManager()
