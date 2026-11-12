// The landing page's cast of kopi-shop mascots. Kopi is the cup that hops beside
// the hills on the team dashboard (ui/clay-landscape.tsx); the others are its
// friends, each with a look and a habit of its own. Decorative only, and still
// when the visitor asks for reduced motion.
import type { ReactNode } from 'react'
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react'

const PORCELAIN = '#fff3e0'
const COFFEE = '#6b3b22'
const INK = '#1a1410'
const BLUSH = '#ff8fab'
const EDGE = 'rgb(0 0 0 / 0.12)'
const GLASS = 'rgb(255 255 255 / 0.5)'
const GLASS_EDGE = 'rgb(0 0 0 / 0.22)'

/** Transforms around the bottom middle of a group, so cups squash and sway on the table. */
const fromBottom = { transformBox: 'fill-box', transformOrigin: '50% 100%' } as const
const fromCentre = { transformBox: 'fill-box', transformOrigin: 'center' } as const

type CupProps = { accent: string; className?: string; delay?: number }

/** An animation that repeats forever, or nothing at all with reduced motion. */
function useLoop() {
  const still = useReducedMotion()
  return (animate: TargetAndTransition, transition: Transition) =>
    still ? {} : { animate, transition: { repeat: Infinity, ...transition } }
}

function Frame({ className = '', children }: { className?: string; children: ReactNode }) {
  const still = useReducedMotion()
  return (
    <motion.svg
      viewBox="0 0 120 120"
      aria-hidden
      className={`overflow-visible ${className}`}
      whileHover={still ? undefined : { rotate: [0, -8, 6, 0], transition: { duration: 0.5 } }}
    >
      {children}
    </motion.svg>
  )
}

const Shadow = ({ rx = 30 }: { rx?: number }) => <ellipse cx="60" cy="108" rx={rx} ry="4.5" fill="black" opacity="0.12" />

const Blush = ({ y, spread = 23 }: { y: number; spread?: number }) => (
  <>
    <ellipse cx={60 - spread} cy={y} rx="6" ry="3.4" fill={BLUSH} opacity="0.85" />
    <ellipse cx={60 + spread} cy={y} rx="6" ry="3.4" fill={BLUSH} opacity="0.85" />
  </>
)

