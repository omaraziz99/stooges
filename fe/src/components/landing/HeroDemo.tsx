// The landing page's live demo: a small, looping story in the app's own UI.
// Messages arrive in #project-orbit, the KPI agent reads them and files Maya's
// under Accountability, someone types /kpi-maya, and her review slides in.
// With reduced motion it shows the last frame, still.
import { useEffect, useState, type ReactNode } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { Check, Hash, Lock, Paperclip, ArrowUp } from 'lucide-react'
import { useT } from '../../lib/prefs'

const LOOP = 13_000 // ms
const TICK = 100
const COMMAND = '/kpi-maya'
const FINAL = 9_500 // a moment in the loop with everything on screen

const appear = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.35 } }

function Message({ initials, name, time, children }: { initials: string; name: string; time: string; children: ReactNode }) {
  return (
    <motion.div {...appear} className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
        {initials}
      </span>
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-semibold text-gray-900">{name}</span> <span className="text-xs text-gray-500">{time}</span>
        </p>
        {children}
      </div>
    </motion.div>
  )
}

export function HeroDemo() {
  const t = useT()
  const still = useReducedMotion()
  const [ms, setMs] = useState(still ? FINAL : 0)

  useEffect(() => {
    if (still) return setMs(FINAL)
    const timer = setInterval(() => setMs((v) => (v + TICK) % LOOP), TICK)
    return () => clearInterval(timer)
  }, [still])

  const nora = ms >= 600
  const maya = ms >= 1600
  const reaction = ms >= 2300
  const reading = ms >= 3000 && ms < 4600
  const filed = ms >= 4600
  const typed = ms >= 7600 ? '' : COMMAND.slice(0, Math.max(0, Math.floor((ms - 5600) / 110)))
  const suggesting = ms >= 6700 && ms < 7600
  const panel = ms >= 7600
  const leaving = ms >= LOOP - 600 // fade everything before the loop starts over

  const channels: [string, boolean][] = [
    ['design-system', true],
    ['lunch-club', false],
    ['platform-infra', true],
    ['project-orbit', true],
    ['weekend-hikers', false],
  ]

  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-[22px] bg-white text-left shadow-[0_40px_120px_-40px_rgb(9_92_226/0.45),0_20px_50px_-30px_rgb(17_12_8/0.5)] ring-1 ring-black/10"
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-4">
        <span className="size-2.5 rounded-full bg-gray-300" />
        <span className="size-2.5 rounded-full bg-gray-300" />
        <span className="size-2.5 rounded-full bg-gray-300" />
      </div>

      <div className={`flex h-[420px] transition-opacity duration-500 sm:h-[460px] ${leaving ? 'opacity-0' : 'opacity-100'}`}>
        {/* Sidebar */}
        <div className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50/60 p-3 md:flex">
          <p className="px-2 pt-1 pb-2 text-xs font-medium text-gray-500">{t('Channels')}</p>
          {channels.map(([name, work]) => (
            <span
              key={name}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${name === 'project-orbit' ? 'bg-black/[0.06] font-semibold text-gray-900' : 'text-gray-700'}`}
            >
              {work ? <Lock className="size-3.5 text-gray-500" /> : <Hash className="size-3.5 text-gray-500" />}
              {name}
            </span>
          ))}
        </div>

        {/* Channel */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-4">
            <Lock className="size-4 text-gray-500" />
            <span className="font-semibold text-gray-900">project-orbit</span>
            <span className="ml-auto rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
              {t('KPI insights on')}
            </span>
          </div>

          <div className="flex-1 space-y-4 overflow-hidden px-4 py-4">
            <AnimatePresence>
              {nora && (
                <Message key="nora" initials="NA" name="Nora Ahmad" time="9:05 AM">
                  <p className="text-sm leading-relaxed text-gray-800">
                    Release plan for Orbit 2.0: code freeze 10 Oct, launch 24 Oct. Who owns search?
                  </p>
                </Message>
              )}
              {maya && (
                <Message key="maya" initials="MC" name="Maya Chen" time="9:12 AM">
                  <p
                    className={`rounded-lg text-sm leading-relaxed text-gray-800 transition-shadow duration-500 ${filed ? 'shadow-[0_0_0_6px_color-mix(in_oklab,var(--series-4)_18%,transparent)]' : ''}`}
                  >
                    I'll take search. Also flagging a risk: the new ranking needs a reindex that takes ~3h on prod data.
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {reaction && (
                      <motion.span {...appear} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs">
                        👍 3
                      </motion.span>
                    )}
                    {filed && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800"
                      >
                        <span className="size-2 rounded-sm" style={{ background: 'var(--series-4)' }} />
                        {t('Filed under {item}', { item: 'Accountability' })}
                        <Check className="size-3 text-brand-600" />
                      </motion.span>
                    )}
                  </div>
                </Message>
              )}
            </AnimatePresence>
            {reading && (
              <motion.p {...appear} className="flex items-center gap-2 pl-11 text-sm text-gray-500">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
                </span>
                {t('KPI agent is reading #project-orbit…')}
              </motion.p>
            )}
          </div>

          {/* Composer, with the /kpi suggestion above it */}
          <div className="relative shrink-0 px-4 pb-4">
            <AnimatePresence>
              {suggesting && (
                <motion.div
                  {...appear}
                  className="absolute right-4 bottom-full left-4 mb-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
                >
                  <div className="flex items-baseline justify-between gap-3 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm">
                    <span>
                      <span className="font-mono text-gray-900">/kpi-maya-chen</span>
                      <span className="ml-2 text-gray-500">{t('KPI review for {name}', { name: 'Maya Chen' })}</span>
                    </span>
                    <span className="text-xs text-gray-400">{t('{n} items', { n: 4 })}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5">
              <Paperclip className="size-4 text-gray-400" />
              <span className="flex-1 truncate font-mono text-sm text-gray-900">
                {typed || <span className="font-sans text-gray-400">{t('Message #{name}', { name: 'project-orbit' })}</span>}
                {typed && <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-gray-900" />}
              </span>
              <span className={`flex size-7 items-center justify-center rounded-full ${typed ? 'bg-brand-600 text-on-brand' : 'bg-gray-200 text-gray-400'}`}>
                <ArrowUp className="size-4" />
              </span>
            </div>
          </div>

          {/* The review, sliding in from the right */}
          <AnimatePresence>
            {panel && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-gray-200 bg-white sm:w-[300px]"
              >
                <div className="border-b border-gray-200 px-4 py-3">
                  <p className="font-semibold text-gray-900">{t('KPI review · {name}', { name: 'Maya Chen' })}</p>
                  <p className="text-xs text-gray-500">{t('Only visible to you')}</p>
                </div>
                <div className="space-y-3 p-4">
                  <div className="rounded-xl bg-brand-600 p-4 text-on-brand">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-on-brand/75 uppercase">{t('AI-drafted summary')}</p>
                    <p className="mt-2 text-[15px] leading-snug font-semibold">Takes ownership and flags risks early</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
                      <span className="size-2 rounded-sm" style={{ background: 'var(--series-4)' }} />
                      Accountability
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-700">Took search for Orbit 2.0 and raised the reindex risk before launch.</p>
                    <span className="mt-2 inline-block rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600">
                      Oct 6 · #project-orbit
                    </span>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-gray-500 uppercase">{t('Discussion points')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-700">What would help you keep spotting risks this early?</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
