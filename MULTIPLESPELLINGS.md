# Multiple Spellings (Non-Standard Spelling Detection) - Porting Guide for Tiptap

This document covers the "multiple spellings" system from Aksara — a rule-based checker that detects non-standard Khmer spellings and suggests the standardized form. This is distinct from spell checking (misspelled words) and functions more like a grammar/style checker.

## What It Does

Many Khmer words have multiple common spellings — some standardized by the Khmer Dictionary of the Buddhist Institute, others widely used but technically non-standard. This system:

1. Loads a rules file mapping non-standard spellings to their standardized form
2. Scans words in the editor and marks non-standard spellings with a blue underline
3. Shows the standardized spelling when the user clicks a marked word
4. Allows one-click replacement with the standard form

This is **not** spell checking. These alternative spellings are real words that many Khmer speakers use — the system just flags them as non-standard per the official dictionary.

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│  Editor Plugin                                   │
│  ├── Loads rules file on mount                   │
│  ├── Parses into Map<alternative, {standard}>    │
│  ├── Scans word spans on text change (debounced) │
│  ├── Adds CSS class to non-standard words        │
│  └── On click → shows standard + replace option  │
└──────────────────────────────────────────────────┘
         │ fetches
┌────────▼─────────────────────────────────────────┐
│  khmer-multiple-spellings.txt  (~1,766 rules)    │
│  Format: alternative1|alt2=standardized          │
└──────────────────────────────────────────────────┘
```

No Web Worker needed — the rules file is small and lookups are a simple `Map.get()`.

## Files to Port

### Required

| File | Purpose |
|------|---------|
| `public/dictionaries/khmer-multiple-spellings.txt` | The rules data (~1,766 entries) |

### Not Needed (Aksara-Specific)

| File | Why |
|------|-----|
| `components/lexical/plugins/khmer-grammar-check-plugin.tsx` | Lexical-specific; write a Tiptap version |
| `components/lexical/contexts/grammar-check-context.tsx` | Aksara UI state management |

The plugin logic is simple enough that you'll rewrite it for Tiptap rather than porting it.

---

## Rules File Format

### `khmer-multiple-spellings.txt`

```
#KhmerMultipleSpellings
alternative1=standardized
alternative1|alternative2|alternative3=standardized
```

**Rules:**
- Lines starting with `#` are comments
- Empty lines are skipped
- `=` separates alternative(s) from the standardized spelling
- `|` separates multiple alternatives that map to the same standard form
- The right side of `=` is always the single standardized spelling

### Examples

```
# Single alternative → standard
បូរាណ=បុរាណ
ចំរៀង=ចម្រៀង
កំលាំង=កម្លាំង

# Multiple alternatives → same standard
មិត្តសំឡាញ់|មិត្តសំលាញ់|មិត្រសម្លាញ់=មិត្តសម្លាញ់
កែលម្អ|កែលំអរ=កែលំអ
ចា៎ះ|ច៎ះ=ចាស

# Common pattern: ចំ → ចម្ (wrong → right consonant cluster)
ចំបង=ចម្បង
ចំបាំង=ចម្បាំង
ចំរើន=ចម្រើន
ចំលែក=ចម្លែក
ចំលើយ=ចម្លើយ
```

### Common Patterns in the Rules

| Pattern | Example | Count |
|---------|---------|-------|
| Consonant cluster errors (`ចំ` → `ចម្`) | ចំរៀង → ចម្រៀង | ~50+ |
| Bantoc/vowel confusion | បូរាណ → បុរាណ | ~100+ |
| Multiple legitimate variants | កែលម្អ\|កែលំអរ → កែលំអ | ~50+ |
| Archaic vs modern | ក្សត្រិយ៍ → ក្សត្រ | ~30+ |
| Letter confusion (គ/ក, ច/ជ) | ក្រវៀច → គ្រវៀច | ~20+ |

---

## Parsing the Rules File

```typescript
interface SpellingRule {
  standard: string
  alternatives: string[]
}

function parseSpellingRules(content: string): Map<string, SpellingRule> {
  const rules = new Map<string, SpellingRule>()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    // Parse: alternatives=standard
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const alternativesPart = trimmed.slice(0, eqIndex)
    const standard = trimmed.slice(eqIndex + 1).trim()
    if (!standard) continue

    const alternatives = alternativesPart
      .split('|')
      .map(s => s.trim())
      .filter(Boolean)

    // Map each alternative to the rule
    for (const alt of alternatives) {
      rules.set(alt, { standard, alternatives })
    }
  }

  return rules
}
```

The resulting `Map` is keyed by each alternative spelling, with the value containing both the standard form and all alternatives (useful for showing "also spelled as..." in the UI).

---

## Checking Words

After parsing, checking a word is a simple map lookup:

```typescript
function isNonStandard(word: string, rules: Map<string, SpellingRule>): SpellingRule | null {
  const rule = rules.get(word)
  if (rule && rule.standard !== word) {
    return rule  // Word is a known non-standard spelling
  }
  return null  // Word is fine (either standard, or not in the rules at all)
}
```

**Important**: The standardized form itself may also be in the map (when it appears as a key alongside alternatives). Always check `rule.standard !== word` to avoid marking the standard form.

---

## Word Cleaning Before Lookup

Words may have attached punctuation. Clean them before checking:

