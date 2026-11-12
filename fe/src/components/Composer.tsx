import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, CornerDownLeft } from 'lucide-react'
import { errorText } from '../lib/chat'

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
  onSend: (text: string) => Promise<unknown>
  onCommand?: (text: string) => Promise<void> | void
  suggest?: (text: string) => Suggestion[]
  disabled?: boolean
}) {
  const [text, setText] = useState('')
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

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    setError(null)
    try {
      if (trimmed.startsWith('/') && onCommand) await onCommand(trimmed)
      else await onSend(trimmed)
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
      submit()
    }
  }

  const rows = Math.min(8, Math.max(1, text.split('\n').length))
  const isCommand = !!onCommand && text.trim().startsWith('/')

  return (
    <form onSubmit={submit} className="relative shrink-0 px-4 pb-4">
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Command suggestions"
          className="absolute right-4 bottom-full left-4 mb-1 max-h-64 overflow-y-auto rounded-lg border border-stone-200 bg-white p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li key={s.value} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  i === highlighted ? 'bg-stone-100' : ''
                }`}
              >
                <span>
                  <span className="font-mono text-stone-900">{s.value}</span>
                  <span className="ml-2 text-stone-500">{s.label}</span>
                </span>
                {s.hint && <span className="shrink-0 text-xs text-stone-400">{s.hint}</span>}
              </button>
            </li>
          ))}
          <li className="px-2.5 pt-1 pb-0.5 text-xs text-stone-400">Tab to complete · Enter to run</li>
        </ul>
      )}
      {error && <p className="mb-1.5 px-1 text-sm text-rose-600">{error}</p>}
      <div className="rounded-2xl border border-stone-200 bg-white px-3 pt-2.5 pb-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] focus-within:border-stone-300 focus-within:shadow-[0_2px_8px_rgb(0_0_0/0.06)]">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          className="block max-h-48 min-h-6 w-full resize-none bg-transparent leading-6 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed"
        />
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <button
            type="submit"
            disabled={!text.trim() || sending || disabled}
            aria-label={sending ? 'Sending' : isCommand ? 'Run' : 'Send'}
            title={isCommand ? 'Run command' : 'Send'}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {isCommand ? <CornerDownLeft aria-hidden className="size-4" /> : <ArrowUp aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
    </form>
  )
}
