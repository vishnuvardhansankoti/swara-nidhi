import { driveFetch, DriveApiError, withRateLimitBackoff } from './driveFetch'
import { LARGE_FILE_THRESHOLD_BYTES, type DriveFolderNode, type Track } from '../types'

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface RawDriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  parents?: string[]
  modifiedTime: string
}

interface FilesListPage {
  nextPageToken?: string
  files: RawDriveFile[]
}

async function listChildren(folderId: string, onRetry?: (attempt: number, delayMs: number) => void) {
  const results: RawDriveFile[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(FILES_ENDPOINT)
    url.searchParams.set(
      'q',
      `'${folderId}' in parents and trashed = false and ` +
        `(mimeType = '${FOLDER_MIME}' or mimeType contains 'audio/')`,
    )
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,parents,modifiedTime)')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const page = await withRateLimitBackoff(
      async () => {
        const res = await driveFetch(url.toString())
        if (!res.ok) throw await DriveApiError.fromResponse(res)
        return (await res.json()) as FilesListPage
      },
      { onRetry },
    )

    results.push(...page.files)
    pageToken = page.nextPageToken
  } while (pageToken)

  return results
}

export interface ScanResult {
  folders: DriveFolderNode[]
  tracks: Track[]
}

export interface ScanOptions {
  onProgress?: (foldersScanned: number, tracksFound: number) => void
  onRetry?: (attempt: number, delayMs: number) => void
}

/**
 * Recursively walks a Drive folder tree (BFS) starting at rootFolderId,
 * collecting subfolders and audio files. See PRD.md section 4.2.
 */
export async function scanRootFolder(
  rootFolderId: string,
  rootFolderName: string,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const worklist: string[] = [rootFolderId]
  const folders: DriveFolderNode[] = [
    { id: rootFolderId, name: rootFolderName, parentId: null, isRoot: true, modifiedTime: new Date().toISOString() },
  ]
  const rawTracks: { file: RawDriveFile; parentFolderId: string }[] = []
  let foldersScanned = 0

  while (worklist.length > 0) {
    const folderId = worklist.shift()!
    const children = await listChildren(folderId, opts.onRetry)
    foldersScanned += 1

    for (const f of children) {
      if (f.mimeType === FOLDER_MIME) {
        folders.push({ id: f.id, name: f.name, parentId: folderId, isRoot: false, modifiedTime: f.modifiedTime })
        worklist.push(f.id)
      } else {
        rawTracks.push({ file: f, parentFolderId: folderId })
      }
    }
    opts.onProgress?.(foldersScanned, rawTracks.length)
  }

  const folderById = new Map(folders.map((f) => [f.id, f]))
  const folderPathOf = (folderId: string): string[] => {
    const path: string[] = []
    let current: DriveFolderNode | undefined = folderById.get(folderId)
    while (current) {
      path.unshift(current.name)
      current = current.parentId ? folderById.get(current.parentId) : undefined
    }
    return path
  }

  const tracks: Track[] = rawTracks.map(({ file, parentFolderId }) => {
    const sizeBytes = file.size ? Number(file.size) : 0
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes,
      parentFolderId,
      folderPath: folderPathOf(parentFolderId),
      modifiedTime: file.modifiedTime,
      isLargeFile: sizeBytes > LARGE_FILE_THRESHOLD_BYTES,
      availability: 'available',
      tags: {
        title: null,
        artist: null,
        album: null,
        durationSeconds: null,
        albumArtDataUrl: null,
        tagExtractionStatus: 'pending',
      },
    }
  })

  return { folders, tracks }
}

/** Validates a pasted folder ID resolves to an accessible Drive folder before adding it as a root. */
export async function validateFolderId(folderId: string): Promise<{ id: string; name: string }> {
  const url = new URL(`${FILES_ENDPOINT}/${folderId}`)
  url.searchParams.set('fields', 'id,name,mimeType')
  const res = await driveFetch(url.toString())
  if (!res.ok) throw await DriveApiError.fromResponse(res)
  const body = (await res.json()) as { id: string; name: string; mimeType: string }
  if (body.mimeType !== FOLDER_MIME) {
    throw new Error('The pasted link does not point to a Drive folder.')
  }
  return { id: body.id, name: body.name }
}

const FOLDER_ID_PATTERN = /\/folders\/([a-zA-Z0-9_-]{10,})/

export function extractFolderId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed
  return trimmed.match(FOLDER_ID_PATTERN)?.[1] ?? null
}
