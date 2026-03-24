/**
 * TipTap Extension: Spell Check (SymSpell)
 *
 * Uses a Web Worker with SymSpell for fast, continuous spell checking.
 * Marks misspelled words with wavy underline decorations.
 * Click a misspelled word to see suggestions.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { SpellCheckWorkerManager } from './spell-check-types'
import KhmerBreaker from './khmer-breaker'
import { KHMER_DICTIONARY } from './khmer-dictionary-data'

const ZWSP = "\u200B"

function isKhmerLetter(code: number): boolean {
  return code >= 0x1780 && code <= 0x17ff && !(code >= 0x17e0 && code <= 0x17e9)
}

function hasKhmerLetters(text: string): boolean {
  for (const char of text) {
    if (isKhmerLetter(char.codePointAt(0) || 0)) return true
  }
  return false
}

function cleanWord(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\u2060]/g, '')
    .replace(/[\u17D4-\u17DA]/g, '')
    .replace(/[.,!?;:'"()\[\]{}]/g, '')
    .replace(/[\u00AB\u00BB\u2018-\u201F\u2039\u203A]/g, '')
    .replace(/[\u2013\u2014\u2026]/g, '')
    .trim()
}

function isCheckableWord(word: string): boolean {
  if (!word || word.length === 0) return false
  if (!hasKhmerLetters(word)) return false
  if (/^[\u17E0-\u17E9]+$/.test(word)) return false
  return true
}

/**
 * Find word boundaries in text.
 *
 * Strategy: split on whitespace first (preserving positions), then within each
 * whitespace-delimited chunk, split on ZWSP if present. This means:
 * - Before word breaking: whole space-separated tokens are checked (e.g., "សាសណា")
 * - After word breaking: ZWSP-separated words are checked (e.g., "សាស|នា")
 *
 * We strip ZWSP from the cleaned word so the spell checker sees the original form.
 */
function findWords(text: string): Array<{ word: string; from: number; to: number }> {
  const words: Array<{ word: string; from: number; to: number }> = []

  // Split on whitespace and Khmer punctuation, keeping positions
  const delimiterPattern = /[\s\u17D4-\u17DA.,!?;:'"()\[\]{}\u00AB\u00BB\u2018-\u201F\u2039\u203A\u2013\u2014\u2026]+/g

  const delimiters: Array<{ from: number; to: number }> = []
  let match: RegExpExecArray | null
  while ((match = delimiterPattern.exec(text)) !== null) {
    delimiters.push({ from: match.index, to: match.index + match[0].length })
  }

  // Extract chunks between delimiters (these are whitespace-separated runs)
  const chunks: Array<{ text: string; from: number }> = []
  let pos = 0
  for (const d of delimiters) {
    if (d.from > pos) {
      chunks.push({ text: text.substring(pos, d.from), from: pos })
    }
    pos = d.to
  }
  if (pos < text.length) {
    chunks.push({ text: text.substring(pos), from: pos })
  }

  // Within each chunk, split on ZWSP to get individual words
  for (const chunk of chunks) {
    const zwspParts = chunk.text.split('\u200B')
    let offset = chunk.from
    for (const part of zwspParts) {
      if (part.length > 0) {
        words.push({ word: part, from: offset, to: offset + part.length })
      }
      offset += part.length + 1 // +1 for the ZWSP
    }
  }

  return words
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spellCheck: {
      toggleSpellCheck: () => ReturnType
    }
  }
}

export interface SpellCheckOptions {
  language: string
  /** SymSpell dictionary URL (TSV format for the Web Worker) */
  dictionaryUrl: string
  /** Full frequency dictionary URL (JSON format for the word breaker) */
  frequencyDictionaryUrl: string
  workerUrl: string
  debounceMs: number
  enabled: boolean
}

export const spellCheckPluginKey = new PluginKey('spellCheck')

