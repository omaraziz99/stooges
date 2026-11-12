import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ChannelState } from '../lib/chat'
import type { NostrEvent } from '../lib/relay'
import { MessageItem } from './MessageItem'

const GROUP_WINDOW_SECONDS = 5 * 60

/**
 * Scrollable list of messages. Sticks to the bottom as new messages arrive,
 * unless the reader has scrolled up to read history.
 */
export function MessageList({
  messages,
  state,
  channelId,
  onOpenThread,
  header,
}: {
  messages: NostrEvent[]
  state: ChannelState
  channelId: string
  onOpenThread?: (id: string) => void
  header?: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, state.reactions])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-3">
      {header}
      {messages.map((event, i) => {
        const prev = messages[i - 1]
        const compact =
          !!prev &&
          prev.pubkey === event.pubkey &&
          event.created_at - prev.created_at < GROUP_WINDOW_SECONDS &&
          !(onOpenThread && state.replies.get(prev.id)?.length)
        return (
          <MessageItem
            key={event.id}
            event={event}
            channelId={channelId}
            compact={compact}
            reactions={state.reactions.get(event.id)}
            replyCount={state.replies.get(event.id)?.length ?? 0}
            onOpenThread={onOpenThread && (() => onOpenThread(event.id))}
          />
        )
      })}
    </div>
  )
}
