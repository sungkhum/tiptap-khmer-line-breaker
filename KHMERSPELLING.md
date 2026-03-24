# Spell Checking with SymSpell - Porting Guide for Tiptap

This document covers the SymSpell spell checking implementation from Aksara, designed for porting to a Tiptap-based editor supporting multiple languages.

## Architecture Overview

Spell checking runs entirely in the browser using a Web Worker to avoid blocking the main thread. The core algorithm is SymSpell (Symmetric Delete Spelling Correction), which pre-computes all delete variants at dictionary load time, making lookups O(1) and suggestions extremely fast.

```
┌──────────────────────────────────────────────────────┐
│  Main Thread                                         │
│                                                      │
│  Editor Plugin                                       │
│  ├── Scans visible words after text changes          │
│  ├── Sends batch of words to worker                  │
│  ├── Applies CSS class to misspelled spans           │
│  ├── On click/selection → requests suggestions       │
│  └── Handles word replacement                        │
│                                                      │
│  SpellCheckWorkerManager (lib/spell-check-types.ts)  │
│  ├── Promise-based API over postMessage              │
│  ├── Request tracking with timeouts                  │
│  └── batchCheck(), check(), suggest()                │
└───────────────┬──────────────────────────────────────┘
                │ postMessage / onmessage
┌───────────────▼──────────────────────────────────────┐
│  Web Worker (workers/spell-check-worker.js)          │
│  ├── Loads dictionary (TSV) → SymSpell instance      │
│  ├── IndexedDB cache for parsed dictionary entries   │
│  ├── LRU caches for correctness + suggestions        │
│  └── Handles: init, batchCheck, check, suggest       │
│                                                      │
│  SymSpell Engine (lib/symspell-browser.js)            │
│  ├── Delete-based index for fast lookup              │
│  ├── Damerau-Levenshtein edit distance               │
│  └── Verbosity modes: TOP, CLOSEST, ALL              │
└──────────────────────────────────────────────────────┘
```

## Files to Port

### Core (Required, Language-Agnostic)

| File | Purpose | Lines |
|------|---------|-------|
| `public/lib/symspell-browser.js` | SymSpell algorithm (self-contained, no deps) | ~577 |
| `public/workers/spell-check-worker.js` | Web Worker message handler + caching | ~435 |
| `lib/spell-check-types.ts` | TypeScript types + `SpellCheckWorkerManager` class | ~353 |

### Dictionary (Per Language)

| File | Purpose | Format |
|------|---------|--------|
| `public/dictionaries/km_symspell_dictionary.txt` | Khmer dictionary (~77k words) | TSV: `word\tfrequency` |

### Not Needed

- `components/lexical/plugins/khmer-spell-check-plugin.tsx` — Lexical-specific; you'll write a Tiptap equivalent
- `components/lexical/contexts/spell-check-context.tsx` — Aksara-specific UI state
- `hooks/use-spell-check-custom-words.ts` — Aksara-specific user dictionary API

---

## SymSpell Algorithm

### How It Works

SymSpell uses a "symmetric delete" approach:

1. **At dictionary load time**: For each word, generate all possible deletions up to `maxEditDistance` characters removed. Store these as keys pointing back to the original word.
2. **At lookup time**: Generate deletions of the input word. Find matches in the pre-computed delete index. This finds all dictionary words within `maxEditDistance` edits.

The "symmetric" insight: instead of generating all possible insertions/deletions/substitutions/transpositions (expensive), only generate deletions from both sides. A deletion from the dictionary word + a deletion from the input word covers all edit operations.

### Key Parameters

```javascript
new SymSpell(
  maxEditDistance = 2,  // Max edits for suggestions (1-2 typical)
  prefixLength = 7,     // Only index this many chars of each word (performance)
  countThreshold = 1    // Min frequency to include word
)
```

- **`maxEditDistance = 2`**: Catches most typos (transpositions, missing/extra characters, wrong character). Higher values = more suggestions but slower + more memory.
- **`prefixLength = 7`**: Truncates words to 7 chars for indexing. Reduces memory ~90% with minimal accuracy loss. Good default for most languages.
- **`countThreshold = 1`**: Include all words with frequency >= 1. Set higher to reduce dictionary size.

### Verbosity Modes

```javascript
Verbosity.TOP     // Single best suggestion (highest frequency at lowest distance)
Verbosity.CLOSEST // All suggestions at the smallest edit distance found
Verbosity.ALL     // All suggestions within maxEditDistance
```

