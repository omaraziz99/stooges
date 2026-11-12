// The card that asks before an action: KPI opt-in/out, a channel's KPI review,
// deleting a channel or a message. Render it only while asking (see Modal);
// focus starts on cancel, so no stray Enter confirms.
import { useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Modal } from './Modal'

export function ConfirmDialog({
  icon: Icon,
  title,
  description,
  points = [],
  cancelLabel,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  icon: LucideIcon
  title: string
  description?: string
  /** What will happen, one short line each, with an icon. */
  points?: [LucideIcon, string][]
  cancelLabel: string
  confirmLabel: string
  /** A red button and icon, for deleting things. */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const button =
    'inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      {(close) => (
        <div className="p-6 sm:p-7">
          <div
            className={`flex size-11 items-center justify-center rounded-2xl ${danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'}`}
          >
            <Icon aria-hidden className="size-5" />
          </div>
          <h2 id={titleId} className="mt-4 text-xl font-semibold tracking-[-0.01em] break-words">
            {title}
          </h2>
          {description && <p className="mt-2 text-sm leading-relaxed text-gray-600">{description}</p>}
          {points.length > 0 && (
            <ul className="mt-5 space-y-3">
              {points.map(([PointIcon, text]) => (
                <li key={text} className="flex gap-3 text-sm leading-snug text-gray-800">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                    <PointIcon aria-hidden className="size-3.5" />
                  </span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={`${button} border border-gray-200 bg-white text-gray-900 hover:bg-gray-50`}>
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm()
                close()
              }}
              className={`${button} ${danger ? 'bg-danger' : 'bg-brand-600'} text-on-brand hover:opacity-90`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
