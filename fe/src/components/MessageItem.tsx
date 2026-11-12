import { useState } from 'react'
import { CUSTOM_EMOJI, deleteEvents, errorText, QUICK_REACTIONS, react, type ReactionGroup } from '../lib/chat'
import { displayName, formatTime, fullTimestamp } from '../lib/format'
import { attachmentsOf, downloadUrl, formatSize, isImage, textWithoutAttachments } from '../lib/files'
import type { NostrEvent } from '../lib/relay'
import { FileText, Trash2 } from 'lucide-react'
import { useT } from '../lib/prefs'
import { useNotify, useProfiles, useRelay } from '../state/relay'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'

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
  const t = useT()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const name = displayName(profiles, event.pubkey)
  const mine = event.pubkey === me
  const attachments = attachmentsOf(event)
  const text = textWithoutAttachments(event.content, attachments)
  const images = attachments.filter(isImage)
  const others = attachments.filter((a) => !isImage(a))

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

  const toolButton = 'rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900'

  return (
    <div className={`group relative flex gap-3 px-5 hover:bg-gray-50 ${compact ? 'py-0.5' : 'pt-2 pb-0.5'}`}>
      <div className="w-9 shrink-0">
        {compact ? (
          <time
            title={fullTimestamp(event.created_at)}
            className="invisible block pt-0.5 text-right text-[10px] leading-6 text-gray-400 group-hover:visible"
          >
            {formatTime(event.created_at)}
          </time>
        ) : (
          <Avatar name={name} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-gray-900">{name}</span>
            <time title={fullTimestamp(event.created_at)} className="text-xs text-gray-500">
              {formatTime(event.created_at)}
            </time>
          </div>
        )}
        {text && <p className="leading-relaxed break-words whitespace-pre-wrap text-gray-800">{text}</p>}

        {images.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {images.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
                <img
                  src={a.url}
                  alt={a.name}
                  loading="lazy"
                  className="max-h-64 max-w-full rounded-lg border border-gray-200 object-contain sm:max-w-sm"
                />
              </a>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {others.map((a) => (
              <a
                key={a.url}
                href={downloadUrl(a)}
                download={a.name}
                rel="noopener noreferrer"
                className="flex max-w-xs items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm hover:border-gray-400"
              >
                <FileText aria-hidden className="size-5 shrink-0 text-gray-500" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800">{a.name}</span>
                  <span className="block text-xs text-gray-500">{formatSize(a.size)}</span>
                </span>
              </a>
            ))}
          </div>
        )}

        {reactions && reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((g) => (
              <button
                key={g.emoji}
                onClick={() => toggleReaction(g.emoji)}
                title={g.pubkeys.map((p) => displayName(profiles, p)).join(', ')}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${
                  g.mine.length > 0
                    ? 'border-brand-400 bg-brand-50 text-brand-800'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                }`}
              >
                <Emoji emoji={g.emoji} />
                <span className="text-xs font-medium">{g.pubkeys.length}</span>
              </button>
            ))}
          </div>
        )}

        {onOpenThread && replyCount > 0 && (
          <button onClick={onOpenThread} className="mt-1 text-sm font-medium text-brand-700 hover:underline">
            {t(replyCount === 1 ? '{n} reply' : '{n} replies', { n: replyCount })}
          </button>
        )}
      </div>

      <div
        className={`${pickerOpen ? 'flex' : 'hidden group-hover:flex'} absolute -top-3 right-4 items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm`}
      >
        <button className={toolButton} onClick={() => setPickerOpen((o) => !o)} title={t('Add reaction')}>
          ☺︎+
        </button>
        {onOpenThread && (
          <button className={toolButton} onClick={onOpenThread} title={t('Reply in thread')}>
            {t('Reply')}
          </button>
        )}
        {mine && (
          <button className={`${toolButton} hover:text-rose-700`} onClick={() => setConfirmingDelete(true)} title={t('Delete message')}>
            {t('Delete')}
          </button>
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          danger
          icon={Trash2}
          title={t('Delete this message?')}
          description={t('This cannot be undone.')}
          cancelLabel={t('Cancel')}
          confirmLabel={t('Delete')}
          onConfirm={() => run(deleteEvents(client, channelId, [event.id]))}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {pickerOpen && (
        <div className="absolute top-7 right-4 z-10 flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-md">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => toggleReaction(emoji)}
              className="rounded px-1.5 py-1 text-lg hover:bg-gray-100"
              aria-label={`React with ${CUSTOM_EMOJI[emoji]?.label ?? emoji}`}
              title={CUSTOM_EMOJI[emoji]?.label}
            >
              <Emoji emoji={emoji} large />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A reaction emoji: our own image for custom ones like :kopi:, else the text. */
function Emoji({ emoji, large = false }: { emoji: string; large?: boolean }) {
  const custom = CUSTOM_EMOJI[emoji]
  if (!custom) return <span>{emoji}</span>
  return (
    <img
      src={custom.src}
      alt={emoji}
      draggable={false}
      className={`custom-emoji inline-block object-contain ${large ? 'size-7' : 'size-5'}`}
    />
  )
}