Aksara uses `Verbosity.CLOSEST` for suggestions — returns all words at the minimum edit distance, sorted by frequency.

### SymSpell API

```javascript
// Create instance
const symspell = new SymSpell(2, 7, 1)

// Add words (call for each word in dictionary)
symspell.createDictionaryEntry("word", 50000)

// Check if word exists (exact match, O(1))
symspell.isCorrect("word")  // true/false

// Get suggestions (fast, typically < 200ms)
const results = symspell.lookup("wrod", Verbosity.CLOSEST, 2)
// Returns: [SuggestItem { term: "word", distance: 1, count: 50000 }, ...]

// Word count
symspell.wordCount  // number
```

### SuggestItem

```javascript
{
  term: string,     // The suggested word
  distance: number, // Edit distance from input (0 = exact match)
  count: number     // Frequency in dictionary
}
```

Results are sorted by: distance ascending, then count descending.

---

## Dictionary Format

### TSV Format (`km_symspell_dictionary.txt`)

```
word1\tfrequency1
word2\tfrequency2
...
```

Example:
```
ជា	151830
មាន	128033
នៅ	126712
ដែល	125744
```

- Tab-separated, one word per line
- Frequency is a positive integer (higher = more common)
- No header row
- UTF-8 encoded

### Multi-Language Support

For multiple languages, use one dictionary file per language:

```
public/dictionaries/
  km_symspell_dictionary.txt   # Khmer
  en_symspell_dictionary.txt   # English
  th_symspell_dictionary.txt   # Thai
  ...
```

The worker needs to know which dictionary to load. Modify the `init` message to accept a language/dictionary path:

```javascript
// Main → Worker
{ type: 'init', dictionaryUrl: '/dictionaries/km_symspell_dictionary.txt', debug: false }
```

---

## Web Worker

### Why a Web Worker?

- Dictionary loading parses ~77k lines of TSV and builds the SymSpell delete index — this takes 200-500ms and would freeze the UI
- Suggestion lookup involves edit distance computation — must not block typing
- The worker keeps the dictionary in its own memory, separate from the main thread

### Worker Message Protocol

**Main Thread → Worker:**

| Message | Fields | Purpose |
|---------|--------|---------|
| `init` | `debug?: boolean` | Load dictionary, build index |
| `setDebug` | `debug: boolean` | Toggle debug logging |
| `batchCheck` | `words: string[], requestId: string` | Check multiple words at once |
| `check` | `word: string, requestId: string` | Check single word |
| `suggest` | `word: string, requestId: string` | Get suggestions for misspelled word |
| `clearCache` | — | Clear LRU caches |

**Worker → Main Thread:**

| Message | Fields | Purpose |
|---------|--------|---------|
| `ready` | `wordCount: number, loadTime?: number` | Dictionary loaded successfully |
| `batchCheckResult` | `results: Record<string, boolean>, requestId, elapsed?` | Batch check results |
| `checkResult` | `word, isCorrect: boolean, requestId` | Single check result |
| `suggestions` | `word, suggestions: string[], requestId, elapsed?, cached?` | Spelling suggestions |
| `error` | `error: string` | Fatal error |
| `cacheCleared` | — | Cache clear confirmation |

### Request Tracking

Every request includes a `requestId` (generated with `Date.now() + random string`). The `SpellCheckWorkerManager` maps pending requests to Promise resolve/reject handlers with timeouts (5 seconds default, 30 seconds for init).

```typescript
const manager = new SpellCheckWorkerManager()
await manager.init()  // Loads dictionary, resolves when 'ready' received

const results = await manager.batchCheck(["word1", "word2", "word3"])
// { "word1": true, "word2": false, "word3": true }

const suggestions = await manager.suggest("word2")
// ["word", "words", "wordy"]
```

---

## Caching Strategy

### Three Levels of Caching

#### 1. IndexedDB Cache (Parsed Dictionary Entries)

The raw TSV dictionary is parsed into `[word, freq]` pairs, then cached in IndexedDB. On subsequent page loads, the parsed entries are loaded directly from IndexedDB instead of re-fetching and re-parsing the TSV file.

```javascript
const IDB_DB_NAME = 'aksara-spellcheck'  // Change per app
const IDB_STORE_NAME = 'dictionary'
const IDB_KEY = 'km_symspell'            // Change per language
const DICT_CACHE_VERSION = 1             // Bump when dictionary changes
```

