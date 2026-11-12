// The public landing page, shown at / to anyone not signed in. "Try now" opens
// the login page on Create account (#/signup), "Log in" on Log in (#/login).
//
// The hero is a live demo drawn in the app's own UI (landing/HeroDemo.tsx), and a
// small cast of kopi-shop mascots (landing/Cups.tsx) stands for kinds of work.
// The screenshots in public/landing are
// real captures of the demo data, one per theme (name-light.webp,
// name-dark.webp, 1920x1200). Re-capture them when the screens they show change.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowRight, CalendarDays, Check, Lock, MessageSquareDashed, ShieldCheck, UserCheck } from 'lucide-react'
import { usePrefs, useT } from '../lib/prefs'
import { cn } from '../lib/utils'
import { Logo } from './Logo'
import { PillHeader } from './PillHeader'
import { SettingsMenu } from './PrefsControls'
import { HeroDemo } from './landing/HeroDemo'
import { Espresso, Kopi, KopiAis, TehTarik } from './landing/Cups'
import { ClayLandscape } from './ui/clay-landscape'

const EASE_OUT = [0.215, 0.61, 0.355, 1] as const
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'
const primary = `inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-600 px-7 text-[15px] font-semibold text-on-brand transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] ${focusRing}`
const secondary = `inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black/[0.05] px-6 text-[15px] font-semibold text-gray-900 transition-colors hover:bg-black/[0.09] ${focusRing}`
const container = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8'
const h2 = 'text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-5xl'

const series = (i: number) => `var(--series-${i + 1})`

/**
 * The cast: four drinks for four of the Software Engineer level's KPI items, in
 * that item's chart colour. Drink and item names are never translated; `line` is.
 */
const CAST = [
  { Cup: Espresso, name: 'Espresso', line: 'Small, quick, and ships it.', item: 'Technical Delivery', colour: series(0) },
  { Cup: KopiAis, name: 'Kopi Ais', line: 'Stays cool when things break.', item: 'Problem Solving', colour: series(1) },
  { Cup: Kopi, name: 'Kopi', line: 'Says it, then does it.', item: 'Accountability', colour: series(3) },
  { Cup: TehTarik, name: 'Teh Tarik', line: 'Pulls the team together.', item: 'Collaboration', colour: series(4) },
]
/** The level's other items, shown as chips under the cast. */
const MORE_ITEMS = [
  { item: 'Continuous Improvement', colour: series(2) },
  { item: 'Communication', colour: series(5) },
  { item: 'Leadership & Mentorship', colour: series(6) },
]

