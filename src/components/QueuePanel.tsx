import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { IndexedDBTrackRecord, PlaybackSession } from '../types'

interface RowProps {
  trackId: string
  track: IndexedDBTrackRecord | undefined
  isActive: boolean
  onRemove: (trackId: string) => void
}

function QueueRow({ trackId, track, isActive, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: trackId })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isActive ? 'bg-slate-800' : ''}`}
    >
      <span {...attributes} {...listeners} className="cursor-grab select-none text-slate-500 touch-none">⠿</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${isActive ? 'text-emerald-400' : 'text-slate-200'}`}>
        {track?.tags.title ?? track?.name ?? trackId}
      </span>
      <button onClick={() => onRemove(trackId)} className="text-xs text-slate-500 hover:text-red-400">
        ✕
      </button>
    </li>
  )
}

interface Props {
  session: PlaybackSession
  effectiveOrder: string[]
  tracksById: Map<string, IndexedDBTrackRecord>
  onReorder: (fromIndex: number, toIndex: number) => void
  onRemove: (trackId: string) => void
}

export function QueuePanel({ session, effectiveOrder, tracksById, onReorder, onRemove }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = session.queue.findIndex((e) => e.trackId === active.id)
    const newIndex = session.queue.findIndex((e) => e.trackId === over.id)
    if (oldIndex >= 0 && newIndex >= 0) onReorder(oldIndex, newIndex)
  }

  if (effectiveOrder.length === 0) {
    return <p className="p-4 text-sm text-slate-500">Queue is empty.</p>
  }

  // Reordering (drag) always acts on the stable queue order; while shuffled,
  // the visual order follows shuffledOrder but drag handles are disabled to
  // avoid ambiguity between the two orderings.
  const items = session.shuffle ? session.queue.map((e) => e.trackId) : arrayMove([...effectiveOrder], 0, 0)

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1 p-2">
          {effectiveOrder.map((trackId) => (
            <QueueRow
              key={trackId}
              trackId={trackId}
              track={tracksById.get(trackId)}
              isActive={trackId === session.currentTrackId}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
