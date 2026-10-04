import type { CacheProvider } from '../types'

/**
 * v1 no-op implementation of the CacheProvider extension point (PRD.md 5.6).
 * The streaming engine always calls through this interface so the deferred
 * v2 offline LRU blob cache can be introduced by swapping this module alone.
 */
export const cacheProvider: CacheProvider = {
  async getTrackBlob() {
    return null
  },
  async putTrackBlob() {
    // no-op in v1
  },
  async evictLeastRecentlyUsed() {
    // no-op in v1
  },
}
