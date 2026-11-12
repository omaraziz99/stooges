// A modal card on a native <dialog>. Render it only while it should show: it
// opens on mount and calls onClose however it closes (a button, Esc, or a
// click on the backdrop). showModal() gives the backdrop, Esc and focus kept
// inside; focus starts on the first button, so put the safe one first.
//
// It is portalled to <body>, because on phones the sidebar or message that
// opens it can be hidden, and a hidden parent hides the dialog too.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({
  labelledBy,
  onClose,
  className = 'max-w-md',
  children,
}: {
  /** The id of the modal's heading. */
  labelledBy: string
  onClose: () => void
  /** Width, e.g. "max-w-2xl". */
  className?: string
  /** The card's content; call close() from its buttons. */
  children: (close: () => void) => ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => ref.current?.close()

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself; clicks inside land on the card.
      onClick={(e) => e.target === ref.current && close()}
      className={`m-auto w-[calc(100%-2rem)] overflow-hidden rounded-3xl bg-white text-gray-900 shadow-2xl ring-1 ring-black/10 backdrop:bg-[rgb(17_12_8/0.45)] backdrop:backdrop-blur-[2px] ${className}`}
    >
      {children(close)}
    </dialog>,
    document.body,
  )
}