**Multi-language**: Use a different `IDB_KEY` per language (e.g., `km_symspell`, `en_symspell`).

**Cache invalidation**: Bump `DICT_CACHE_VERSION` when the dictionary file changes. The worker checks the version and re-fetches if mismatched.

#### 2. LRU Cache (Correctness Checks)

In-memory LRU cache (1000 entries) in the worker. Avoids redundant `symspell.isCorrect()` calls for words that appear multiple times in the document.

```javascript
const correctCache = new LRUCache(1000)
// Key: word string → Value: boolean (is correct)
```

#### 3. LRU Cache (Suggestions)

Separate LRU cache (1000 entries) for suggestions. Since suggestion lookup is the most expensive operation (~200ms), caching is critical.

```javascript
const suggestCache = new LRUCache(1000)
// Key: word string → Value: string[] (suggestion terms)
```

### LRU Implementation

Uses `Map` insertion order — accessing a key deletes and re-inserts it to move it to the end. When the cache is full, the first (oldest) entry is evicted.

```javascript
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)  // Move to end
    return value
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)  // Evict oldest
    }
    this.cache.set(key, value)
  }
}
```

---

## Editor Integration Pattern

This section describes how the spell check plugin interacts with the editor. The Aksara implementation is Lexical-specific, but the pattern applies to any editor (Tiptap/ProseMirror).

### Lifecycle

1. **Mount**: Create Web Worker, send `init`, wait for `ready`
2. **Text changes**: Debounce (300ms), then scan visible word nodes
3. **Batch check**: Collect all unique words, send single `batchCheck` to worker
4. **Mark misspelled**: Apply CSS class (`spellcheck-misspelled`) to misspelled word spans
5. **Click/selection**: Detect clicked word, send `suggest` to worker
6. **Show suggestions**: Display suggestion popover near the word
7. **Replace**: Swap the word text, preserving surrounding punctuation
8. **Unmount**: Terminate worker

### Scanning Strategy

**Incremental scanning**: Track previous span contents with a `WeakMap`. Only re-check words whose text has changed since the last scan. This avoids re-checking the entire document on every keystroke.

```typescript
// Track what we've already checked
const previousSpanContents = new WeakMap<Element, string>()

function scanForMisspelledWords() {
  const wordSpans = getVisibleWordSpans()
  const wordsToCheck: string[] = []

  for (const span of wordSpans) {
    const text = span.textContent
    if (previousSpanContents.get(span) === text) continue  // Unchanged
    previousSpanContents.set(span, text)

    const cleanWord = cleanWord(text)
    if (cleanWord && isCheckableWord(cleanWord)) {
      wordsToCheck.push(cleanWord)
    }
  }

  if (wordsToCheck.length > 0) {
    worker.batchCheck(uniqueWords)  // Single round-trip
  }
}
```

### Word Cleaning for Dictionary Lookup

Before sending words to the spell checker, strip invisible characters and punctuation:

```typescript
function cleanWord(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\u2060]/g, '')  // Zero-width chars
    .replace(/[\u17D4-\u17DA]/g, '')               // Khmer punctuation (language-specific)
    .replace(/[.,!?;:'"()\[\]{}]/g, '')            // Common punctuation
    .replace(/[\u00AB\u00BB\u2018-\u201F\u2039\u203A]/g, '')  // Quotes/guillemets
    .replace(/[\u2013\u2014\u2026]/g, '')          // Dashes, ellipsis
    .trim()
}
```

**Multi-language note**: The punctuation stripping for Khmer (`\u17D4-\u17DA`) is language-specific. For a multi-language system, make this configurable per language or only strip universal punctuation.

### Punctuation Preservation During Replacement

When the user accepts a suggestion, the original punctuation must be preserved:

```
Original: «អោយ     →  leading: «    core: អោយ    trailing: (none)
Original: អស់»។    →  leading: (none)  core: អស់   trailing: »។

Replacement: leading + suggestion + trailing
```

```typescript
function extractPunctuation(text: string): { leading: string; core: string; trailing: string } {
  let start = 0, end = text.length

  while (start < text.length && isPunctuation(text[start])) start++
  while (end > start && isPunctuation(text[end - 1])) end--

  return {
    leading: text.slice(0, start),
    core: text.slice(start, end),
    trailing: text.slice(end)
  }
}

// When replacing:
const { leading, trailing } = extractPunctuation(originalText)
const newText = leading + suggestion + trailing
```

