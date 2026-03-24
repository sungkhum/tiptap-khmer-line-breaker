# Khmer Word Breaker

A TipTap extension that segments Khmer text into words by inserting zero-width spaces (ZWSP) at word boundaries. Includes real-time spell checking powered by SymSpell.

**[Live Demo](https://sungkhum.github.io/tiptap-khmer-line-breaker/)**

## Why This Exists

Khmer script has no spaces between words. A sentence like `ព្រះពុទ្ធសាសនាជាសាសនាចម្បង` is a continuous stream of characters that browsers cannot line-wrap, select by word, or spell-check without knowing where the word boundaries are.

This extension solves that by analyzing Khmer text with a beam search algorithm backed by a 50,000-word frequency dictionary, then inserting invisible zero-width space characters at each word boundary. The result: proper line wrapping, double-click word selection, and accurate spell checking — all running entirely in the browser.

## Features

### Word Segmentation
- **Beam search algorithm** explores multiple segmentation paths simultaneously, picking the globally optimal split
- **50K word frequency dictionary** — 5K words load instantly for immediate segmentation, full dictionary loads async
- **Compound word detection** — recognizes productive Khmer prefixes (អ្នក, ការ, មហorg org org org org org org org) and suffixes (org org org org, org org org org org org org org, org org org org)
- **Fuzzy matching** — edit-distance-1 lookup keeps misspelled words together instead of fragmenting them into syllables
- **Unicode-correct** — respects COENG (subscript), combining marks, and all Khmer orthographic rules

### Spell Checking
- **SymSpell algorithm** via Web Worker — 77K word dictionary, sub-millisecond correctness checks
- **Suggestions** — click a misspelled word to see edit-distance-1 corrections sorted by frequency
- **Ignore** — dismiss false positives per word
- **Real-time** — checks run continuously as you type (300ms debounce)

### Editor
- **ZWSP visibility toggle** — see exactly where word breaks were inserted (thin vertical markers)
- **Insert/remove** word breaks on demand
- **TipTap 3.x** compatible — works with ProseMirror decorations, no schema modifications

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/lib/
  khmer-breaker.ts          # Core word segmentation engine (beam search, trie, Unicode rules)
  khmer-dictionary-data.ts  # Embedded top 5K words for instant loading
  khmer-affixes.ts          # Prefix/suffix definitions for compound detection
  khmer-titles.ts           # Honorifics list for proper noun detection
  protected-phrases.ts      # Phrases that should never be split
  tiptap-khmer-word-break.ts  # TipTap extension: word breaking + ZWSP visibility
  tiptap-spell-check.ts     # TipTap extension: SymSpell spell checking
  spell-check-types.ts      # Web Worker manager + message protocol types

public/
  dictionaries/
    km_frequency_dictionary.json  # Full 50K word frequency dictionary
    km_symspell_dictionary.txt    # 77K word SymSpell dictionary (TSV)
  lib/
    symspell-browser.js     # SymSpell algorithm (language-agnostic, zero deps)
  workers/
    spell-check-worker.js   # Web Worker: dictionary loading, caching, batch checking
```

### How Word Breaking Works

1. Text is split into Khmer vs non-Khmer runs (Latin text passes through unchanged)
2. Khmer runs go through the **beam search** — explores top 8 segmentation paths per position
3. Each path scores dictionary matches (`log(frequency) + length_bonus - boundary_penalty`) against OOV penalties
4. **Affix detection** recognizes compounds even when the full form isn't in the dictionary
5. **Fuzzy merge** post-processing detects shredded misspellings and re-joins them
6. Best path by average score per segment wins

### How Spell Checking Works

1. Web Worker loads 77K word SymSpell dictionary (cached in IndexedDB after first load)
2. After word breaks are inserted, text is split on ZWSP boundaries
3. Each word is batch-checked via the worker (`Map.has()` lookup — sub-ms)
4. Misspelled words get ProseMirror inline decorations (wavy underline)
5. Click triggers `suggest()` — SymSpell returns edit-distance-1 matches sorted by frequency

## Integration with Lectio

This extension is designed for integration into [Lectio](https://github.com/sungkhum/lectio), a multi-language translation and editing platform. In Lectio, the word breaking and spell check activate based on a Khmer language flag — they don't run for other languages.

## Dictionary Sync

Dictionaries originate in the [Aksara](https://github.com/sungkhum/aksara) codebase. When dictionaries are updated there, a GitHub Action automatically syncs them to this repo and to Lectio.

## Tech Stack

- [Next.js](https://nextjs.org) 16 with static export for GitHub Pages
- [TipTap](https://tiptap.dev) 3.x (ProseMirror-based editor)
- [Tailwind CSS](https://tailwindcss.com) 4
- TypeScript

## License

MIT
