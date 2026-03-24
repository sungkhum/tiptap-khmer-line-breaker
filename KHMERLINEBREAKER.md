# Khmer Line Breaker - Porting Guide for Tiptap

This document contains everything needed to clone the Khmer word-breaking system from Aksara into a standalone Tiptap extension that inserts zero-width spaces (ZWSP, `\u200B`) between Khmer words.

Current implimentation with Lexical (where you can find the dictionary files and code) is at: https://github.com/sungkhum/aksara

## Goal

Khmer text has no spaces between words. This system uses a beam search algorithm backed by a frequency dictionary to segment Khmer text into words, then inserts ZWSP characters at word boundaries. This enables:
- Proper line wrapping in browsers
- Text selection by word (double-click)
- Copy/paste with word boundaries preserved

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Tiptap Extension (Editor Plugin)               │
│  - Listens for text changes                     │
│  - Extracts Khmer text runs                     │
│  - Calls KhmerBreaker.insertBreakOpportunities()│
│  - Inserts ZWSP into the document               │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  KhmerBreaker (lib/khmer-breaker.ts)            │
│  - Beam search segmentation                     │
│  - Trie-based dictionary lookup                 │
│  - Unicode break rules for Khmer                │
│  - Punctuation handling                         │
│  - Compound word detection (affixes)            │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Dictionary Data                                │
│  - Embedded: ~5,000 top words (instant load)    │
│  - Async: ~50,000 words (loaded after render)   │
│  - Format: { word: string, frequency: number }  │
└─────────────────────────────────────────────────┘
```

## Files to Port

### Core (Required)

1. **`lib/khmer-breaker.ts`** - The main word-breaking engine (~2640 lines)
2. **`lib/khmer-dictionary-data.ts`** - Embedded top 5,000 words for instant loading
3. **`public/dictionaries/km_frequency_dictionary.json`** - Full dictionary (~50k words, loaded async)

### Supporting (Required)

4. **`lib/khmer-affixes.ts`** - Prefix/suffix definitions for compound word detection
5. **`lib/khmer-titles.ts`** + **`lib/khmer-titles.json`** - Honorifics list (used for proper noun detection)
6. **`lib/protected-phrases.ts`** - Phrases that should never be split (currently empty, but the mechanism is important)
7. **`lib/debug.ts`** - Debug logging utilities (can be simplified/removed)

### Not Needed for ZWSP-only

- `components/lexical/plugins/khmer-word-break-plugin.tsx` - Lexical-specific; you'll write a Tiptap equivalent
- `components/lexical/nodes/khmer-break-node.tsx` - Lexical-specific visual break markers
- Spell check, grammar check, ODT export - all Aksara-specific features

---

## Core Algorithm: Beam Search Word Segmentation

### Entry Point

The main API is simple:

```typescript
const breaker = new KhmerBreaker(dictionaryData)
const textWithBreaks = breaker.insertBreakOpportunities("សួស្តីពិភពលោក")
// Returns: "សួស្តី\u200Bពិភពលោក" (ZWSP inserted between words)
```

Or if you want the segments as an array:

```typescript
const segments = breaker.getSegments("សួស្តីពិភពលោក")
// Returns: ["សួស្តី", "ពិភពលោក"]
```

### How `getSegments()` Works

1. **Pre-process**: Clean ZWSP around connector characters, split on existing ZWSP (user-defined breaks)
2. **For each chunk**: Split by whitespace, then by script (Khmer vs Latin vs digits)
3. **For Khmer runs**: Extract punctuation, handle Word Joiner regions, run beam search
4. **Post-process**: Merge connectors (e.g., `៤:២៥`), merge punctuation with adjacent words, merge known compound words

### Beam Search (`beamSegment()`)

The core algorithm. Explores multiple segmentation paths simultaneously and keeps the top N best.

**Constants** (tuned for Khmer):
```typescript
BEAM_WIDTH = 8          // Top paths kept per iteration
MAX_WORD_LEN = 20       // Max word length in characters
OOV_PENALTY = 6.0       // Cost for unknown token
OOV_SINGLE_CLUSTER_PENALTY = 12.0  // Heavy cost for single-cluster unknown
DANGLING_BANTOC_PENALTY = 20.0     // consonant + ់ alone = almost always wrong
DANGLING_VOWEL_PENALTY = 15.0      // Word ending in bare short vowel
BOUNDARY_PENALTY = 2.0  // Cost per token boundary (discourages over-splitting)
LENGTH_BONUS = 0.25      // Reward per character for longer tokens
```

**Scoring**:
- Dictionary words: `log(frequency + 1) + LENGTH_BONUS * length - BOUNDARY_PENALTY`
- Unknown (OOV) words: `-OOV_PENALTY - BOUNDARY_PENALTY + small_length_bonus`
- Short words (1-2 clusters) get soft penalties based on frequency distance from threshold
- Single-cluster OOV gets extra-heavy penalty
- "Dangling bantoc" (consonant + ់) gets very heavy penalty

**Special handling**:
- Whitespace, punctuation, Khmer digits, non-Khmer text: handled as atomic tokens
- Khmer digit runs with connectors (e.g., `៤:២៥-២៦`) kept together
- OOV chunks consume multiple clusters until a strong dictionary word starts
- Affix-based compound detection (see below)

### Final state selection

After beam search completes, the best state is chosen by:
1. Furthest position (consumed most text)
2. Highest **average** score per segment (prevents over-segmentation)

Post-processing merges orphaned single-cluster OOV tokens into the previous word.

---

## Data Structures

### Trie (Dictionary Lookup)

The dictionary is stored in a trie for O(word_length) lookup:

```typescript
class TrieNode {
  children: Map<string, TrieNode>
  isWord: boolean
  frequency: number
}

