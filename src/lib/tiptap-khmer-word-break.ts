/**
 * TipTap Extension: Khmer Word Break
 *
 * Inserts zero-width spaces (ZWSP) at Khmer word boundaries on demand.
 * Designed for integration into editors that handle Khmer text.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import KhmerBreaker from './khmer-breaker'
import { KHMER_DICTIONARY } from './khmer-dictionary-data'

const ZWSP = "\u200B"

// Regex to detect Khmer characters
const KHMER_REGEX = /[\u1780-\u17FF]/

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    khmerWordBreak: {
      insertKhmerBreaks: () => ReturnType
      removeKhmerBreaks: () => ReturnType
      toggleZwspVisibility: () => ReturnType
    }
  }
}

export interface KhmerWordBreakOptions {
  /**
   * URL for the full async dictionary. Set to null to skip async loading.
   */
  dictionaryUrl: string | null
  /**
   * Whether to show ZWSP markers in the editor
   */
  showZwsp: boolean
}

export const khmerWordBreakPluginKey = new PluginKey('khmerWordBreak')

export const KhmerWordBreakExtension = Extension.create<KhmerWordBreakOptions>({
  name: 'khmerWordBreak',

  addOptions() {
    return {
      dictionaryUrl: '/dictionaries/km_frequency_dictionary.json',
      showZwsp: false,
    }
  },

  addStorage() {
    return {
      breaker: null as KhmerBreaker | null,
      showZwsp: false,
      dictionaryReady: false,
    }
  },

  onCreate() {
    const breaker = new KhmerBreaker(KHMER_DICTIONARY)
    this.storage.breaker = breaker
    this.storage.showZwsp = this.options.showZwsp
    this.storage.dictionaryReady = true

    // Load full dictionary async
    if (this.options.dictionaryUrl) {
      breaker.loadFullDictionaryAsync(this.options.dictionaryUrl).then(() => {
        this.storage.dictionaryReady = true
        console.log('[KhmerWordBreak] Full dictionary loaded')
      })
    }
  },

  addCommands() {
    return {
      insertKhmerBreaks: () => ({ tr, state, dispatch }) => {
        const breaker = this.storage.breaker as KhmerBreaker | null
        if (!breaker) return false

        const { doc } = state

        // Collect all text replacements needed
        const replacements: Array<{ from: number; to: number; text: string }> = []

        doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return

          const text = node.text

          // Skip if no Khmer characters
          if (!KHMER_REGEX.test(text)) return

          // Strip existing ZWSP before re-breaking
          const stripped = text.replace(/\u200B/g, '')
          const broken = breaker.insertBreakOpportunities(stripped)

          // Only replace if something changed
          if (broken !== text) {
            replacements.push({
              from: pos,
              to: pos + text.length,
              text: broken,
            })
          }
        })

        if (replacements.length === 0) return false

        if (dispatch) {
          // Apply replacements in reverse order to maintain position accuracy
          for (let i = replacements.length - 1; i >= 0; i--) {
            const { from, to, text } = replacements[i]
            tr.insertText(text, from, to)
          }
        }

        return true
      },

      removeKhmerBreaks: () => ({ tr, state, dispatch }) => {
        const { doc } = state
        const replacements: Array<{ from: number; to: number; text: string }> = []

        doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return
          if (!node.text.includes(ZWSP)) return

          const cleaned = node.text.replace(/\u200B/g, '')
          replacements.push({
            from: pos,
            to: pos + node.text.length,
            text: cleaned,
          })
        })

        if (replacements.length === 0) return false

        if (dispatch) {
          for (let i = replacements.length - 1; i >= 0; i--) {
            const { from, to, text } = replacements[i]
            tr.insertText(text, from, to)
          }
        }

        return true
      },

      toggleZwspVisibility: () => ({ editor }) => {
        this.storage.showZwsp = !this.storage.showZwsp

        // Force a view update to re-render decorations
        const { tr } = editor.state
        editor.view.dispatch(tr.setMeta(khmerWordBreakPluginKey, { showZwsp: this.storage.showZwsp }))

        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: khmerWordBreakPluginKey,
        state: {
          init(_, { doc }) {
            if (!storage.showZwsp) return DecorationSet.empty
            return buildDecorations(doc)
          },
          apply(tr, oldSet) {
            const meta = tr.getMeta(khmerWordBreakPluginKey)
            if (meta?.showZwsp !== undefined) {
              if (meta.showZwsp) {
                return buildDecorations(tr.doc)
              }
              return DecorationSet.empty
            }

            if (!storage.showZwsp) return DecorationSet.empty

            if (tr.docChanged) {
              return buildDecorations(tr.doc)
            }

            return oldSet
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.descendants((node: any, pos: number) => {
    if (!node.isText || !node.text) return

    const text = node.text as string
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ZWSP) {
        // Inline decoration wrapping the ZWSP character itself — no extra DOM node
        decorations.push(
          Decoration.inline(pos + i, pos + i + 1, {
            class: 'zwsp-marker',
          })
        )
      }
    }
  })

  return DecorationSet.create(doc, decorations)
}

export default KhmerWordBreakExtension
