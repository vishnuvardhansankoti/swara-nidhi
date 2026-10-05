import type { IndexedDBTrackRecord } from '../types'

export interface FolderNode {
  key: string
  name: string
  trackIds: string[] // direct tracks in this folder, sorted by display name
  children: FolderNode[] // subfolders, sorted by name
  allTrackIds: string[] // this folder's tracks + every descendant's, in play order
}

interface MutableNode {
  name: string
  key: string
  trackIds: string[]
  children: Map<string, MutableNode>
}

function displayName(track: IndexedDBTrackRecord): string {
  return track.tags.title ?? track.name
}

/**
 * Builds a navigable folder tree from each track's `folderPath` breadcrumb — derived
 * from already-loaded track data rather than a separate `folders` store join, so
 * folders with no indexed audio (irrelevant to a player) are naturally omitted.
 * One root node per configured Drive root folder (keyed by rootFolderId so same-named
 * roots never collide). "Play"/"Shuffle" at any level act on `allTrackIds` (recursive).
 */
export function buildFolderTree(tracks: IndexedDBTrackRecord[]): FolderNode[] {
  const tracksById = new Map(tracks.map((t) => [t.id, t]))
  const roots = new Map<string, MutableNode>()

  for (const track of tracks) {
    if (track.folderPath.length === 0) continue

    let node: MutableNode | undefined = roots.get(track.rootFolderId)
    if (!node) {
      node = { name: track.folderPath[0], key: track.rootFolderId, trackIds: [], children: new Map() }
      roots.set(track.rootFolderId, node)
    }

    for (let i = 1; i < track.folderPath.length; i++) {
      const segment = track.folderPath[i]
      const parent: MutableNode = node
      let child: MutableNode | undefined = parent.children.get(segment)
      if (!child) {
        child = { name: segment, key: `${parent.key}/${segment}`, trackIds: [], children: new Map() }
        parent.children.set(segment, child)
      }
      node = child
    }

    node!.trackIds.push(track.id)
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const byDisplayName = (idA: string, idB: string) =>
    displayName(tracksById.get(idA)!).localeCompare(displayName(tracksById.get(idB)!))

  const finalize = (node: MutableNode): FolderNode => {
    const children = Array.from(node.children.values()).map(finalize).sort(byName)
    const trackIds = [...node.trackIds].sort(byDisplayName)
    return {
      key: node.key,
      name: node.name,
      trackIds,
      children,
      allTrackIds: [...trackIds, ...children.flatMap((c) => c.allTrackIds)],
    }
  }

  return Array.from(roots.values()).map(finalize).sort(byName)
}