### Visual Marking

Misspelled words are marked via CSS class on the DOM spans. The styling uses CSS (not inline styles) for easy customization:

```css
.spellcheck-misspelled {
  text-decoration: underline wavy red;
  text-underline-offset: 3px;
}
```

### Debouncing

Two debounce timers:

| Timer | Delay | Purpose |
|-------|-------|---------|
| Scan debounce | 300ms | After text changes, wait before scanning for misspelled words |
| Selection debounce | 100ms | After click/selection, wait before requesting suggestions |

---

## Adapting for Multiple Languages

### What Changes Per Language

| Component | Changes Needed |
|-----------|---------------|
| Dictionary file | Different TSV file per language |
| IndexedDB key | Different cache key per language |
| Word cleaning | Language-specific punctuation stripping |
| Checkable word detection | Language-specific character detection (e.g., `isKhmerLetter()`) |
| Title/honorific detection | Language-specific (or remove entirely) |
| SymSpell parameters | May need different `maxEditDistance` or `prefixLength` |

### What Stays the Same

| Component | Reusable As-Is |
|-----------|---------------|
| `symspell-browser.js` | Fully language-agnostic |
| `spell-check-worker.js` | Nearly language-agnostic (just change dictionary URL) |
| `spell-check-types.ts` | Fully language-agnostic |
| LRU cache | Language-agnostic |
| IndexedDB caching | Language-agnostic (just change key) |
| Worker message protocol | Language-agnostic |
| Punctuation preservation | Mostly language-agnostic |

### Suggested Multi-Language Worker Changes

Modify the `init` message to accept a dictionary URL:

```javascript
// In worker:
self.onmessage = function(e) {
  if (e.data.type === 'init') {
    const dictionaryUrl = e.data.dictionaryUrl || '/dictionaries/km_symspell_dictionary.txt'
    const cacheKey = e.data.cacheKey || 'km_symspell'
    initDictionary(dictionaryUrl, cacheKey)
  }
}

// In main thread:
worker.postMessage({
  type: 'init',
  dictionaryUrl: '/dictionaries/en_symspell_dictionary.txt',
  cacheKey: 'en_symspell',
  debug: false
})
```

For simultaneous multi-language support, spawn one worker per language:

```typescript
const workers = new Map<string, SpellCheckWorkerManager>()

async function initLanguage(lang: string) {
  const manager = new SpellCheckWorkerManager()
  // Modify init to pass dictionaryUrl
  await manager.init(`/dictionaries/${lang}_symspell_dictionary.txt`)
  workers.set(lang, manager)
}

function checkWord(word: string, lang: string): Promise<boolean> {
  return workers.get(lang)!.check(word)
}
```

---

## Creating Dictionary Files

### From a Word Frequency List

If you have a word frequency list (most languages have freely available ones):

```
the	23135851162
of	13151942776
and	12997637966
```

This is already in the correct TSV format. Save as `{lang}_symspell_dictionary.txt`.

### From a Word List (No Frequencies)

If you only have a word list, assign uniform frequency:

```bash
awk '{print $0 "\t1"}' wordlist.txt > lang_symspell_dictionary.txt
```

However, frequency data significantly improves suggestion quality — the most common correct word is usually the intended one. Try to find frequency data if possible.

### Dictionary Sources

- **English**: Google Books Ngrams, SUBTLEX, Wikipedia word frequencies
- **Khmer**: Custom-built from Khmer corpus analysis
- **Thai, Vietnamese, etc.**: Check language-specific NLP resources

---

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Dictionary load (first visit) | 200-500ms | Fetches TSV, parses, builds index |
| Dictionary load (cached) | 50-150ms | Loads parsed entries from IndexedDB |
| Correctness check (single) | < 1ms | `Map.has()` lookup |
| Batch check (100 words) | < 5ms | 100x `Map.has()` |
| Suggestions (edit distance 2) | < 200ms | Depends on word length and dictionary size |
| Suggestions (cached) | < 1ms | LRU cache hit |

### Memory Usage

- SymSpell dictionary (~77k Khmer words): ~15-25 MB in worker memory
- The delete index is the majority of memory usage
- Each additional language adds ~15-25 MB per worker

---

## `symspell-browser.js` - Self-Contained Engine

