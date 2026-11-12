import { useState } from 'react'
import { deleteEvents, errorText, QUICK_REACTIONS, react, type ReactionGroup } from '../lib/chat'
import { displayName, formatTime, fullTimestamp } from '../lib/format'
import type { NostrEvent } from '../lib/relay'
import { useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'

type Props = {
  event: NostrEvent
  channelId: string
  /** Continuation of the same author's run: hide avatar and name. */
  compact: boolean
  reactions?: ReactionGroup[]
  replyCount?: number
  onOpenThread?: () => void
}

export function MessageItem({ event, channelId, compact, reactions, replyCount = 0, onOpenThread }: Props) {
  const { client, pubkey: me } = useRelay()
  const profiles = useProfiles()
  const notify = useNotify()
  const [pickerOpen, setPickerOpen] = useState(false)
  const name = displayName(profiles, event.pubkey)
  const mine = event.pubkey === me

  const run = (action: Promise<unknown>) => action.catch((err) => notify(errorText(err)))

  const toggleReaction = (emoji: string) => {
    setPickerOpen(false)
    const group = reactions?.find((g) => g.emoji === emoji)
    if (group && group.mine.length > 0) {
      run(deleteEvents(client, channelId, group.mine.map((e) => e.id)))
    } else {
      run(react(client, channelId, event, emoji))
    }
  }

  const remove = () => {
    if (window.confirm('Delete this message? This cannot be undone.')) {
      run(deleteEvents(client, channelId, [event.id]))
    }
  }

  const toolButton = 'rounded px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900'

  return (
    <div className={`group relative flex gap-3 px-5 hover:bg-stone-50 ${compact ? 'py-0.5' : 'pt-2 pb-0.5'}`}>
      <div className="w-9 shrink-0">
        {compact ? (
          <time
            title={fullTimestamp(event.created_at)}
            className="invisible block pt-0.5 text-right text-[10px] leading-6 text-stone-400 group-hover:visible"
          >
            {formatTime(event.created_at)}
          </time>
        ) : (
          <Avatar pubkey={event.pubkey} name={name} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-stone-900">{name}</span>
            <time title={fullTimestamp(event.created_at)} className="text-xs text-stone-500">
              {formatTime(event.created_at)}
            </time>
          </div>
        )}
        <p className="leading-relaxed break-words whitespace-pre-wrap text-stone-800">{event.content}</p>

        {reactions && reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((g) => (
              <button
                key={g.emoji}
                onClick={() => toggleReaction(g.emoji)}
                title={g.pubkeys.map((p) => displayName(profiles, p)).join(', ')}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${
                  g.mine.length > 0
                    ? 'border-sky-400 bg-sky-50 text-sky-800'
                    : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                }`}
              >
                <span>{g.emoji}</span>
                <span className="text-xs font-medium">{g.pubkeys.length}</span>
              </button>
            ))}
          </div>
        )}

        {onOpenThread && replyCount > 0 && (
          <button onClick={onOpenThread} className="mt-1 text-sm font-medium text-sky-700 hover:underline">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      <div
        className={`${pickerOpen ? 'flex' : 'hidden group-hover:flex'} absolute -top-3 right-4 items-center gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shadow-sm`}
      >
        <button className={toolButton} onClick={() => setPickerOpen((o) => !o)} title="Add reaction">
          ☺︎+
        </button>
        {onOpenThread && (
          <button className={toolButton} onClick={onOpenThread} title="Reply in thread">
            Reply
          </button>
        )}
        {mine && (
          <button className={`${toolButton} hover:text-rose-700`} onClick={remove} title="Delete message">
            Delete
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="absolute top-7 right-4 z-10 flex gap-0.5 rounded-lg border border-stone-200 bg-white p-1 shadow-md">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => toggleReaction(emoji)}
              className="rounded px-1.5 py-1 text-lg hover:bg-stone-100"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