class KhmerTrie {
  root: TrieNode
  wordCount: number
  maxWordLength: number

  insert(word: string, frequency: number): void
  findLongestMatch(text: string, startIndex: number): { word, frequency } | null
  findAllMatches(text: string, startIndex: number, maxLength: number): Array<{ length, frequency }>
  hasWord(word: string): boolean
  getFrequency(word: string): number
}
```

Key methods:
- `findAllMatches()` - Returns ALL dictionary matches starting at a position (used by beam search to explore multiple paths)
- `findLongestMatch()` - Returns the single longest match (used by fallback algorithms)
- `findVariantInTrie()` - Handles doubled consonant variants (ត្ត → ត) via DFS
- `reorderCoengs()` - Fixes mistyped COENG sequences (C + Vowel + ្ + C → C + ្ + C + Vowel)

### KhmerCharSets (Unicode Utilities)

Character classification for Khmer Unicode block (U+1780-U+17FF):

```typescript
class KhmerCharSets {
  // Unicode ranges
  consonants: Set<string>           // U+1780-U+17A2
  independentVowels: Set<string>    // U+17A3-U+17B3
  dependentVowels: Set<string>      // U+17B4-U+17C5
  signs: Set<string>                // U+17C6-U+17D1, U+17D3, U+17DD
  combiningMarks: Set<string>       // dependentVowels + signs
  baseChars: Set<string>            // consonants + independentVowels

  // Special characters
  COENG = "\u17D2"        // ្ - subscript consonant marker
  BANTOC = "\u17CB"       // ់ - final consonant marker
  REPETITION_SIGN = "\u17D7"  // ៗ - repeat previous word

