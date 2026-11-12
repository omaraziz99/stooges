// The Stooges logo: the chat-bubble mascot and the wordmark, cut from
// public/emoji/stooges_logo.png at the same height so together they match it.
// The wordmark is a mask filled with --color-logo, so it is navy in Teh Susu
// and cream in Kopi O (the original's navy text vanishes on the dark theme).
// Set the size with a height class, e.g. "h-8".
const wordmark = 'url(/logo-wordmark.png) center / contain no-repeat'

export function Logo({ className = 'h-10' }: { className?: string }) {
  return (
    <span role="img" aria-label="Stooges" className={`inline-flex shrink-0 ${className}`}>
      <img src="/logo-mark.png" alt="" className="h-full w-auto" />
      <span aria-hidden className="aspect-[634/256] h-full bg-logo" style={{ mask: wordmark, WebkitMask: wordmark }} />
    </span>
  )
}
