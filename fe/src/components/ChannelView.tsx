import { sendMessage, type Channel, type ChannelState } from '../lib/chat'
import { useRelay } from '../state/relay'
import { Composer, type Suggestion } from './Composer'
import { MessageList } from './MessageList'

export function ChannelView({
  channel,
  state,
  loaded,
  onOpenThread,
  onOpenSidebar,
  onCommand,
  suggest,
}: {
  channel: Channel
  state: ChannelState
  loaded: boolean
  onOpenThread: (id: string) => void
  onOpenSidebar: () => void
  onCommand: (text: string) => Promise<void>
  suggest: (text: string) => Suggestion[]
}) {
  const { client } = useRelay()

  const intro = (
    <div className="px-5 pb-4">
      <p className="text-xl font-bold text-stone-900"># {channel.name}</p>
      <p className="text-sm text-stone-500">
        {loaded
          ? `This is the start of #${channel.name}.${channel.about ? ` ${channel.about}` : ''}`
          : 'Loading messages…'}
      </p>
    </div>
  )

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <button
          onClick={onOpenSidebar}
          className="rounded p-1.5 text-stone-600 hover:bg-stone-100 md:hidden"
          aria-label="Open channel list"
        >
          ☰
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-stone-900"># {channel.name}</h1>
          {channel.about && <p className="truncate text-xs text-stone-500">{channel.about}</p>}
        </div>
      </header>

      <MessageList
        key={`list-${channel.id}`}
        messages={state.messages}
        state={state}
        channelId={channel.id}
        onOpenThread={onOpenThread}
        header={intro}
      />

      <Composer
        key={`composer-${channel.id}`}
        placeholder={`Message #${channel.name}`}
        onSend={(text) => sendMessage(client, channel.id, text)}
        onCommand={onCommand}
        suggest={suggest}
      />
    </section>
  )
}
