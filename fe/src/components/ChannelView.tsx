import { Lock } from 'lucide-react'
import { errorText, sendMessage, setChannelKpiReview, type Channel, type ChannelState } from '../lib/chat'
import { useT } from '../lib/prefs'
import { useNotify, useRelay } from '../state/relay'
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
  const { client, pubkey } = useRelay()
  const notify = useNotify()
  const t = useT()
  const isCreator = channel.creator !== '' && channel.creator === pubkey

  const toggleReview = async () => {
    const next = !channel.kpiReview
    const question = next
      ? t(
          'Include #{name} in KPI insights?\n\nThe KPI agent will read messages here from people who have opted in. Everyone in the channel will see a badge saying so.',
          { name: channel.name },
        )
      : t('Stop including #{name} in KPI insights?', { name: channel.name })
    if (!window.confirm(question)) return
    try {
      await setChannelKpiReview(client, channel.id, next)
    } catch (err) {
      notify(errorText(err))
    }
  }

  const intro = (
    <div className="px-5 pb-4">
      <p className="text-xl font-bold text-stone-900"># {channel.name}</p>
      <p className="text-sm text-stone-500">
        {loaded
          ? `${t('This is the start of #{name}.', { name: channel.name })}${channel.about ? ` ${channel.about}` : ''}`
          : t('Loading messages…')}
      </p>
    </div>
  )

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <button
          onClick={onOpenSidebar}
          className="rounded p-1.5 text-stone-600 hover:bg-stone-100 md:hidden"
          aria-label={t('Open channel list')}
        >
          ☰
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold text-stone-900">
            {channel.kpiReview ? (
              <Lock aria-label={t('Work channel')} className="mr-1.5 inline size-4 -translate-y-px text-stone-400" />
            ) : (
              <span className="mr-1 font-normal text-stone-400">#</span>
            )}
            {channel.name}
          </h1>
          {channel.about && <p className="truncate text-xs text-stone-500">{channel.about}</p>}
        </div>
        <span
          title={
            channel.kpiReview
              ? t('The KPI agent reads messages here, only from people who have opted in.')
              : t('The KPI agent never reads this channel.')
          }
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
            channel.kpiReview
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-stone-200 bg-stone-50 text-stone-500'
          }`}
        >
          {channel.kpiReview ? t('KPI insights on') : t('Not reviewed')}
        </span>
        {isCreator && (
          <button onClick={toggleReview} className="shrink-0 text-xs font-medium text-sky-700 hover:underline">
            {channel.kpiReview ? t('Turn off') : t('Turn on')}
          </button>
        )}
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
        placeholder={t('Message #{name}', { name: channel.name })}
        onSend={(text) => sendMessage(client, channel.id, text)}
        onCommand={onCommand}
        suggest={suggest}
      />
    </section>
  )
}
