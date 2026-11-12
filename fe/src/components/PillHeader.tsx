// The sticky header of the landing page and the team dashboard: a plain bar at
// the top of the page that floats as a pill once you scroll. Content under it
// lines up with max-w-7xl containers padded px-4 sm:px-6 lg:px-8.
import type { ReactNode } from 'react'

export function PillHeader({ scrolled, children }: { scrolled: boolean; children: ReactNode }) {
  return (
    <header className="pointer-events-none sticky top-0 z-20">
      <div
        className={`pointer-events-auto mx-auto flex items-center gap-3 border transition-all duration-300 ease-out motion-reduce:transition-none ${
          scrolled
            ? 'mt-3 h-14 w-[calc(100%-1.5rem)] max-w-4xl rounded-full border-gray-200 bg-white/85 pr-2 pl-5 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md'
            : 'h-16 w-full max-w-7xl rounded-none border-transparent bg-transparent px-4 sm:px-6 lg:px-8'
        }`}
      >
        {children}
      </div>
    </header>
  )
}