/** Soft brand and milk-tea glows drifting behind the header and hero. */
function Aurora() {
  const still = useReducedMotion()
  const glows = [
    { className: 'top-[-14%] left-[6%] size-[560px] bg-brand-500/25', drift: { x: [0, 90], y: [0, 50] }, duration: 15 },
    { className: 'top-[0%] right-[2%] size-[480px] bg-gray-400/35', drift: { x: [0, -80], y: [0, 70] }, duration: 18 },
    { className: 'top-[24%] left-[36%] size-[440px] bg-brand-300/30', drift: { x: [0, 60], y: [0, -60] }, duration: 12 },
  ]
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1000px] overflow-hidden [mask-image:linear-gradient(black_50%,transparent)]">
      {glows.map(({ className, drift, duration }) => (
        <motion.div
          key={className}
          className={`absolute rounded-full blur-[90px] ${className}`}
          animate={still ? undefined : drift}
          transition={{ duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

/** A highlighter stroke that sweeps across a word, the way the agent marks a message as evidence. */
function Highlight({ children }: { children: ReactNode }) {
  const still = useReducedMotion()
  return (
    <span className="relative isolate inline-block">
      <motion.span
        aria-hidden
        className="absolute inset-x-[-0.1em] top-[0.2em] bottom-[0.02em] -z-10 origin-left -skew-x-6 rounded-[0.14em] bg-brand-500/25"
        initial={still ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.7 }}
      />
      {children}
    </span>
  )
}

/** Fades its children up the first time they scroll into view. */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const still = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  )
}

/** A product screenshot in a simple browser frame, matching the current theme. */
function Shot({ name, alt }: { name: string; alt: string }) {
  const { theme } = usePrefs()
  return (
    <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_30px_70px_-30px_rgb(17_12_8/0.45)] ring-1 ring-black/10">
      <div aria-hidden className="flex h-8 items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3.5">
        <span className="size-2.5 rounded-full bg-gray-300" />
        <span className="size-2.5 rounded-full bg-gray-300" />
        <span className="size-2.5 rounded-full bg-gray-300" />
      </div>
      <img
        src={`/landing/${name}-${theme === 'kopi-o' ? 'dark' : 'light'}.webp`}
        alt={alt}
        width={1920}
        height={1200}
        className="block h-auto w-full"
      />
    </div>
  )
}

/** One tile of the bento grid. */
function Tile({ title, text, children, className }: { title: string; text: string; children: ReactNode; className?: string }) {
  return (
    <Reveal className={cn('flex flex-col overflow-hidden rounded-[28px] bg-gray-50 p-6 ring-1 ring-gray-200/80 sm:p-8', className)}>
      <h3 className="text-xl font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 leading-relaxed text-gray-600">{text}</p>
      <div aria-hidden className="mt-6 flex flex-1 flex-col justify-end">
        {children}
      </div>
    </Reveal>
  )
}

/** A KPI insights switch that flips on and off by itself, and Kopi, who wakes up with it. */
function ConsentToy() {
  const t = useT()
  const still = useReducedMotion()
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (still) return
    const timer = setInterval(() => setOn((v) => !v), 2600)
    return () => clearInterval(timer)
  }, [still])
  return (
    <div className="flex flex-col items-center gap-5">
      <Kopi mood={on ? 'happy' : 'asleep'} accent={on ? 'var(--color-brand-500)' : 'var(--color-gray-300)'} className="size-[120px]" />
      <div className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-gray-200">
        <span className="flex size-9 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">MC</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">Maya Chen</span>
          <span className="block text-xs text-gray-500">{on ? t('KPI insights on') : t('KPI insights off')}</span>
        </span>
        <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-300 ${on ? 'bg-brand-600' : 'bg-gray-300'}`}>
          <span className={`size-5 rounded-full bg-on-brand shadow transition-transform duration-300 ${on ? 'translate-x-5' : ''}`} />
        </span>
      </div>
    </div>
  )
}

export function Landing() {
  const t = useT()
  const still = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const [screen, setScreen] = useState(0)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // The demo window starts tilted back and settles flat as it scrolls up.
  const demo = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: demo, offset: ['start end', 'start 35%'] })
  const rotateX = useTransform(scrollYProgress, [0, 1], [16, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1])

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth' })

  const screens = [
    {
      tab: t('Dashboard'),
      name: 'dashboard',
      alt: t('The team dashboard: evidence per KPI item as clay hills, and the team in numbers'),
      text: t("The whole team on one page: evidence per KPI item, who to review next, and each person's page a click away."),
    },
    {
      tab: t('Chat'),
      name: 'chat',
      alt: t("A channel, with a person's KPI review open beside the conversation"),
      text: t.rich("Type {cmd} in any channel and that person's review opens beside the conversation, visible only to you.", {
        cmd: <code className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[0.9em] text-gray-900">/kpi-&lt;name&gt;</code>,
      }),
    },
    {
      tab: t('Person'),
      name: 'profile',
      alt: t("A person's page: summary, KPI items with weights, and evidence over time"),
      text: t('Each person gets a summary, highlights and things to talk about. Never a score.'),
    },
    {
      tab: t('Booking'),
      name: 'booking',
      alt: t('Booking a performance review from the suggested reviews'),
      text: t('Book, reschedule or cancel a review in a few clicks. The person sees it on their own page.'),
    },
  ]

  const promises = [
    {
      Icon: UserCheck,
      title: t('Opt-in only'),
      text: t('Nobody is read until they turn KPI insights on themselves, and they can turn it off at any time.'),
    },
    {
      Icon: Lock,
      title: t('Work channels only'),
      text: t('The agent reads only channels marked for KPI insights. Everything else is never read.'),
    },
    {
      Icon: MessageSquareDashed,
      title: t('No scores, no rankings'),
      text: t('Evidence to talk about, never a score or a leaderboard. No weaknesses are written.'),
    },
    {
      Icon: ShieldCheck,
      title: t('Private reports'),
      text: t('Each person sees their own report. Only managers see the team.'),
    },
  ]

  return (
    <div className="relative isolate min-h-dvh overflow-x-clip bg-white text-gray-900">
      <Aurora />

      <PillHeader scrolled={scrolled}>
        <a href="#/" aria-label="Stooges" className={`shrink-0 rounded-lg ${focusRing}`}>
          <Logo className="h-8" />
        </a>
        <nav aria-label={t('Main')} className="ml-4 hidden items-center gap-1 md:flex">
          {[
            ['features', t('Features')],
            ['tour', t('Tour')],
            ['privacy', t('Privacy')],
          ].map(([id, label]) => (
            <button key={id} onClick={() => scrollTo(id)} className={`rounded-full px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 ${focusRing}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <SettingsMenu />
          <a href="#/login" className={`hidden rounded-full px-3 py-2 text-sm font-semibold text-gray-700 hover:text-gray-900 sm:inline-flex ${focusRing}`}>
            {t('Log in')}
          </a>
          <a href="#/signup" className={cn(primary, 'h-10 px-5 text-sm')}>
            {t('Try now')}
          </a>
        </div>
      </PillHeader>

      <main>
        {/* Hero */}
        <section className={`${container} pt-14 text-center sm:pt-20`}>
          <Reveal>
            <h1 className="mx-auto mt-6 max-w-4xl text-[52px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[96px]">
              {t.rich('Good work {mascot} gets {noticed}', {
                noticed: <Highlight>{t('noticed')}</Highlight>,
                mascot: (
                  <motion.img
                    src="/logo-mark.png"
                    alt=""
                    className="mx-[0.06em] inline-block h-[0.86em] w-auto align-[-0.1em]"
                    animate={still ? undefined : { rotate: [0, -10, 8, 0], y: [0, -4, 0] }}
                    transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1.4 }}
                  />
                ),
              })}
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-gray-700 sm:text-xl">
              {t('Your team talks in channels. Stooges spots the good work and keeps it as evidence for reviews.')}
            </p>
            <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium text-gray-600">
              {[t('Opt-in only'), t('Work channels only'), t('No scores, no rankings')].map((promise) => (
                <li key={promise} className="flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand-600 text-on-brand">
                    <Check aria-hidden className="size-3" strokeWidth={3} />
                  </span>
                  {promise}
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <a href="#/signup" className={primary}>
                {t('Try now')}
                <ArrowRight aria-hidden className="size-4" />
              </a>
              <button onClick={() => scrollTo('features')} className={secondary}>
                {t('See how it works')}
              </button>
            </div>
          </Reveal>

          <div ref={demo} className="mx-auto mt-16 max-w-5xl [perspective:1400px] sm:mt-20">
            <motion.div style={still ? undefined : { rotateX, scale, transformOrigin: '50% 0%' }}>
              <HeroDemo />
            </motion.div>
          </div>
        </section>

        {/* The cast: a drink per kind of work. */}
        <section className={`${container} py-24 sm:py-32`}>
          <Reveal className="grid gap-6 lg:grid-cols-2 lg:gap-16">
            <h2 className={h2}>{t('Every kind of work counts')}</h2>
            <div className="space-y-4 text-lg leading-relaxed text-gray-700">
              <p>
                {t("Shipping a feature, unblocking a teammate, flagging a risk early. The KPI agent files each one under your framework's KPI items, with a link back to the message.")}
              </p>
              <p>{t('Managers walk into reviews with real examples. People see the same evidence about themselves.')}</p>
            </div>
          </Reveal>
          <ul className="mt-16 grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-4">
            {CAST.map(({ Cup, name, line, item, colour }, i) => (
              <motion.li
                key={name}
                className="flex flex-col items-center text-center"
                initial={still ? false : { opacity: 0, y: 40, rotate: i % 2 ? 8 : -8 }}
                whileInView={{ opacity: 1, y: 0, rotate: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ type: 'spring', stiffness: 180, damping: 14, delay: i * 0.08 }}
              >
                <Cup accent={colour} delay={i * 0.45} className="size-28 sm:size-36" />
                <h3 className="mt-5 text-lg font-semibold">{name}</h3>
                <p className="mt-1 text-gray-600">{t(line)}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                  <span className="size-2 rounded-sm" style={{ background: colour }} />
                  {item}
                </span>
              </motion.li>
            ))}
          </ul>
          <Reveal className="mt-12 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-500">
            {t('Also counted:')}
            {MORE_ITEMS.map(({ item, colour }) => (
              <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                <span className="size-2 rounded-sm" style={{ background: colour }} />
                {item}
              </span>
            ))}
          </Reveal>
        </section>

        {/* Bento */}
        <section id="features" aria-labelledby="features-heading" className={`${container} scroll-mt-24`}>
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 id="features-heading" className={h2}>
              {t('Everything a manager needs')}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-gray-600">
              {t('Evidence for every KPI item, a nudge when a review is due, and the person in the loop the whole way.')}
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            <Tile
              className="lg:col-span-2"
              title={t('The team at a glance')}
              text={t("One clay hill per KPI item, as tall as the team's evidence for it.")}
            >
              <ClayLandscape
                hills={[0.4, 0.6, 0.45, 1, 0.35, 0.55, 0.75].map((value, i) => ({ value, color: series(i) }))}
                ground="var(--color-gray-200)"
                className="-mx-6 -mb-6 h-64 sm:-mx-8 sm:-mb-8 sm:h-80"
              />
            </Tile>

            <Tile title={t('Opt in, opt out, any time')} text={t('Nobody is read until they switch KPI insights on themselves.')}>
              <ConsentToy />
            </Tile>

            <Tile title={t('Every finding cites a message')} text={t('Each finding must quote something the person wrote, or it is dropped.')}>
              <div className="space-y-2">
                <div className="rounded-2xl bg-white p-3.5 text-sm ring-1 ring-gray-200">
                  <p>
                    <span className="font-semibold">Ravi Kumar</span> <span className="text-xs text-gray-500">2:41 PM · #platform-infra</span>
                  </p>
                  <p className="mt-1 leading-relaxed text-gray-800">
                    <mark className="rounded bg-[color-mix(in_oklab,var(--series-5)_22%,transparent)] px-0.5 text-gray-900">Pairing with Leo on the flaky checkout tests</mark>{' '}
                    this afternoon, then I'll write up what we found.
                  </p>
                </div>
                <div className="ml-6 flex items-center gap-2 rounded-2xl bg-white p-3 text-sm ring-1 ring-gray-200">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: series(4) }} />
                  <span className="font-semibold">Collaboration</span>
                  <span className="truncate text-gray-600">· Paired on flaky tests</span>
                </div>
              </div>
            </Tile>

            <Tile title={t('Know who to review next')} text={t('A nudge when a review is overdue or there is no chat evidence yet. Never a ranking.')}>
              <ul className="space-y-2">
                {[
                  ['BO', 'Ben Ortiz', t('No review on record')],
                  ['HY', 'Hana Yusof', t('No chat evidence this period')],
                ].map(([initials, name, why]) => (
                  <li key={name} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-gray-200">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">{initials}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{name}</span>
                      <span className="block text-xs text-gray-500">{why}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-on-brand">{t('Book review')}</span>
                  </li>
                ))}
              </ul>
            </Tile>

            <Tile title={t('Booked, and they see it too')} text={t("The review shows up on the person's own page, with your note.")}>
              <div className="flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-gray-200">
                <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-600 py-2 text-on-brand">
                  <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">Nov</span>
                  <span className="text-2xl leading-none font-semibold">19</span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <CalendarDays className="size-4 text-brand-600" />
                    {t('Performance review')}
                  </span>
                  <span className="block text-xs text-gray-500">Sara Lim · 10:00</span>
                  <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-gray-700">
                    Q4 review. Bring two pieces of work you're proud of and one area you'd like to grow in.
                  </span>
                </span>
              </div>
            </Tile>
          </div>
        </section>

        {/* Tour: real screenshots behind pill tabs. */}
        <section id="tour" aria-labelledby="tour-heading" className={`${container} scroll-mt-24 py-24 sm:py-32`}>
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
            <Reveal className="lg:col-span-4">
              <h2 id="tour-heading" className={h2}>
                {t('Take a look around')}
              </h2>
              <div role="tablist" aria-label={t('Screens')} className="mt-8 flex flex-wrap gap-2">
                {screens.map((s, i) => (
                  <button
                    key={s.name}
                    role="tab"
                    id={`tour-tab-${s.name}`}
                    aria-selected={screen === i}
                    aria-controls="tour-panel"
                    onClick={() => setScreen(i)}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors',
                      focusRing,
                      screen === i ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'text-gray-600 ring-gray-200 hover:text-gray-900',
                    )}
                  >
                    {s.tab}
                  </button>
                ))}
              </div>
              <p className="mt-8 min-h-[5.5rem] text-lg leading-relaxed text-gray-700">{screens[screen].text}</p>
              <a href="#/signup" className={cn(secondary, 'mt-6')}>
                {t('Try it yourself')}
                <ArrowRight aria-hidden className="size-4" />
              </a>
            </Reveal>
            <Reveal className="lg:col-span-8" delay={0.1}>
              <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${screens[screen].name}`}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={screens[screen].name}
                    initial={still ? false : { opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={still ? undefined : { opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: EASE_OUT }}
                  >
                    <Shot name={screens[screen].name} alt={screens[screen].alt} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" aria-labelledby="privacy-heading" className={`${container} scroll-mt-24`}>
          <Reveal className="text-center">
            <h2 id="privacy-heading" className={h2}>
              {t('Built for trust')}
            </h2>
          </Reveal>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {promises.map(({ Icon, title, text }, i) => (
              <motion.li
                key={title}
                className="rounded-[28px] bg-gray-50 p-7 ring-1 ring-gray-200/80"
                initial={still ? false : { opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.7, ease: EASE_OUT, delay: i * 0.06 }}
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-600 text-on-brand">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 leading-relaxed text-gray-600">{text}</p>
              </motion.li>
            ))}
          </ul>
        </section>

        {/* Call to action, with Kopi peeking over the top. */}
        <section className={`${container} pt-32 pb-24 sm:pt-40`}>
          <div className="relative">
            <Kopi mood="curious" accent="var(--color-brand-500)" className="absolute right-[10%] -top-[62px] size-24 sm:-top-[83px] sm:size-32" />
            <Reveal className="relative overflow-hidden rounded-[32px] bg-brand-600 px-6 py-16 text-center text-on-brand sm:px-12 sm:py-20">
              <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-on-brand/15 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -top-28 -right-20 size-80 rounded-full bg-brand-300/40 blur-3xl" />
              <h2 className="relative text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">{t('Try it with your team')}</h2>
              <p className="relative mx-auto mt-4 max-w-xl text-lg text-on-brand/85">{t('Create an account in a few seconds, or log in if you have one.')}</p>
              <div className="relative mt-9 flex flex-wrap justify-center gap-3">
                {/* White on the blue band; brand-600 stays dark blue in both themes, so it reads on white. */}
                <a href="#/signup" className={cn(primary, 'bg-on-brand text-brand-600')}>
                  {t('Try now')}
                  <ArrowRight aria-hidden className="size-4" />
                </a>
                <a href="#/login" className={`inline-flex h-12 items-center rounded-full px-6 text-[15px] font-semibold text-on-brand ring-1 ring-on-brand/40 hover:bg-on-brand/10 ${focusRing}`}>
                  {t('Log in')}
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200">
        <div className={`${container} py-8`}>
          <Logo className="h-6" />
        </div>
      </footer>
    </div>
  )
}