export const SpellCheckExtension = Extension.create<SpellCheckOptions>({
  name: 'spellCheck',

  addOptions() {
    return {
      language: 'km',
      dictionaryUrl: '/dictionaries/km_symspell_dictionary.txt',
      frequencyDictionaryUrl: '/dictionaries/km_frequency_dictionary.json',
      workerUrl: '/workers/spell-check-worker.js',
      debounceMs: 300,
      enabled: true,
    }
  },

  addStorage() {
    return {
      enabled: false,
      manager: null as SpellCheckWorkerManager | null,
      breaker: null as KhmerBreaker | null,
      misspelled: new Map<string, boolean>(),
      ignoredWords: new Set<string>(),
      ready: false,
      _cleanup: null as (() => void) | null,
    }
  },

  onCreate() {
    if (!this.options.enabled) return

    this.storage.enabled = true
    const manager = new SpellCheckWorkerManager()
    this.storage.manager = manager
    const editor = this.editor

    // Share the breaker from the word break extension so both use
    // the exact same dictionary and segmentation. Fall back to creating
    // our own if the word break extension isn't loaded.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wordBreakStorage = (editor.extensionStorage as any).khmerWordBreak
    const sharedBreaker = wordBreakStorage?.breaker as KhmerBreaker | null

    if (sharedBreaker) {
      this.storage.breaker = sharedBreaker
    } else {
      // Fallback: create our own breaker
      const breaker = new KhmerBreaker(KHMER_DICTIONARY)
      this.storage.breaker = breaker
      breaker.loadFullDictionaryAsync(this.options.frequencyDictionaryUrl)
    }

    // Wait for: SymSpell worker + word break extension's full dictionary
    const symspellReady = manager.init(
      this.options.dictionaryUrl,
      `${this.options.language}_symspell`,
      this.options.workerUrl,
    )

    // Wait for word breaker's full dict to load (poll since it loads async)
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false
    this.storage._cleanup = () => { destroyed = true; if (pollTimer) clearTimeout(pollTimer) }

    const breakerReady = new Promise<void>((resolve) => {
      const check = () => {
        if (destroyed) return
        const breaker = this.storage.breaker as KhmerBreaker
        if (breaker.isFullDictionaryLoaded()) {
          resolve()
        } else {
          pollTimer = setTimeout(check, 100)
        }
      }
      check()
    })

    Promise.all([symspellReady, breakerReady]).then(async ([wordCount]) => {
      if (destroyed) return
      this.storage.ready = true
      console.log(`[SpellCheck] Ready — SymSpell: ${wordCount} words, shared breaker: full dict loaded`)
      try {
        await doSpellCheck(editor.view, this.storage)
      } catch {
        // View may have been destroyed between ready and check
      }
    }).catch((err) => {
      if (!destroyed) console.error('[SpellCheck] Failed to init:', err)
    })
  },

  onDestroy() {
    // Clean up polling timer
    if (this.storage._cleanup) this.storage._cleanup()
    if (this.storage.manager) {
      this.storage.manager.terminate()
      this.storage.manager = null
    }
  },

  addCommands() {
    return {
      toggleSpellCheck: () => ({ editor }) => {
        this.storage.enabled = !this.storage.enabled

        if (!this.storage.enabled) {
          // Clear decorations
          const { tr } = editor.state
          editor.view.dispatch(tr.setMeta(spellCheckPluginKey, { clear: true }))
          this.storage.misspelled.clear()
        } else if (this.storage.ready) {
          // Re-run spell check
          doSpellCheck(editor.view, this.storage)
        }

        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const options = this.options
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    return [
      new Plugin({
        key: spellCheckPluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldSet, _oldState, newState) {
            const meta = tr.getMeta(spellCheckPluginKey)

            if (meta?.clear) return DecorationSet.empty
            if (!storage.enabled) return DecorationSet.empty

            if (meta?.results) {
              return buildSpellDecorations(newState.doc, storage.misspelled, storage.ignoredWords, storage.breaker)
            }

            if (tr.docChanged) {
              return oldSet.map(tr.mapping, tr.doc)
            }

            return oldSet
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleClick(view, pos) {
            if (!storage.enabled || !storage.ready) return false

            const decoSet = spellCheckPluginKey.getState(view.state)
            if (!decoSet) return false

            const decos = decoSet.find(
              Math.max(0, pos - 1),
              Math.min(view.state.doc.content.size, pos + 1),
            )
            if (decos.length === 0) return false

            const deco = decos.find((d: any) => d.from <= pos && d.to >= pos)
            if (!deco) return false

            // Extract the word directly from the document text
            const rawText = view.state.doc.textBetween(deco.from, deco.to, '')
            const word = cleanWord(rawText)
            if (!word) return false

            // Get suggestions, but always show popover (even with none)
            storage.manager?.suggest(word).then((suggestions: string[]) => {
              const event = new CustomEvent('spellcheck-suggestions', {
                detail: { word, suggestions, from: deco.from, to: deco.to, pos },
              })
              view.dom.dispatchEvent(event)
            }).catch(() => {
              // Show popover even on error so user can ignore
              const event = new CustomEvent('spellcheck-suggestions', {
                detail: { word, suggestions: [], from: deco.from, to: deco.to, pos },
              })
              view.dom.dispatchEvent(event)
            })

            return false
          },
        },
        view() {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update(view: any, prevState: any) {
              if (!storage.enabled || !storage.ready) return
              if (view.state.doc.eq(prevState.doc)) return

              if (debounceTimer) clearTimeout(debounceTimer)
              debounceTimer = setTimeout(() => {
                doSpellCheck(view, storage)
              }, options.debounceMs)
            },
            destroy() {
              if (debounceTimer) clearTimeout(debounceTimer)
            },
          }
        },
      }),
    ]
  },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Extract words from a text node for spell checking.
 *
 * If the text contains ZWSP (word breaks already inserted), split on ZWSP
 * and check each segment — this ensures spell check uses the SAME boundaries
 * as the word breaker. If no ZWSP present, use the breaker to segment first.
 */
function getWordsForSpellCheck(
  text: string,
  breaker: KhmerBreaker | null,
): Array<{ word: string; from: number; to: number }> {
  const words: Array<{ word: string; from: number; to: number }> = []

  // Strategy: split on ZWSP, whitespace, and punctuation to get word tokens
  // with their exact positions in the source text
  let wordStart = -1

  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : ' ' // sentinel
    const isDelimiter = ch === ZWSP || /\s/.test(ch) ||
      (ch.codePointAt(0)! >= 0x17d4 && ch.codePointAt(0)! <= 0x17da) ||
      '.,!?;:()[]{}"\'-'.includes(ch)

    if (isDelimiter) {
      if (wordStart >= 0) {
        const raw = text.substring(wordStart, i)
        // Clean: strip any stray ZWSP inside the token
        const cleaned = raw.replace(/\u200B/g, '')
        if (cleaned.length > 0) {
          words.push({ word: cleaned, from: wordStart, to: i })
        }
        wordStart = -1
      }
    } else {
      if (wordStart < 0) wordStart = i
    }
  }

  // If text has no ZWSP and contains Khmer, use the breaker to find word boundaries
  // within long unsegmented runs
  if (!text.includes(ZWSP) && breaker && words.length > 0) {
    const expandedWords: Array<{ word: string; from: number; to: number }> = []
    for (const w of words) {
      if (hasKhmerLetters(w.word) && w.word.length > 10) {
        // Long unsegmented Khmer — use breaker
        const segs = breaker.getSegments(w.word)
        let offset = w.from
        for (const seg of segs) {
          if (/^\s+$/.test(seg)) continue
          const clean = seg.replace(/\u200B/g, '')
          if (clean.length > 0) {
            const idx = text.indexOf(seg, offset)
            const from = idx >= 0 ? idx : offset
            expandedWords.push({ word: clean, from, to: from + seg.length })
            offset = from + seg.length
          }
        }
      } else {
        expandedWords.push(w)
      }
    }
    return expandedWords
  }

  return words
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSpellDecorations(doc: any, misspelled: Map<string, boolean>, ignoredWords: Set<string>, breaker: KhmerBreaker | null): DecorationSet {
  const decorations: Decoration[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return
    const text = node.text as string
    if (!hasKhmerLetters(text)) return

    const words = getWordsForSpellCheck(text, breaker)
    for (const w of words) {
      if (!isCheckableWord(w.word)) continue
      if (ignoredWords.has(w.word)) continue
      if (!misspelled.get(w.word)) continue

      decorations.push(
        Decoration.inline(pos + w.from, pos + w.to, {
          class: 'spellcheck-misspelled',
          'data-misspelled': w.word,
        })
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doSpellCheck(view: any, storage: any) {
  if (!storage.enabled || !storage.ready || !storage.manager) return

  const { doc } = view.state
  const wordsToCheck = new Set<string>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return
    const text = node.text as string
    if (!hasKhmerLetters(text)) return

    const words = getWordsForSpellCheck(text, storage.breaker)
    for (const w of words) {
      if (!isCheckableWord(w.word)) continue
      if (storage.ignoredWords.has(w.word)) continue
      wordsToCheck.add(w.word)
    }
  })

  if (wordsToCheck.size === 0) return

  try {
    const results = await storage.manager.batchCheck([...wordsToCheck])

    // Guard: view may have been destroyed during async batch check
    if (!storage.enabled || !view.dom?.parentNode) return

    for (const [word, correct] of Object.entries(results)) {
      storage.misspelled.set(word, !correct)
    }

    const { tr } = view.state
    view.dispatch(tr.setMeta(spellCheckPluginKey, { results: true }))
  } catch (err) {
    // Ignore errors from destroyed views
    if (storage.enabled) {
      console.error('[SpellCheck] Batch check failed:', err)
    }
  }
}

export default SpellCheckExtension
