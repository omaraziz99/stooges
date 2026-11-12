import { useEffect, useRef, useState } from 'react'
import { ChartColumn, EllipsisVertical, EyeOff, Lock, Star, Trash2, Undo2, Users } from 'lucide-react'
import { deleteChannel, errorText, sendMessage, setChannelKpiReview, type Channel, type ChannelState } from '../lib/chat'
import { useT } from '../lib/prefs'
import { useStars } from '../lib/stars'
import { useNotify, useRelay } from '../state/relay'
import { Composer, type Suggestion } from './Composer'
import { ConfirmDialog } from './ConfirmDialog'
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
  const { stars, toggle: toggleStar } = useStars(pubkey)
  const starred = stars.has(channel.id)
  const [asking, setAsking] = useState<'review' | 'delete' | null>(null)
  const stopAsking = () => setAsking(null)

  const toggleReview = async () => {
    try {
      await setChannelKpiReview(client, channel.id, !channel.kpiReview)
    } catch (err) {
      notify(errorText(err))
    }
  }

  const removeChannel = async () => {
    try {
      await deleteChannel(client, channel.id)
    } catch (err) {
      notify(errorText(err))
    }
  }

  const intro = (
    <div className="px-5 pb-4">
      <p className="text-xl font-bold text-gray-900"># {channel.name}</p>
      <p className="text-sm text-gray-500">
        {loaded
          ? `${t('This is the start of #{name}.', { name: channel.name })}${channel.about ? ` ${channel.about}` : ''}`
          : t('Loading messages…')}
      </p>
    </div>
  )

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4">
        <button
          onClick={onOpenSidebar}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-100 md:hidden"
          aria-label={t('Open channel list')}
        >
          ☰
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-[17px] font-semibold text-gray-900">
            {channel.kpiReview ? (
              <Lock aria-label={t('Work channel')} className="mr-1.5 inline size-4 -translate-y-px text-gray-400" />
            ) : (
              <span className="mr-1 font-normal text-gray-400">#</span>
            )}
            {channel.name}
          </h1>
          <button
            onClick={() => toggleStar(channel.id)}
            aria-pressed={starred}
            aria-label={starred ? t('Unstar channel') : t('Star channel')}
            title={starred ? t('Unstar channel') : t('Star channel')}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <Star aria-hidden className={`size-4 ${starred ? 'fill-brand-500 text-brand-500' : ''}`} />
          </button>
          </div>
          {channel.about && <p className="truncate text-xs text-gray-500">{channel.about}</p>}
        </div>
        <span
          title={
            channel.kpiReview
              ? t('The KPI agent reads messages here, only from people who have opted in.')
              : t('The KPI agent never reads this channel.')
          }
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
            channel.kpiReview
              ? 'border-brand-200 bg-brand-50 text-brand-800'
              : 'border-gray-200 bg-gray-50 text-gray-500'
          }`}
        >
          {channel.kpiReview ? t('KPI insights on') : t('Not reviewed')}
        </span>
        {isCreator && (
          <button onClick={() => setAsking('review')} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
            {channel.kpiReview ? t('Turn off') : t('Turn on')}
          </button>
        )}
        <ChannelMenu starred={starred} onToggleStar={() => toggleStar(channel.id)} onDelete={() => setAsking('delete')} />
      </header>

      {asking === 'review' &&
        (channel.kpiReview ? (
          <ConfirmDialog
            icon={ChartColumn}
            title={t('Stop including #{name} in KPI insights?', { name: channel.name })}
            points={[
              [EyeOff, t('The agent stops reading this channel from its next run')],
              [Undo2, t('You can turn it back on at any time')],
            ]}
            cancelLabel={t('Keep it on')}
            confirmLabel={t('Turn off')}
            onConfirm={toggleReview}
            onClose={stopAsking}
          />
        ) : (
          <ConfirmDialog
            icon={ChartColumn}
            title={t('Include #{name} in KPI insights?', { name: channel.name })}
            points={[
              [Lock, t('The agent reads messages here only from people who opted in')],
              [Users, t('Everyone in the channel sees a "KPI insights on" badge')],
              [Undo2, t('You can turn it off at any time')],
            ]}
            cancelLabel={t('Not now')}
            confirmLabel={t('Turn on')}
            onConfirm={toggleReview}
            onClose={stopAsking}
          />
        ))}
      {asking === 'delete' && (
        <ConfirmDialog
          danger
          icon={Trash2}
          title={t('Delete #{name}?', { name: channel.name })}
          description={t('Every message in it is deleted for everyone. This cannot be undone.')}
          cancelLabel={t('Cancel')}
          confirmLabel={t('Delete channel')}
          onConfirm={removeChannel}
          onClose={stopAsking}
        />
      )}

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
        onSend={(text, files) => sendMessage(client, channel.id, text, undefined, files)}
        onCommand={onCommand}
        suggest={suggest}
      />
    </section>
  )
}

/** The ⋯ channel settings menu: star and delete. */
function ChannelMenu({
  starred,
  onToggleStar,
  onDelete,
}: {
  starred: boolean
  onToggleStar: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-black/5'
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Channel settings')}
        title={t('Channel settings')}
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      >
        <EllipsisVertical aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-48 rounded-xl bg-white p-1 shadow-lg ring-1 ring-black/10"
        >
          <button role="menuitem" className={`${item} text-gray-800`} onClick={run(onToggleStar)}>
            <Star aria-hidden className={`size-4 ${starred ? 'fill-brand-500 text-brand-500' : 'text-gray-500'}`} />
            {starred ? t('Unstar channel') : t('Star channel')}
          </button>
          <div role="separator" className="my-1 border-t border-gray-200" />
          <button role="menuitem" className={`${item} text-rose-700`} onClick={run(onDelete)}>
            <Trash2 aria-hidden className="size-4" />
            {t('Delete channel')}
          </button>
        </div>
      )}
    </div>
  )
}