function Blink({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const loop = useLoop()
  return (
    <motion.g style={fromCentre} {...loop({ scaleY: [1, 1, 0.1, 1] }, { duration: 4.2, times: [0, 0.93, 0.965, 1], delay })}>
      {children}
    </motion.g>
  )
}

/**
 * Kopi: the porcelain mug from the dashboard, with a band in its accent colour.
 * Happy, it hops and steams; asleep, it snores; curious, it looks around.
 */
export function Kopi({ accent, className, delay = 0, mood = 'happy' }: CupProps & { mood?: 'happy' | 'asleep' | 'curious' }) {
  const loop = useLoop()
  const hop = loop({ y: [0, -10, 0, 0], scaleY: [1, 1.04, 0.92, 1], scaleX: [1, 0.97, 1.06, 1] }, { duration: 1, times: [0, 0.4, 0.72, 1], repeatDelay: 2.6, delay })
  return (
    <Frame className={className}>
      <Shadow />
      <motion.g style={fromBottom} {...(mood === 'happy' ? hop : {})}>
        {mood === 'happy' &&
          [46, 60, 74].map((x, i) => (
            <motion.path
              key={x}
              d={`M${x} 22 q-5 -6 0 -11 q5 -5 0 -10`}
              fill="none"
              stroke="var(--color-gray-400)"
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity={0.6}
              {...loop({ opacity: [0, 0.7, 0], y: [6, -6] }, { duration: 2.4, delay: delay + i * 0.5, ease: 'easeOut' })}
            />
          ))}
        {mood === 'asleep' &&
          [0, 1, 2].map((i) => (
            <motion.text
              key={i}
              x={82 + i * 7}
              y={26 - i * 9}
              fontSize={11 + i * 3}
              fontWeight="700"
              fill="var(--color-gray-500)"
              opacity={0.7}
              {...loop({ opacity: [0, 1, 0], y: [6, -8] }, { duration: 2.4, delay: i * 0.7, ease: 'easeOut' })}
            >
              z
            </motion.text>
          ))}

        {/* Handle, then the tapered mug over its ends. */}
        <path d="M91 52 C111 51 111 84 87 84" fill="none" stroke={PORCELAIN} strokeWidth="9" strokeLinecap="round" />
        <path d="M24 36 L31 94 Q32 102 40 102 H80 Q88 102 89 94 L96 36 Z" fill={PORCELAIN} stroke={EDGE} strokeWidth="1.2" />
        <path d="M29.6 84 H90.4 L89.6 91 H30.4 Z" style={{ fill: accent }} className="transition-[fill] duration-500" />
        <path d="M80 36 H96 L89 94 Q88 102 80 102 H74 Q83 70 80 36 Z" fill="black" opacity="0.06" />
        <ellipse cx="34" cy="60" rx="3.6" ry="14" fill="white" opacity="0.6" transform="rotate(-7 34 60)" />
        <ellipse cx="60" cy="36" rx="36" ry="9" fill={PORCELAIN} stroke={EDGE} strokeWidth="1.2" />
        <ellipse cx="60" cy="37" rx="30.5" ry="6.2" fill={COFFEE} />
        <ellipse cx="52" cy="35.6" rx="9" ry="1.8" fill="#a0643c" opacity="0.7" />

        {mood === 'asleep' ? (
          <>
            <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
              <path d="M42 62 Q47 66 52 62" />
              <path d="M68 62 Q73 66 78 62" />
            </g>
            <motion.ellipse cx="60" cy="74" rx="3" ry="3.4" fill={INK} style={fromCentre} {...loop({ scale: [0.7, 1.1, 0.7] }, { duration: 2.4, ease: 'easeInOut' })} />
          </>
        ) : mood === 'curious' ? (
          <>
            <g fill="white" stroke={INK} strokeWidth="1.2">
              <circle cx="47" cy="62" r="7" />
              <circle cx="73" cy="62" r="7" />
            </g>
            <motion.g {...loop({ x: [0, -3.5, -3.5, 3.5, 3.5, 0], y: [0, 0, 1, 1, 0, 0] }, { duration: 4.5, times: [0, 0.1, 0.4, 0.5, 0.85, 1], delay })}>
              <circle cx="47" cy="62" r="3.4" fill={INK} />
              <circle cx="73" cy="62" r="3.4" fill={INK} />
            </motion.g>
            <ellipse cx="60" cy="76" rx="2.6" ry="2.2" fill={INK} />
          </>
        ) : (
          <>
            <Blink delay={delay * 1.6}>
              <circle cx="47" cy="62" r="4.8" fill={INK} />
              <circle cx="73" cy="62" r="4.8" fill={INK} />
              <circle cx="48.6" cy="60.4" r="1.4" fill="white" />
              <circle cx="74.6" cy="60.4" r="1.4" fill="white" />
            </Blink>
            <path d="M55 71 Q60 76 65 71" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          </>
        )}
        <Blush y={72} />
      </motion.g>
    </Frame>
  )
}

/** Espresso: a tiny cup on a saucer, over-caffeinated. Wide eyes, jitters in bursts. */
export function Espresso({ accent, className, delay = 0 }: CupProps) {
  const loop = useLoop()
  const burst: Transition = { duration: 0.6, repeatDelay: 1.6, delay }
  return (
    <Frame className={className}>
      <Shadow rx={38} />
      <ellipse cx="60" cy="101" rx="40" ry="8" fill={PORCELAIN} stroke={EDGE} strokeWidth="1.2" />
      <ellipse cx="60" cy="99" rx="24" ry="4" fill="black" opacity="0.07" />
      <motion.g style={fromBottom} {...loop({ x: [0, -2.5, 2.5, -2.5, 2.5, -1, 0], y: [0, -4, 0, -3, 0, 0, 0] }, burst)}>
        {/* Zaps above its head, in time with the jitters. */}
        <motion.g
          style={fromBottom}
          fill="none"
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
          opacity={0.8}
          {...loop({ opacity: [0, 1, 1, 0], scale: [0.6, 1, 1, 0.8] }, burst)}
        >
          <path d="M60 38 V28" />
          <path d="M45 41 L39 33" />
          <path d="M75 41 L81 33" />
        </motion.g>
        <path d="M84 63 C99 62 99 85 79 85" fill="none" style={{ stroke: accent }} strokeWidth="6.5" strokeLinecap="round" />
        <path d="M34 54 L40 88 Q42 96 50 96 H70 Q78 96 80 88 L86 54 Z" style={{ fill: accent }} stroke={EDGE} strokeWidth="1.2" />
        <path d="M74 54 H86 L80 88 Q78 96 70 96 H68 Q76 76 74 54 Z" fill="black" opacity="0.1" />
        <ellipse cx="41" cy="66" rx="2.6" ry="8" fill="white" opacity="0.4" transform="rotate(-10 41 66)" />
        <ellipse cx="60" cy="54" rx="26" ry="6" style={{ fill: accent }} stroke={EDGE} strokeWidth="1.2" />
        <ellipse cx="60" cy="54.8" rx="22" ry="4.4" fill="#3b2014" />
        <ellipse cx="60" cy="54.8" rx="20" ry="3.6" fill="none" stroke="#b07a45" strokeWidth="1.6" opacity="0.8" />

        <g fill="white" stroke={INK} strokeWidth="1.2">
          <circle cx="50" cy="70" r="7" />
          <circle cx="70" cy="70" r="7" />
        </g>
        <motion.g {...loop({ x: [0, 2.5, -2.5, 0], y: [0, -1.5, 1, 0] }, { duration: 0.9, repeatDelay: 1.3, delay })}>
          <circle cx="50" cy="70" r="2.6" fill={INK} />
          <circle cx="70" cy="70" r="2.6" fill={INK} />
        </motion.g>
        <path d="M53 80 Q60 89 67 80 Z" fill={INK} />
        <Blush y={81} spread={19} />
      </motion.g>
    </Frame>
  )
}

/** Kopi Ais: an iced coffee to go, in sunglasses. Bobs about, straw wiggling, ice clinking. */
export function KopiAis({ accent, className, delay = 0 }: CupProps) {
  const loop = useLoop()
  return (
    <Frame className={className}>
      <Shadow />
      <motion.g style={fromBottom} {...loop({ y: [0, -4, 0], rotate: [-2, 2, -2] }, { duration: 3.2, ease: 'easeInOut', delay })}>
        {/* Straw, under the clear lid. */}
        <motion.g
          style={{ transformBox: 'view-box', transformOrigin: '64px 34px' }}
          {...loop({ rotate: [-5, 7, -5] }, { duration: 1.8, ease: 'easeInOut', delay })}
        >
          <path d="M64 40 L77 2" style={{ stroke: accent }} strokeWidth="6.5" strokeLinecap="round" />
          <path d="M64 40 L77 2" stroke="white" strokeWidth="6.5" strokeDasharray="3.5 5" opacity="0.75" />
        </motion.g>
        <path d="M30 34 L39 98 Q40 104 46 104 H74 Q80 104 81 98 L90 34 Z" fill={GLASS} stroke={GLASS_EDGE} strokeWidth="1.6" />
        <path d="M32.6 52 L39.8 97 Q41 102 46 102 H74 Q79 102 80.2 97 L87.4 52 Z" fill="#9a6644" />
        <ellipse cx="60" cy="52" rx="27.4" ry="3" fill="#c79a74" />
        <motion.g {...loop({ y: [0, -2, 0], rotate: [0, 4, 0] }, { duration: 2.2, ease: 'easeInOut', delay: delay + 0.4 })}>
          <rect x="39" y="40" width="14" height="14" rx="3" fill="white" opacity="0.75" transform="rotate(-12 46 47)" />
          <rect x="64" y="39" width="15" height="15" rx="3" fill="white" opacity="0.75" transform="rotate(10 71.5 46.5)" />
          <rect x="52" y="45" width="12" height="12" rx="3" fill="white" opacity="0.6" transform="rotate(30 58 51)" />
        </motion.g>
        {/* A sleeve in its accent colour, with the face on it. */}
        <path d="M33.9 62 H86.1 L82.4 88 H37.6 Z" style={{ fill: accent }} />
        <g fill={INK}>
          <rect x="40" y="66" width="16" height="9.5" rx="4" />
          <rect x="64" y="66" width="16" height="9.5" rx="4" />
        </g>
        <path d="M56 69 Q60 66.5 64 69" fill="none" stroke={INK} strokeWidth="2.4" />
        <motion.g
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity={0.6}
          {...loop({ opacity: [0, 0.9, 0], x: [-2, 4] }, { duration: 0.8, repeatDelay: 3, delay: delay + 1 })}
        >
          <path d="M44 73 L48 68" />
          <path d="M68 73 L72 68" />
        </motion.g>
        <path d="M54 81 Q61 85 67 79.5" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        {/* Condensation running down the cup. */}
        {[
          [36, 40],
          [86, 44],
        ].map(([x, y], i) => (
          <motion.circle
            key={x}
            cx={x}
            cy={y}
            r="1.8"
            fill="white"
            opacity={0.8}
            {...loop({ y: [0, 14], opacity: [0, 0.9, 0] }, { duration: 2.6, delay: delay + i * 1.3, ease: 'easeIn' })}
          />
        ))}
        <path d="M31 34 Q33 17 60 16 Q87 17 89 34 Z" fill="white" opacity="0.35" stroke={GLASS_EDGE} strokeWidth="1.6" />
        <ellipse cx="60" cy="34" rx="31" ry="4" fill="white" opacity="0.8" stroke={GLASS_EDGE} strokeWidth="1.6" />
      </motion.g>
    </Frame>
  )
}

/** Teh Tarik: a tall glass of pulled tea with a foamy head. Sways, beams, and now and then gets topped up from on high. */
export function TehTarik({ accent, className, delay = 0 }: CupProps) {
  const loop = useLoop()
  const TEA = '#c88a55'
  const FOAM = '#f7e9d6'
  return (
    <Frame className={className}>
      <ellipse cx="60" cy="109" rx="34" ry="4.5" fill="black" opacity="0.1" />
      <ellipse cx="60" cy="106" rx="32" ry="5.5" style={{ fill: accent }} />
      {/* The pull: a stream poured from high above. */}
      <motion.path
        d="M60 -24 C61 -6 59 6 60 24"
        fill="none"
        stroke={TEA}
        strokeWidth="4.5"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        {...loop({ pathLength: [0, 1, 1, 1], opacity: [1, 1, 1, 0] }, { duration: 1.6, times: [0, 0.3, 0.75, 1], repeatDelay: 3, delay })}
      />
      <motion.g style={fromBottom} {...loop({ rotate: [-4, 4, -4] }, { duration: 2.8, ease: 'easeInOut', delay })}>
        <path d="M34 20 L39.5 98 Q40 104 46 104 H74 Q80 104 80.5 98 L86 20 Z" fill={GLASS} stroke={GLASS_EDGE} strokeWidth="1.6" />
        <path d="M36.2 36 L41.4 97 Q42 102 46 102 H74 Q78 102 78.6 97 L83.8 36 Z" fill={TEA} />
        <g fill={FOAM}>
          <path d="M35.4 27 H84.6 L83.8 38 H36.2 Z" />
          <circle cx="41" cy="27" r="6" />
          <circle cx="51" cy="25" r="7" />
          <circle cx="61" cy="26" r="6.5" />
          <circle cx="71" cy="24" r="7" />
          <circle cx="80" cy="27" r="5.5" />
          <circle cx="65" cy="18" r="5" />
        </g>
        {[
          [46, 30],
          [70, 31],
          [58, 34],
        ].map(([x, y], i) => (
          <motion.circle
            key={x}
            cx={x}
            cy={y}
            r="1.8"
            fill="white"
            style={fromCentre}
            {...loop({ scale: [0, 1, 0], y: [0, -7] }, { duration: 1.6, delay: delay + i * 0.5, ease: 'easeOut' })}
          />
        ))}
        <path d="M39 30 L43.5 92" stroke="white" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        <g fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round">
          <path d="M44 61 Q48.5 55 53 61" />
          <path d="M67 61 Q71.5 55 76 61" />
        </g>
        <path d="M52 68 Q60 80 68 68 Z" fill={INK} />
        <ellipse cx="60" cy="73.6" rx="4" ry="2.2" fill={BLUSH} />
        <Blush y={68} spread={21} />
      </motion.g>
    </Frame>
  )
}
