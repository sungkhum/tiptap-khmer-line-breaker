"use client"

import dynamic from 'next/dynamic'

const KhmerEditor = dynamic(() => import('@/components/KhmerEditor'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-[#e0ddd8] bg-white p-12 text-center text-[#8888a8]">
      Loading editor...
    </div>
  ),
})

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      {/* Header */}
      <header className="mb-10">
        <div className="flex items-baseline gap-3 mb-2">
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: '#1a1a2e' }}
          >
            Khmer Word Breaker
          </h1>
          <span className="text-xs font-medium tracking-wide uppercase text-[#8888a8]">
            TipTap Extension
          </span>
        </div>
        <p className="text-[15px] leading-relaxed text-[#4a4a6a] max-w-xl">
          Segments Khmer text with zero-width spaces for proper line wrapping.
          Includes SymSpell-powered spell checking with 77K word dictionary.
        </p>
      </header>

      <KhmerEditor />

      <footer className="mt-20 pt-8 border-t border-[#e0ddd8]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#8888a8]">
          <span>Beam search segmentation &middot; 50K+ word frequency dictionary</span>
          <span>SymSpell spell checking &middot; 77K words</span>
          <a
            href="https://github.com/sungkhum/tiptap-khmer-line-breaker"
            className="text-[#c4553a] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </footer>
    </main>
  )
}
