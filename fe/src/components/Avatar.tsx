import { avatarColor, initials } from '../lib/format'

export function Avatar({ pubkey, name, size = 'md' }: { pubkey: string; name: string; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm'
  return (
    <div
      aria-hidden
      className={`${avatarColor(pubkey)} ${dims} flex shrink-0 items-center justify-center rounded-md font-semibold text-white`}
    >
      {initials(name)}
    </div>
  )
}