  // Key methods
  isKhmerChar(char): boolean
  isKhmerDigit(char): boolean       // ០-៩ (U+17E0-U+17E9)
  isBase(char): boolean
  isCombiningMark(char): boolean
  isCoeng(char): boolean
  canBreakAt(text, index): boolean  // THE critical method
  findSyllableEnd(text, index): number
  extractClusters(text): string[]
  isDanglingBantoc(token): boolean
  endsWithDanglingVowel(token): boolean
}
```

### `canBreakAt()` - The Critical Break Rules

This function determines if a word break can legally occur at a given position. These rules are non-negotiable for correct Khmer rendering:

```typescript
canBreakAt(text: string, index: number): boolean {
  // 1. Word Joiner (U+2060) prevents breaking on either side
  if (before === WJ || after === WJ) return false

  // 2. CRITICAL: Never break after or before COENG (្)
  //    Breaking here produces invalid Khmer rendering
  if (this.isCoeng(before) || this.isCoeng(after)) return false

  // 3. Never break AFTER samyok sannya (័, U+17D0)
  if (before === "\u17D0") return false

  // 4. Never break BEFORE repetition sign (ៗ)
  if (this.isRepetitionSign(after)) return false

  // 5. Never break around connector chars (-, /, ., :) between Khmer
  if (CONNECTOR_CHARS.has(before) && isKhmerChar(after)) return false
  if (CONNECTOR_CHARS.has(after) && isKhmerChar(before)) return false

  // 6. Never break BEFORE a combining mark (dependent vowels, signs)
  if (this.isCombiningMark(after)) return false

  // 7. Don't break right after combining mark unless next is base/whitespace/punctuation
  if (this.isCombiningMark(before) && !this.isBase(after) && !/\s/.test(after) && !isPunctuation(after))
    return false

  return true
}
```

---

## Dictionary Data Format

### Embedded Dictionary (`khmer-dictionary-data.ts`)

```typescript
export const KHMER_DICTIONARY: DictionaryEntry[] = [
  { word: "ជា", frequency: 151830 },
  { word: "មាន", frequency: 128033 },
  { word: "នៅ", frequency: 126712 },
  // ... ~5,000 entries, sorted by frequency descending
]
```

### Full Dictionary (`km_frequency_dictionary.json`)

```json
{
  "ជា": 151830,
  "មាន": 128033,
  "នៅ": 126712,
  // ... ~50,000 entries
}
```

### Loading Strategy

1. **Instant**: Load embedded ~5,000 words synchronously at startup
2. **Async**: Fetch full ~50,000 word dictionary after initial render
3. **Merge**: New words added to trie without overwriting existing entries

```typescript
const breaker = new KhmerBreaker(KHMER_DICTIONARY) // Instant
await breaker.loadFullDictionaryAsync('/dictionaries/km_frequency_dictionary.json') // Async
```

---

## Affix-Based Compound Detection

Khmer forms compound words with productive prefixes/suffixes. The system detects these even when the compound itself isn't in the dictionary.

### Prefixes

Two types:
- **Break-point** (`isBreakPoint: true`): Segment separately. E.g., `អ្នក` + `ចម្រៀង` → two segments
- **Fused** (`isBreakPoint: false`): Keep as one word. E.g., `មហា` + `សមុទ្រ` → one segment

```typescript
// Break-point prefixes (segmented)
{ text: 'អ្នក', isBreakPoint: true }   // doer/agent
{ text: 'ការ', isBreakPoint: true }    // nominalization
{ text: 'លោក', isBreakPoint: true }    // Mr./Sir
{ text: 'ក្រុម', isBreakPoint: true }  // group

