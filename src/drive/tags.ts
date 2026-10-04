import { parseBuffer } from 'music-metadata'
import { driveFetch, DriveApiError } from './driveFetch'
import type { Track, TrackTags } from '../types'

const TAG_RANGE_BYTES = 1024 * 1024 // 1MB — covers ID3v2 header + typical embedded art (PRD.md 4.3)
const MAX_ART_DIMENSION = 512

async function downscaleArt(picture: { format: string; data: Uint8Array }): Promise<string | null> {
  try {
    const blob = new Blob([picture.data as BlobPart], { type: picture.format })
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, MAX_ART_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * Fetches the leading bytes of a Drive audio file and parses ID3v2 tags +
 * embedded album art client-side, without downloading the whole file.
 * See PRD.md section 4.3.
 */
export async function extractTrackTags(track: Track): Promise<TrackTags> {
  const url = `https://www.googleapis.com/drive/v3/files/${track.id}?alt=media`
  const res = await driveFetch(url, { headers: { Range: `bytes=0-${TAG_RANGE_BYTES - 1}` } })

  if (!res.ok && res.status !== 206) {
    throw await DriveApiError.fromResponse(res)
  }

  const buffer = new Uint8Array(await res.arrayBuffer())

  try {
    const metadata = await parseBuffer(buffer, track.mimeType)
    const picture = metadata.common.picture?.[0] ?? null
    const albumArtDataUrl = picture ? await downscaleArt(picture) : null

    return {
      title: metadata.common.title ?? null,
      artist: metadata.common.artist ?? null,
      album: metadata.common.album ?? null,
      durationSeconds: metadata.format.duration ?? null,
      albumArtDataUrl,
      tagExtractionStatus: metadata.common.title || metadata.common.artist ? 'success' : 'no-tags-found',
    }
  } catch {
    return {
      title: null,
      artist: null,
      album: null,
      durationSeconds: null,
      albumArtDataUrl: null,
      tagExtractionStatus: 'failed',
    }
  }
}

/** Concurrency-limited background tag extraction queue (PRD.md 4.3: max 4 in-flight). */
export function runTagExtractionQueue(
  tracks: Track[],
  onTagsExtracted: (trackId: string, tags: TrackTags) => void,
  concurrency = 4,
): { cancel: () => void } {
  let cancelled = false
  let cursor = 0

  const worker = async () => {
    while (!cancelled && cursor < tracks.length) {
      const track = tracks[cursor++]
      try {
        const tags = await extractTrackTags(track)
        if (!cancelled) onTagsExtracted(track.id, tags)
      } catch {
        if (!cancelled) {
          onTagsExtracted(track.id, {
            title: null,
            artist: null,
            album: null,
            durationSeconds: null,
            albumArtDataUrl: null,
            tagExtractionStatus: 'failed',
          })
        }
      }
    }
  }

  for (let i = 0; i < concurrency; i++) void worker()

  return { cancel: () => { cancelled = true } }
}
