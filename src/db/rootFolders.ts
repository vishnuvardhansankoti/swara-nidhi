// Root folder configuration — per-device localStorage, deliberately not synced (PRD.md section 0/4.1).

const STORAGE_KEY = 'swaranidhi:rootFolders:v1'

export interface RootFolderConfig {
  id: string
  name: string
}

export function loadRootFolders(): RootFolderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RootFolderConfig[]) : []
  } catch {
    return []
  }
}

export function saveRootFolders(folders: RootFolderConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
}

export function addRootFolder(folder: RootFolderConfig): RootFolderConfig[] {
  const existing = loadRootFolders()
  if (existing.some((f) => f.id === folder.id)) return existing
  const updated = [...existing, folder]
  saveRootFolders(updated)
  return updated
}

export function removeRootFolder(id: string): RootFolderConfig[] {
  const updated = loadRootFolders().filter((f) => f.id !== id)
  saveRootFolders(updated)
  return updated
}