// Fused prefixes (single word)
{ text: 'អនុ', isBreakPoint: false }   // sub-/vice-
{ text: 'មហា', isBreakPoint: false }   // great/grand
{ text: 'សហ', isBreakPoint: false }    // co-/joint
```

### Suffixes

```typescript
{ text: 'ភាព', isBreakPoint: true }     // -ness/-ity (only break-point suffix)
{ text: 'កម្ម', isBreakPoint: false }    // -ification
{ text: 'ធម៌', isBreakPoint: false }     // system/virtue
{ text: 'វិទ្យា', isBreakPoint: false }  // -logy/science
{ text: 'ការណ៍', isBreakPoint: false }   // affair/event
```

The compound detector checks: `prefix/suffix exists` AND `remainder is in dictionary with sufficient frequency`. Single-cluster remainders require frequency >= 5,000 to prevent spurious compounds.

---

## Punctuation Handling

### Closing Punctuation (stays with PREVIOUS segment)
`។ ៕ ៖ ! ? ) ] } » ' › " \u201D , . : ; ៚ ' \u2026 -`

### Opening Punctuation (stays with NEXT segment)
`( [ { « ' ‹ " \u201C`

### Connector Characters (glue adjacent Khmer tokens)
`- / . :` — These keep adjacent Khmer text together (e.g., `បុត្រា/ព្រះ`, `៤:២៥-២៦`)

### Em/En Dashes
`—` (em dash) and `–` (en dash) are NOT connectors — they produce separate tokens.

---

## Script Splitting

Text is split into Khmer vs non-Khmer runs before word breaking. Only Khmer runs go through the segmenter. Latin text, numbers, etc. pass through unchanged.

```typescript
splitByScript("Hello សួស្តី World")
// → [{ text: "Hello", isKhmer: false },
//    { text: "សួស្តី", isKhmer: true },
//    { text: "World", isKhmer: false }]
```

Khmer digits (០-៩) following Khmer letters are split into separate runs:
```
"តែ១១៣៤៤" → "តែ" | "១១៣៤៤"
```

---

## Simplified Tiptap Integration Approach

For a ZWSP-only Tiptap extension, you need:

### 1. Port the Core Files

Copy and adapt these files (remove Aksara-specific debug logging if desired):
- `khmer-breaker.ts` → Strip debug logging, keep all algorithms
- `khmer-dictionary-data.ts` → Copy as-is
- `km_frequency_dictionary.json` → Copy as-is
- `khmer-affixes.ts` → Copy as-is
- `khmer-titles.ts` + `khmer-titles.json` → Copy as-is
- `protected-phrases.ts` → Copy as-is

### 2. Create a Tiptap Extension

The extension needs to:
1. Initialize `KhmerBreaker` with the dictionary on mount
2. Load the full dictionary async after mount
3. Listen for document changes (Tiptap's `onUpdate`)
4. For changed text, run `breaker.insertBreakOpportunities(text)`
5. Replace the text content with the ZWSP-inserted version
6. Preserve cursor position across the replacement

### 3. Key API

The only method you need from `KhmerBreaker`:

```typescript
// Returns text with ZWSP inserted at word boundaries
breaker.insertBreakOpportunities(text: string): string

// Or get segments if you need more control
breaker.getSegments(text: string): string[]
```

### 4. Performance Considerations

- The beam search is fast (< 16ms for typical paragraphs)
- Only re-segment changed paragraphs, not the entire document
- The trie lookup is O(word_length), not O(dictionary_size)
- Consider debouncing updates during rapid typing

---

## Titles / Honorifics List

Used for proper noun detection (words after titles are likely names and shouldn't be flagged). The full list is in `lib/khmer-titles.json`:

```json
["លោក", "លោកស្រី", "អ្នកនាង", "កញ្ញា", "អ្នក", "បង", "ប្អូន", "អូន",
 "ពូ", "មីង", "អ៊ំ", "តា", "យាយ", "ក្មួយ", "ចៅ", "យាយទួត", "តាទួត",
 "លោកគ្រូ", "អ្នកគ្រូ", "គ្រូ", "សាស្ត្រាចារ្យ", "បណ្ឌិត", "វេជ្ជបណ្ឌិត",
 "ចៅក្រម", "មេធាវី", "នាយក", "អគ្គនាយក", "សម្ដេច", "ឯកឧត្តម",
 "លោកជំទាវ", "ឧកញ៉ា", "អ្នកឧកញ៉ា", "ព្រះតេជគុណ", "ព្រះសង្ឃ",
 "លោកម្ចាស់", "ភិក្ខុ", "សាមណេរ", "យាយជី", "តាជី", "ព្រះអង្គ",
 "ព្រះអង្គម្ចាស់", "អ្នកអង្គម្ចាស់", "សម្ដេចក្រុមព្រះ", "ព្រះមហាក្សត្រ",
 "ព្រះមហាក្សត្រី", "ព្រះបាទ", "ព្រះនាង", "អ្នកម្នាង", "ព្រះអគ្គមហេសី",
 "ឯកអគ្គរាជទូត", "សេនាធិការ", "ឧត្តមសេនីយ៍", "វរសេនីយ៍"]
```

---

## What You Can Simplify

For a ZWSP-only implementation without spell check/grammar/user dictionary:

1. **Remove `addUserWords()` and `addIgnoredWords()`** - These support user-custom dictionaries
2. **Remove `detectLikelyProperNouns()`** - Only needed for spell check
3. **Remove variant matching** (`findVariantInTrie`, `reorderCoengs`, `collapseDoubledConsonants`) - Only needed if you want tolerance for misspellings; the core segmentation works without it
4. **Remove `bidirectionalSegment()`** - Legacy fallback, beam search is primary
5. **Remove `improveWithIntlHints()`** - Optional Intl.Segmenter integration, beam search alone is sufficient
6. **Simplify debug logging** - Remove all `isDebugEnabled()` / `isWordBreakerDebugEnabled()` calls

### Minimal Implementation

If you want the absolute minimum:
1. `KhmerTrie` with `insert()`, `findAllMatches()`, `hasWord()`, `getFrequency()`
2. `KhmerCharSets` with `canBreakAt()`, `findSyllableEnd()`, `extractClusters()`, character classification
3. `KhmerBreaker` with `beamSegment()`, `getSegments()`, `insertBreakOpportunities()`
4. Punctuation sets (`CLOSING_PUNCTUATION`, `OPENING_PUNCTUATION`, `CONNECTOR_CHARS`)
5. Affix definitions (`khmer-affixes.ts`)
6. Dictionary data

This gets you correct word breaking with ~1,500 lines of code instead of ~2,640.

---

## Unicode Quick Reference

| Char | Code | Name | Significance |
|------|------|------|-------------|
| ្ | U+17D2 | COENG | Subscript consonant marker. NEVER break before/after. |
| ់ | U+17CB | BANTOC | Final consonant marker. "Dangling bantoc" = misbreak. |
| ៗ | U+17D7 | LEK TOO | Repetition sign. Must stay with preceding word. |
| ័ | U+17D0 | SAMYOK SANNYA | Never break after this. |
| ។ | U+17D4 | KHAN | Khmer full stop (period). |
| ​ | U+200B | ZWSP | Zero-width space. Insert at word boundaries. |
| ⁠ | U+2060 | WJ | Word Joiner. Prevents breaks (user override). |
| ‌ | U+200C | ZWNJ | Zero-width non-joiner. Rendering only. |
| ‍ | U+200D | ZWJ | Zero-width joiner. Rendering only. |

### Khmer Unicode Block Ranges

| Range | Description |
|-------|-------------|
| U+1780-U+17A2 | Consonants (35 chars) |
| U+17A3-U+17B3 | Independent vowels (17 chars) |
| U+17B4-U+17C5 | Dependent vowels (18 chars) |
| U+17C6-U+17D1 | Signs / combining marks (12 chars) |
| U+17D2 | COENG (subscript marker) |
| U+17D3 | BATHAMASAT (combining mark) |
| U+17D4-U+17DA | Punctuation (excluding U+17D7 ៗ) |
| U+17DB | Currency symbol (៛) |
| U+17DC | Letter AHVAR |
| U+17DD | ATTHACAN (combining mark) |
| U+17E0-U+17E9 | Digits ០-៩ |

### Khmer Syllable Structure (Unicode spec)

```
Khmer-syllable ::= (K H)* K M*
  K = consonant or independent vowel (base character)
  H = COENG (្, U+17D2)
  M = combining mark (dependent vowel or sign)
```

Example: ស្រុក = ស (K) + ្ (H) + រ (K) + ុ (M) + ក (K)
