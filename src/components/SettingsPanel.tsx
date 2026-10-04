import { useState } from 'react'
import type { ScanState } from '../types'

interface RootFolderConfig {
  id: string
  name: string
}

interface Props {
  roots: RootFolderConfig[]
  scanStates: Record<string, ScanState>
  onAddRoot: (pastedUrl: string) => Promise<void>
  onRescanRoot: (id: string) => Promise<void>
  onRemoveRoot: (id: string) => Promise<void>
  error: string | null
  onClose: () => void
}

export function SettingsPanel({ roots, scanStates, onAddRoot, onRescanRoot, onRemoveRoot, error, onClose }: Props) {
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleAdd = async () => {
    if (!input.trim()) return
    setSubmitting(true)
    await onAddRoot(input.trim())
    setSubmitting(false)
    setInput('')
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/60 p-4 pt-16">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Library folders</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <div className="mb-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Google Drive folder link…"
            className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={handleAdd}
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <ul className="space-y-2">
          {roots.map((root) => {
            const scan = scanStates[root.id]
            return (
              <li key={root.id} className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{root.name}</p>
                  <p className="text-xs text-slate-400">
                    {scan?.status === 'scanning'
                      ? 'Scanning…'
                      : scan?.status === 'error'
                        ? `Error: ${scan.lastError}`
                        : scan?.lastScannedAtEpochMs
                          ? `Last scanned ${new Date(scan.lastScannedAtEpochMs).toLocaleString()}`
                          : 'Not scanned yet'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onRescanRoot(root.id)}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                  >
                    Rescan
                  </button>
                  <button
                    onClick={() => onRemoveRoot(root.id)}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs text-red-300 hover:bg-slate-600"
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
          {roots.length === 0 && <p className="text-sm text-slate-500">No folders added yet.</p>}
        </ul>
      </div>
    </div>
  )
}
