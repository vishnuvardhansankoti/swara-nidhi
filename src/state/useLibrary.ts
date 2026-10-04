import { useCallback, useEffect, useRef, useState } from 'react'
import { scanRootFolder, validateFolderId, extractFolderId } from '../drive/scan'
import { runTagExtractionQueue } from '../drive/tags'
import {
  getAllTracks,
  putTracks,
  putFolders,
  deleteTracksByIds,
  getTracksForRoot,
  putScanState,
  getAllScanStates,
  deleteRoot,
} from '../db/indexedDb'
import {
  loadRootFolders,
  addRootFolder as persistAddRoot,
  removeRootFolder as persistRemoveRoot,
  type RootFolderConfig,
} from '../db/rootFolders'
import type { IndexedDBTrackRecord, ScanState } from '../types'

type RootFolderConfigLocal = RootFolderConfig

export interface LibraryState {
  roots: RootFolderConfigLocal[]
  tracks: IndexedDBTrackRecord[]
  scanStates: Record<string, ScanState>
  addRoot: (pastedUrl: string) => Promise<void>
  rescanRoot: (rootFolderId: string) => Promise<void>
  removeRoot: (rootFolderId: string) => Promise<void>
  error: string | null
}

export function useLibrary(): LibraryState {
  // Lazy initializer reads localStorage synchronously on first render, so a returning
  // user's root-folder list is available immediately — no flash of "no data" before
  // the sign-in gate can decide whether to show cached content (see App.tsx).
  const [roots, setRoots] = useState<RootFolderConfigLocal[]>(() => loadRootFolders())
  const [tracks, setTracks] = useState<IndexedDBTrackRecord[]>([])
  const [scanStates, setScanStates] = useState<Record<string, ScanState>>({})
  const [error, setError] = useState<string | null>(null)
  const tagCancelRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    getAllTracks().then(setTracks)
    getAllScanStates().then((states) => {
      setScanStates(Object.fromEntries(states.map((s) => [s.rootFolderId, s])))
    })
  }, [])

  const updateScanState = useCallback(async (state: ScanState) => {
    await putScanState(state)
    setScanStates((prev) => ({ ...prev, [state.rootFolderId]: state }))
  }, [])

  const rescanRoot = useCallback(
    async (rootFolderId: string) => {
      // Read directly from storage rather than the `roots` closure, since this can be
      // called immediately after addRoot() persists a new entry but before React's
      // state update for `roots` has committed.
      const root = loadRootFolders().find((r) => r.id === rootFolderId)
      if (!root) return

      await updateScanState({ rootFolderId, rootFolderName: root.name, lastScannedAtEpochMs: null, status: 'scanning' })

      try {
        const existing = await getTracksForRoot(rootFolderId)
        const existingById = new Map(existing.map((t) => [t.id, t]))

        const { folders, tracks: scanned } = await scanRootFolder(rootFolderId, root.name)

        const scannedIds = new Set(scanned.map((t) => t.id))
        const staleIds = existing.filter((t) => !scannedIds.has(t.id)).map((t) => t.id)
        if (staleIds.length) await deleteTracksByIds(staleIds)

        const toExtractTags = scanned.filter((t) => {
          const prev = existingById.get(t.id)
          return !prev || prev.modifiedTime !== t.modifiedTime
        })

        const merged: IndexedDBTrackRecord[] = scanned.map((t) => {
          const prev = existingById.get(t.id)
          const needsExtraction = toExtractTags.some((x) => x.id === t.id)
          return { ...t, rootFolderId, tags: needsExtraction ? t.tags : prev!.tags }
        })

        await putFolders(rootFolderId, folders)
        await putTracks(merged)

        setTracks((prev) => {
          const others = prev.filter((t) => t.rootFolderId !== rootFolderId)
          return [...others, ...merged]
        })

        await updateScanState({
          rootFolderId,
          rootFolderName: root.name,
          lastScannedAtEpochMs: Date.now(),
          status: 'idle',
        })

        tagCancelRef.current?.cancel()
        tagCancelRef.current = runTagExtractionQueue(toExtractTags, (trackId, tags) => {
          setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, tags } : t)))
          void putTracks([{ ...merged.find((t) => t.id === trackId)!, tags }])
        })
      } catch (err) {
        await updateScanState({
          rootFolderId,
          rootFolderName: root.name,
          lastScannedAtEpochMs: Date.now(),
          status: 'error',
          lastError: err instanceof Error ? err.message : String(err),
        })
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [updateScanState],
  )

  const addRoot = useCallback(
    async (pastedUrl: string) => {
      setError(null)
      const id = extractFolderId(pastedUrl)
      if (!id) {
        setError('Could not find a Drive folder ID in that link.')
        return
      }
      try {
        const { name } = await validateFolderId(id)
        const updated: RootFolderConfig[] = persistAddRoot({ id, name })
        setRoots(updated)
        await rescanRoot(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [rescanRoot],
  )

  const removeRoot = useCallback(async (rootFolderId: string) => {
    setRoots(persistRemoveRoot(rootFolderId))
    await deleteRoot(rootFolderId)
    setTracks((prev) => prev.filter((t) => t.rootFolderId !== rootFolderId))
    setScanStates((prev) => {
      const { [rootFolderId]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  return { roots, tracks, scanStates, addRoot, rescanRoot, removeRoot, error }
}