```typescript
function cleanWord(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\u2060]/g, '') // Zero-width characters
    .replace(/[\u17D4-\u17DA]/g, '')              // Khmer punctuation
    .replace(/[.,!?;:'"()\[\]{}]/g, '')           // Common punctuation
    .replace(/[«»‹›\u201C-\u201F]/g, '')          // Quotes/guillemets
    .replace(/[\u2013\u2014\u2026]/g, '')          // Dashes, ellipsis
    .trim()
}
```

---

## Visual Marking

Non-standard spellings use a **blue** underline (distinct from red wavy for misspellings):

```css
.grammar-nonstandard {
  text-decoration: underline wavy blue;
  text-underline-offset: 3px;
}
```

This CSS class is added/removed directly on DOM spans. Use ProseMirror decorations in Tiptap.

---

## Integration with Spell Check

The multiple spellings checker and spell checker are **independent systems**:

| System | Purpose | Visual | Data Source |
|--------|---------|--------|-------------|
| Spell check | Misspelled words (not in dictionary) | Red wavy underline | SymSpell dictionary (77k words) |
| Multiple spellings | Non-standard but real spellings | Blue wavy underline | Rules file (1,766 rules) |

A word can be:
- Correct in both systems (standard spelling, in dictionary)
- Flagged by spell check only (typo, not in dictionary)
- Flagged by multiple spellings only (real word, just non-standard)
- Theoretically flagged by both (unlikely in practice)

**Processing order**: Spell check runs in a Web Worker; multiple spellings runs synchronously on the main thread. They don't need to coordinate.

---

## Tiptap Integration Approach

### 1. Load Rules on Mount

```typescript
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const multipleSpellingsKey = new PluginKey('multipleSpellings')

export const MultipleSpellings = Extension.create({
  name: 'multipleSpellings',

  addOptions() {
    return {
      rulesUrl: '/dictionaries/khmer-multiple-spellings.txt',
      enabled: true,
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: multipleSpellingsKey,
        state: {
          init() {
            // Fetch and parse rules, store in plugin state
            // Return empty DecorationSet initially
            return DecorationSet.empty
          },
          apply(tr, decorations) {
            // On doc changes, re-check affected ranges
            // Return updated DecorationSet with inline decorations
            // on non-standard words
          }
        },
        props: {
          decorations(state) {
            return multipleSpellingsKey.getState(state)
          }
        }
      })
    ]
  }
})
```

### 2. Create Decorations for Non-Standard Words

For each non-standard word found, create an inline decoration:

```typescript
const deco = Decoration.inline(wordStart, wordEnd, {
  class: 'grammar-nonstandard',
  'data-standard': rule.standard,
  'data-alternatives': rule.alternatives.join('|'),
})
```

### 3. Show Suggestions on Click

When the user clicks a decorated word, read the `data-standard` attribute and show a popover with the standardized spelling and a "Replace" button.

### 4. Replace Word

On replacement, create a ProseMirror transaction that replaces the text range:

```typescript
const tr = view.state.tr.replaceWith(
  wordStart,
  wordEnd,
  schema.text(rule.standard)
)
view.dispatch(tr)
```

---

## Incremental Scanning

For performance, only re-check words that have changed since the last scan:

```typescript
// Track what we've already checked
const previousContents = new WeakMap<Element, string>()

function scan(rootEl: HTMLElement, rules: Map<string, SpellingRule>) {
  const spans = rootEl.querySelectorAll('[data-node-type="text"]')

  for (const span of spans) {
    const text = span.textContent || ''

    // Skip unchanged spans
    if (previousContents.get(span) === text) continue
    previousContents.set(span, text)

    // Check this span's word(s)
    const cleanedWord = cleanWord(text)
    const rule = isNonStandard(cleanedWord, rules)

    if (rule) {
      span.classList.add('grammar-nonstandard')
    } else {
      span.classList.remove('grammar-nonstandard')
    }
  }
}
```

Debounce scanning to 300ms after text changes.

---

## Replacement Rules (Separate System)

Aksara also has a **replacement rules** system (`use-replacements.ts`) which is a different feature:

| Feature | Multiple Spellings | Replacement Rules |
|---------|-------------------|-------------------|
| Source | Static file (`khmer-multiple-spellings.txt`) | Database (master + per-user) |
| Purpose | Flag non-standard spellings | Auto-correct common errors |
| Behavior | Visual marking, manual accept | Automatic replacement on input |
| Scope | Display only | Modifies text |

Replacement rules auto-correct text as the user types (e.g., `វិត` → `វឹត`). They use whole-word matching via the word breaker to prevent partial replacements inside longer words.

If you want auto-replacement in Tiptap, that's a separate extension. The multiple spellings system is display-only.

---

## Multi-Language Support

The rules file format is language-agnostic. For other languages:

```
public/dictionaries/
  khmer-multiple-spellings.txt     # Khmer
  thai-multiple-spellings.txt      # Thai (if applicable)
  ...
```

Each language's rules file follows the same `alternative|alt2=standard` format. The parser, checking logic, and UI are identical — only the data file changes.

For languages with established spelling standardization bodies (like Khmer's Buddhist Institute dictionary), this system is valuable. For languages without such standards, it may not be needed.

---

## Syncing

The `khmer-multiple-spellings.txt` file is included in the GitHub Actions dictionary sync workflow. When it's updated in Aksara, it automatically syncs to both `sungkhum/lectio` and `sungkhum/tiptap-khmer-line-breaker`.
