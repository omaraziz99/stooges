import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, CornerDownLeft, FileText, LoaderCircle, Paperclip, X } from 'lucide-react'
import { errorText } from '../lib/chat'
import { ACCEPT, formatSize, MAX_ATTACHMENTS, uploadFile, type Attachment } from '../lib/files'
import { useT } from '../lib/prefs'
import { useRelay } from '../state/relay'

type Pending = {
  id: number
  file: File
  preview: string | null // object URL for images
  attachment?: Attachment
  error?: string
}
let nextPendingId = 1

export type Suggestion = { value: string; label: string; hint?: string }

/**
 * Message box: Enter sends, Shift+Enter adds a new line.
 * Text starting with "/" is a command: it goes to onCommand and is never
 * posted to the channel. `suggest` can offer completions while typing.
 */
export function Composer({
  placeholder,
  onSend,
  onCommand,
  suggest,
  disabled = false,
}: {
  placeholder: string
  onSend: (text: string, attachments: Attachment[]) => Promise<unknown>
  onCommand?: (text: string) => Promise<void> | void
  suggest?: (text: string) => Suggestion[]
  disabled?: boolean
}) {
  const t = useT()
  const { secretKey } = useRelay()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploading = pending.some((p) => !p.attachment && !p.error)
  const ready = pending.flatMap((p) => (p.attachment ? [p.attachment] : []))

  // Free image previews when they go away.
  const previews = useRef(new Set<string>())
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const dropPreview = (p: Pending) => {
    if (p.preview) {
      URL.revokeObjectURL(p.preview)
      previews.current.delete(p.preview)
    }
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0 || disabled) return
    const room = MAX_ATTACHMENTS - pending.length
    if (files.length > room) setError(t('Up to {n} attachments per message.', { n: MAX_ATTACHMENTS }))
    const added = files.slice(0, Math.max(0, room)).map((file) => {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      if (preview) previews.current.add(preview)
      return { id: nextPendingId++, file, preview }
    })
    setPending((prev) => [...prev, ...added])
    for (const p of added) {
      uploadFile(secretKey, p.file).then(
        (attachment) => setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, attachment } : x))),
        (err) => setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, error: t(errorText(err)) } : x))),
      )
    }
    inputRef.current?.focus()
  }

  const removePending = (id: number) =>
    setPending((prev) => {
      const gone = prev.find((p) => p.id === id)
      if (gone) dropPreview(gone)
      return prev.filter((p) => p.id !== id)
    })

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = suggest && !sending ? suggest(text) : []
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1))

  const accept = (s: Suggestion) => {
    setText(s.value)
    setActive(0)
    inputRef.current?.focus()
  }

  /** Sends the message, or runs `command` (a picked suggestion) instead of the typed text. */
  const submit = async (e?: FormEvent, command?: string) => {
    e?.preventDefault()
    const trimmed = (command ?? text).trim()
    if ((!trimmed && ready.length === 0) || sending || disabled || uploading) return
    setSending(true)
    setError(null)
    try {
      if (trimmed.startsWith('/') && onCommand) await onCommand(trimmed)
      else {
        await onSend(trimmed, ready)
        pending.forEach(dropPreview)
        setPending([])
      }
      setText('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((highlighted + step + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[highlighted])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      // With suggestions open, Enter runs the highlighted one, not the half-typed text:
      // "/kpi-" alone would otherwise run as a bare /kpi.
      submit(undefined, suggestions.length > 0 ? suggestions[highlighted].value : undefined)
    }
  }

  const rows = Math.min(8, Math.max(1, text.split('\n').length))
  const isCommand = !!onCommand && text.trim().startsWith('/')

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="relative shrink-0 px-4 pb-4"
    >
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Command suggestions"
          className="absolute right-4 bottom-full left-4 mb-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.value} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  i === highlighted ? 'bg-gray-100' : ''
                }`}
              >
                <span>
                  <span className="font-mono text-gray-900">{s.value}</span>
                  <span className="ml-2 text-gray-500">{s.label}</span>
                </span>
                {s.hint && <span className="shrink-0 text-xs text-gray-400">{s.hint}</span>}
              </button>
            </li>
          ))}
          <li className="px-2.5 pt-1 pb-0.5 text-xs text-gray-400">{t('Tab to complete · Enter to run')}</li>
        </ul>
      )}
      {error && <p className="mb-1.5 px-1 text-sm text-rose-600">{error}</p>}
      <div
        className={`rounded-2xl border bg-white px-3 pt-2.5 pb-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] focus-within:border-gray-300 focus-within:shadow-[0_2px_8px_rgb(0_0_0/0.06)] ${
          dragging ? 'border-brand-400 ring-2 ring-brand-300' : 'border-gray-200'
        }`}
      >
        {pending.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('Attachments')}>
            {pending.map((p) => (
              <li
                key={p.id}
                className={`relative flex max-w-56 items-center gap-2 rounded-lg border p-1.5 pr-7 text-xs ${
                  p.error ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                {p.preview ? (
                  <img src={p.preview} alt="" className="size-9 shrink-0 rounded object-cover" />
                ) : (
                  <FileText aria-hidden className="size-9 shrink-0 p-1.5 text-gray-500" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800">{p.file.name}</span>
                  <span className={`block truncate ${p.error ? 'text-rose-600' : 'text-gray-500'}`}>
                    {p.error ?? (p.attachment ? formatSize(p.file.size) : t('Uploading…'))}
                  </span>
                </span>
                {!p.attachment && !p.error && (
                  <LoaderCircle aria-hidden className="absolute top-1.5 right-1.5 size-4 animate-spin text-gray-400" />
                )}
                {(p.attachment || p.error) && (
                  <button
                    type="button"
                    onClick={() => removePending(p.id)}
                    aria-label={t('Remove attachment')}
                    title={t('Remove attachment')}
                    className="absolute top-1 right-1 rounded p-0.5 text-gray-500 hover:bg-black/5 hover:text-gray-900"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          className="block max-h-48 min-h-6 w-full resize-none bg-transparent leading-6 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || pending.length >= MAX_ATTACHMENTS}
            aria-label={t('Attach file')}
            title={t('Attach file')}
            className="flex size-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-900 disabled:opacity-40"
          >
            <Paperclip aria-hidden className="size-4" />
          </button>
          <button
            type="submit"
            disabled={(!text.trim() && ready.length === 0) || sending || disabled || uploading}
            aria-label={sending ? 'Sending' : isCommand ? 'Run' : 'Send'}
            title={isCommand ? t('Run command') : t('Send')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isCommand ? <CornerDownLeft aria-hidden className="size-4" /> : <ArrowUp aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
    </form>
  )
}