This file is a browser-compatible extraction of the [node-symspell-new](https://github.com/Ravikumar-Pawar/node-symspell-new) package (based on [Wolf Garbe's SymSpell](https://github.com/wolfgarbe/SymSpell)). It has zero dependencies and exports as ES modules.

### Exports

```javascript
export { SymSpell, SuggestItem, Verbosity, EditDistance }
```

### Edit Distance Algorithm

Uses Damerau-Levenshtein distance, which counts four operations:
1. **Insertion**: `wrd` → `word`
2. **Deletion**: `wordd` → `word`
3. **Substitution**: `wird` → `word`
4. **Transposition**: `wrod` → `word`

The implementation includes an optimized version (`_distanceMax`) that prunes computation when the distance exceeds `maxEditDistance`, making it faster than naive implementations.

### No Modifications Needed

`symspell-browser.js` is completely language-agnostic. It works with any Unicode text. Copy it as-is to your Tiptap project.

---

## Tiptap Integration Approach

### 1. Copy Core Files

```
your-tiptap-project/
  public/
    lib/
      symspell-browser.js          # Copy as-is
    workers/
      spell-check-worker.js        # Modify init to accept dictionaryUrl
    dictionaries/
      km_symspell_dictionary.txt   # Per language
      en_symspell_dictionary.txt
  lib/
    spell-check-types.ts           # Copy as-is
```

### 2. Create a Tiptap Extension

```typescript
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { SpellCheckWorkerManager } from '../lib/spell-check-types'

const spellCheckKey = new PluginKey('spellCheck')

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addOptions() {
    return {
      language: 'km',
      dictionaryUrl: '/dictionaries/km_symspell_dictionary.txt',
      debounceMs: 300,
    }
  },

  addProseMirrorPlugins() {
    const manager = new SpellCheckWorkerManager()
    // Initialize worker with dictionary
    // Use ProseMirror decorations to underline misspelled words
    // Listen for transactions to trigger re-checking
    // ...
  },
})
```

### 3. Key Decisions for Tiptap

**Decorations vs. Marks**: Use ProseMirror `Decoration.inline()` for misspelled word underlines. Decorations are visual-only and don't modify the document model. Marks would pollute the document schema.

**Word boundary detection**: In Aksara, the word break plugin creates separate text nodes per word (Lexical nodes). In Tiptap/ProseMirror, you'll need to find word boundaries yourself:
- For space-separated languages (English, etc.): Split on whitespace/punctuation
- For Khmer/Thai: Use the word breaker's segments
- The `getSegments()` method from the word breaker returns the word boundaries

**Suggestion UI**: Implement as a Tiptap floating menu or a custom popover positioned near the misspelled word. On right-click or click on a misspelled decoration, show suggestions from `manager.suggest(word)`.

---

## Custom Words (User Dictionary)

Aksara supports two types of user-defined words:

### Added Words (Custom Whitelist)

Words the user has added as "correct" (e.g., proper nouns, domain-specific terms). These bypass the spell checker — checked client-side before sending to the worker.

```typescript
const addedWords = new Set(["AngularJS", "PostgreSQL", "កូនេលាស"])

function isCheckableWord(word: string): boolean {
  if (addedWords.has(word)) return false  // Skip checking
  return true
}
```

### Ignored Words (Split Preferences)

Words the user has marked as "ignore" — they exist in the master dictionary but the user disagrees with them. These are handled by the word breaker (not the spell checker) by setting their trie frequency to 0.

### Implementation Note

For the Tiptap port, you can start without user dictionary support and add it later. The core spell checking works without it. When you add it, store custom words in your backend and load them at init time.

---

## Khmer-Specific Behaviors

These behaviors are specific to Khmer and may not apply to other languages:

### Title-Based Proper Noun Detection

Words following a title/honorific (e.g., "លោក កូនេលាស") are skipped during spell checking. This prevents flagging proper nouns as misspellings. See `lib/khmer-titles.ts` for the full title list.

For other languages, you may want similar heuristics (e.g., skip capitalized words in English).

### Connector Splitting

Words joined by connectors (`-`, `/`, `.`, `:`) are split before checking. E.g., "ហើយ—ទោះ" → check "ហើយ" and "ទោះ" separately. This is somewhat Khmer-specific but may apply to other languages too.

### No-Space Languages

For languages without spaces (Khmer, Thai, Lao, Myanmar, Chinese, Japanese), the spell checker depends on the word breaker to identify individual words. Without word breaking, there are no word boundaries to check against.

For space-separated languages, word boundaries come from whitespace and punctuation — no word breaker needed.
