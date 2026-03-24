/**
 * TipTap Extension: Multiple Spellings (Non-Standard Spelling Detection)
 *
 * Detects non-standard Khmer spellings using a rules file and marks them
 * with a blue underline. Click to see the standardized form and replace.
 *
 * This is NOT spell checking — these are real words that many Khmer speakers
 * use, but they differ from the standardized spelling per the Khmer Dictionary
 * of the Buddhist Institute.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type KhmerBreaker from './khmer-breaker'

const ZWSP = "\u200B"

interface SpellingRule {
  standard: string
  alternatives: string[]
}

function parseSpellingRules(content: string): Map<string, SpellingRule> {
  const rules = new Map<string, SpellingRule>()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const alternativesPart = trimmed.slice(0, eqIndex)
    const standard = trimmed.slice(eqIndex + 1).trim()
    if (!standard) continue

    const alternatives = alternativesPart
      .split('|')
      .map(s => s.trim())
      .filter(Boolean)

    for (const alt of alternatives) {
      rules.set(alt, { standard, alternatives })
    }
  }

  return rules
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

function hasKhmerLetters(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) || 0
    if (code >= 0x1780 && code <= 0x17ff && !(code >= 0x17e0 && code <= 0x17e9)) return true
  }
  return false
}

/**
 * Extract words from text using ZWSP and whitespace as delimiters.
 */
function getWords(text: string): Array<{ word: string; from: number; to: number }> {
  const words: Array<{ word: string; from: number; to: number }> = []
  let wordStart = -1

  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : ' '
    const isDelimiter = ch === ZWSP || /\s/.test(ch) ||
      (ch.codePointAt(0)! >= 0x17d4 && ch.codePointAt(0)! <= 0x17da) ||
      '.,!?;:()[]{}"\'-'.includes(ch)

    if (isDelimiter) {
      if (wordStart >= 0) {
        const raw = text.substring(wordStart, i)
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

  return words
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    multipleSpellings: {
      toggleMultipleSpellings: () => ReturnType
    }
  }
}

export interface MultipleSpellingsOptions {
  rulesUrl: string
  enabled: boolean
}

export const multipleSpellingsPluginKey = new PluginKey('multipleSpellings')

export const MultipleSpellingsExtension = Extension.create<MultipleSpellingsOptions>({
  name: 'multipleSpellings',

  addOptions() {
    return {
      rulesUrl: '/dictionaries/khmer-multiple-spellings.txt',
      enabled: true,
    }
  },

  addStorage() {
    return {
      enabled: false,
      rules: null as Map<string, SpellingRule> | null,
      ready: false,
    }
  },

  onCreate() {
    if (!this.options.enabled) return

    this.storage.enabled = true
    const editor = this.editor

    fetch(this.options.rulesUrl)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch rules: ${res.status}`)
        return res.text()
      })
      .then(content => {
        this.storage.rules = parseSpellingRules(content)
        this.storage.ready = true
        console.log(`[MultipleSpellings] Loaded ${this.storage.rules.size} rules`)

        // Trigger initial check
        const { tr } = editor.state
        editor.view.dispatch(tr.setMeta(multipleSpellingsPluginKey, { check: true }))
      })
      .catch(err => {
        console.error('[MultipleSpellings] Failed to load rules:', err)
      })
  },

  addCommands() {
    return {
      toggleMultipleSpellings: () => ({ editor }) => {
        this.storage.enabled = !this.storage.enabled

        if (!this.storage.enabled) {
          const { tr } = editor.state
          editor.view.dispatch(tr.setMeta(multipleSpellingsPluginKey, { clear: true }))
        } else if (this.storage.ready) {
          const { tr } = editor.state
          editor.view.dispatch(tr.setMeta(multipleSpellingsPluginKey, { check: true }))
        }

        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    return [
      new Plugin({
        key: multipleSpellingsPluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldSet, _oldState, newState) {
            const meta = tr.getMeta(multipleSpellingsPluginKey)

            if (meta?.clear) return DecorationSet.empty
            if (!storage.enabled || !storage.ready || !storage.rules) return DecorationSet.empty

            if (meta?.check) {
              return buildDecorations(newState.doc, storage.rules)
            }

            if (tr.docChanged) {
              // Map existing decorations through the change, then rebuild
              // (rebuild is cheap since it's just Map lookups)
              return buildDecorations(newState.doc, storage.rules)
            }

            return oldSet
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleClick(view, pos) {
            if (!storage.enabled || !storage.ready || !storage.rules) return false

            const decoSet = multipleSpellingsPluginKey.getState(view.state)
            if (!decoSet) return false

            const decos = decoSet.find(
              Math.max(0, pos - 1),
              Math.min(view.state.doc.content.size, pos + 1),
            )
            if (decos.length === 0) return false

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const deco = decos.find((d: any) => d.from <= pos && d.to >= pos)
            if (!deco) return false

            const rawText = view.state.doc.textBetween(deco.from, deco.to, '')
            const word = cleanWord(rawText)
            if (!word) return false

            const rule = storage.rules.get(word)
            if (!rule) return false

            const event = new CustomEvent('grammar-suggestion', {
              detail: {
                word,
                standard: rule.standard,
                from: deco.from,
                to: deco.to,
                pos,
              },
            })
            view.dom.dispatchEvent(event)

            return false
          },
        },
        view() {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update(view: any, prevState: any) {
              if (!storage.enabled || !storage.ready) return
              if (view.state.doc.eq(prevState.doc)) return

              // Debounce rebuild
              if (debounceTimer) clearTimeout(debounceTimer)
              debounceTimer = setTimeout(() => {
                const { tr } = view.state
                view.dispatch(tr.setMeta(multipleSpellingsPluginKey, { check: true }))
              }, 200)
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
function buildDecorations(doc: any, rules: Map<string, SpellingRule>): DecorationSet {
  const decorations: Decoration[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return
    const text = node.text as string
    if (!hasKhmerLetters(text)) return

    const words = getWords(text)
    for (const w of words) {
      const rule = rules.get(w.word)
      if (rule && rule.standard !== w.word) {
        decorations.push(
          Decoration.inline(pos + w.from, pos + w.to, {
            class: 'grammar-nonstandard',
            'data-standard': rule.standard,
          })
        )
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

export default MultipleSpellingsExtension
