import { sendMessage, type ChannelState } from '../lib/chat'
import { useT } from '../lib/prefs'
import { useRelay } from '../state/relay'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { MessageList } from './MessageList'

export function ThreadPanel({
  channelId,
  rootId,
  state,
  onClose,
}: {
  channelId: string
  rootId: string
  state: ChannelState
  onClose: () => void
}) {
  const { client } = useRelay()
  const t = useT()
  const root = state.byId.get(rootId)
  const replies = state.replies.get(rootId) ?? []

  const rootView = (
    <div className="border-b border-gray-200 pb-3">
      {root ? (
        <MessageItem event={root} channelId={channelId} compact={false} reactions={state.reactions.get(root.id)} />
      ) : (
        <p className="px-5 text-sm text-gray-500 italic">{t('This message was deleted.')}</p>
      )}
      <p className="px-5 pt-3 text-xs font-medium text-gray-500">
        {t(replies.length === 1 ? '{n} reply' : '{n} replies', { n: replies.length })}
      </p>
    </div>
  )

  return (
    <aside className="fixed inset-0 z-20 flex flex-col bg-white md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-gray-200">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <h2 className="font-semibold text-gray-900">{t('Thread')}</h2>
        <button onClick={onClose} className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close thread">
          ✕
        </button>
      </header>

      <MessageList key={`list-${rootId}`} messages={replies} state={state} channelId={channelId} header={rootView} />

      <Composer
        key={`composer-${rootId}`}
        placeholder={t('Reply…')}
        disabled={!root}
        onSend={(text, files) => sendMessage(client, channelId, text, rootId, files)}
      />
    </aside>
  )
}
