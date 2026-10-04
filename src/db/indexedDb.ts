import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { DriveFolderNode, IndexedDBTrackRecord, ScanState } from '../types'

const DB_NAME = 'swaranidhi'
const DB_VERSION = 1

interface SwaranidhiDB extends DBSchema {
  tracks: {
    key: string
    value: IndexedDBTrackRecord
    indexes: { 'by-root': string }
  }
  folders: {
    key: string
    value: DriveFolderNode & { rootFolderId: string }
    indexes: { 'by-root': string }
  }
  scanState: {
    key: string // rootFolderId
    value: ScanState
  }
}

let dbPromise: Promise<IDBPDatabase<SwaranidhiDB>> | null = null

function getDb() {
  // Schema is intentionally versioned from day one — the deferred (v2) offline
  // blob cache adds a `blobCache` store in a later DB_VERSION without touching
  // this migration path. See PRD.md section 4.4 / 5.6.
  if (!dbPromise) {
    dbPromise = openDB<SwaranidhiDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' })
        tracks.createIndex('by-root', 'rootFolderId')

        const folders = db.createObjectStore('folders', { keyPath: 'id' })
        folders.createIndex('by-root', 'rootFolderId')

        db.createObjectStore('scanState', { keyPath: 'rootFolderId' })
      },
    })
  }
  return dbPromise
}

export async function putTracks(tracks: IndexedDBTrackRecord[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('tracks', 'readwrite')
  await Promise.all([...tracks.map((t) => tx.store.put(t)), tx.done])
}

export async function putFolders(rootFolderId: string, folders: DriveFolderNode[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('folders', 'readwrite')
  await Promise.all([...folders.map((f) => tx.store.put({ ...f, rootFolderId })), tx.done])
}

export async function getAllTracks(): Promise<IndexedDBTrackRecord[]> {
  const db = await getDb()
  return db.getAll('tracks')
}

export async function getTracksForRoot(rootFolderId: string): Promise<IndexedDBTrackRecord[]> {
  const db = await getDb()
  return db.getAllFromIndex('tracks', 'by-root', rootFolderId)
}

export async function deleteTracksByIds(trackIds: string[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('tracks', 'readwrite')
  await Promise.all([...trackIds.map((id) => tx.store.delete(id)), tx.done])
}

export async function putScanState(state: ScanState): Promise<void> {
  const db = await getDb()
  await db.put('scanState', state)
}

export async function getScanState(rootFolderId: string): Promise<ScanState | undefined> {
  const db = await getDb()
  return db.get('scanState', rootFolderId)
}

export async function getAllScanStates(): Promise<ScanState[]> {
  const db = await getDb()
  return db.getAll('scanState')
}

export async function deleteRoot(rootFolderId: string): Promise<void> {
  const db = await getDb()
  const trackIds = (await getTracksForRoot(rootFolderId)).map((t) => t.id)
  const folderIds = (await db.getAllFromIndex('folders', 'by-root', rootFolderId)).map((f) => f.id)
  const tx = db.transaction(['tracks', 'folders', 'scanState'], 'readwrite')
  await Promise.all([
    ...trackIds.map((id) => tx.objectStore('tracks').delete(id)),
    ...folderIds.map((id) => tx.objectStore('folders').delete(id)),
    tx.objectStore('scanState').delete(rootFolderId),
    tx.done,
  ])
}
