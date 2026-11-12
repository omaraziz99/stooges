import { avatarColor, initials } from '../lib/format'
import { LiquidGlass } from './ui/liquid-glass'

/** A round frosted liquid-glass avatar with a light tint of the person's colour. */
export function Avatar({ pubkey, name, size = 'md' }: { pubkey: string; name: string; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm'
  return (
    <LiquidGlass
      aria-hidden
      radius={999}
      bevelDepth={6}
      scale={14}
      aberration={2}
      frost={3}
      tint={0.45}
      className={`${dims} shrink-0 shadow-[0_1px_3px_rgb(0_0_0/0.12)]`}
    >
      {/* Light colour wash, a frosty highlight, then the rim. The glass stays light
          in both themes, so the initials use a fixed dark colour, not the palette. */}
      <span className={`absolute inset-0 ${avatarColor(pubkey)} opacity-25`} />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.7),transparent_65%)]" />
      <span className="absolute inset-0 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.9),inset_0_0_0_1px_rgb(255_255_255/0.5),inset_0_-1px_2px_rgb(0_0_0/0.08)]" />
      <span className="relative flex size-full items-center justify-center font-semibold text-[#44403c]">
        {initials(name)}
      </span>
    </LiquidGlass>
  )
}
