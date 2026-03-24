"use client"

import { useEditor, EditorContent } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import { KhmerWordBreakExtension } from '@/lib/tiptap-khmer-word-break'
import { SpellCheckExtension, spellCheckPluginKey } from '@/lib/tiptap-spell-check'
import { MultipleSpellingsExtension } from '@/lib/tiptap-multiple-spellings'
import { useState, useCallback, useEffect, useRef } from 'react'

const BASE_PATH = process.env.NODE_ENV === 'production' ? '/tiptap-khmer-line-breaker' : ''

// Sample with 3 intentional misspellings (all edit distance 1):
//   សាសណា → សាសនា (ណ→ន)
//   កម្ពុថា → កម្ពុជា (ថ→ជ)
//   ប្រជាពន → ប្រជាជន (ព→ជ)
// Also includes non-standard spelling: ដំបន់ (should be តំបន់) — blue underline
// No extra spaces — natural Khmer text without word separators.
const SAMPLE_TEXT = `ព្រះពុទ្ធសាសណាជាសាសនាចម្បងរបស់ប្រជាពនកម្ពុថា។ ប្រទេសកម្ពុជាមានទីតាំងស្ថិតនៅក្នុងដំបន់អាស៊ីអាគ្នេយ៍ ហើយមានប្រជាជនប្រមាណ១៧លាននាក់។ រាជធានីភ្នំពេញគឺជាទីក្រុងធំជាងគេនៅក្នុងប្រទេសកម្ពុជា។`

interface SuggestionState {
  word: string
  suggestions: string[]
  from: number
  to: number
  x: number
  y: number
}

interface GrammarSuggestionState {
  word: string
  standard: string
  from: number
  to: number
  x: number
  y: number
}

export default function KhmerEditor() {
  const [showZwsp, setShowZwsp] = useState(false)
  const [breakCount, setBreakCount] = useState(0)
  const [dictStatus, setDictStatus] = useState<'loading' | 'partial' | 'full'>('loading')
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(true)
  const [spellCheckReady, setSpellCheckReady] = useState(false)
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null)
  const [grammarSuggestion, setGrammarSuggestion] = useState<GrammarSuggestionState | null>(null)
  const editorWrapperRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      History,
      KhmerWordBreakExtension.configure({
        dictionaryUrl: `${BASE_PATH}/dictionaries/km_frequency_dictionary.json`,
        showZwsp: false,
      }),
      SpellCheckExtension.configure({
        language: 'km',
        dictionaryUrl: `${BASE_PATH}/dictionaries/km_symspell_dictionary.txt`,
        frequencyDictionaryUrl: `${BASE_PATH}/dictionaries/km_frequency_dictionary.json`,
        symspellUrl: `${BASE_PATH}/lib/symspell-browser.js`,
        workerUrl: `${BASE_PATH}/workers/spell-check-worker.js`,
        debounceMs: 300,
        enabled: true,
      }),
      MultipleSpellingsExtension.configure({
        rulesUrl: `${BASE_PATH}/dictionaries/khmer-multiple-spellings.txt`,
        enabled: true,
      }),
    ],
    content: `<p>${SAMPLE_TEXT}</p>`,
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'false',
      },
    },
  })

  // Track word breaker dictionary loading
  useEffect(() => {
    if (!editor) return
    setDictStatus('partial')
    const checkDict = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = (editor.extensionStorage as any).khmerWordBreak
      if (storage?.breaker?.isFullDictionaryLoaded()) {
        setDictStatus('full')
        clearInterval(checkDict)
      }
    }, 500)
    return () => clearInterval(checkDict)
  }, [editor])

  // Track spell check readiness
  useEffect(() => {
    if (!editor) return
    const checkReady = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = (editor.extensionStorage as any).spellCheck
      if (storage?.ready) {
        setSpellCheckReady(true)
        clearInterval(checkReady)
      }
    }, 500)
    return () => clearInterval(checkReady)
  }, [editor])

  // Listen for spell check suggestion events
  useEffect(() => {
    if (!editor) return
    const handleSuggestions = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail || !editorWrapperRef.current) return
      const coords = editor.view.coordsAtPos(detail.from)
      const wrapperRect = editorWrapperRef.current.getBoundingClientRect()
      setGrammarSuggestion(null) // close grammar popover
      setSuggestion({
        word: detail.word,
        suggestions: detail.suggestions,
        from: detail.from,
        to: detail.to,
        x: Math.min(coords.left - wrapperRect.left, wrapperRect.width - 200),
        y: coords.bottom - wrapperRect.top + 6,
      })
    }
    const editorDom = editor.view.dom
    editorDom.addEventListener('spellcheck-suggestions', handleSuggestions)
    return () => editorDom.removeEventListener('spellcheck-suggestions', handleSuggestions)
  }, [editor])

  // Listen for grammar (non-standard spelling) suggestion events
  useEffect(() => {
    if (!editor) return
    const handleGrammar = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail || !editorWrapperRef.current) return
      const coords = editor.view.coordsAtPos(detail.from)
      const wrapperRect = editorWrapperRef.current.getBoundingClientRect()
      setSuggestion(null) // close spell popover
      setGrammarSuggestion({
        word: detail.word,
        standard: detail.standard,
        from: detail.from,
        to: detail.to,
        x: Math.min(coords.left - wrapperRect.left, wrapperRect.width - 200),
        y: coords.bottom - wrapperRect.top + 6,
      })
    }
    const editorDom = editor.view.dom
    editorDom.addEventListener('grammar-suggestion', handleGrammar)
    return () => editorDom.removeEventListener('grammar-suggestion', handleGrammar)
  }, [editor])

  // Close any popover on click outside or Escape
  useEffect(() => {
    if (!suggestion && !grammarSuggestion) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.spell-popover')) {
        setSuggestion(null)
        setGrammarSuggestion(null)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSuggestion(null)
        setGrammarSuggestion(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [suggestion, grammarSuggestion])

  const handleInsertBreaks = useCallback(() => {
    if (!editor) return
    editor.chain().focus().insertKhmerBreaks().run()
    let count = 0
    editor.state.doc.descendants((node) => {
      if (node.isText && node.text) {
        for (const ch of node.text) {
          if (ch === '\u200B') count++
        }
      }
    })
    setBreakCount(count)
  }, [editor])

  const handleRemoveBreaks = useCallback(() => {
    if (!editor) return
    editor.chain().focus().removeKhmerBreaks().run()
    setBreakCount(0)
  }, [editor])

  const handleToggleVisibility = useCallback(() => {
    if (!editor) return
    editor.commands.toggleZwspVisibility()
    setShowZwsp(prev => !prev)
  }, [editor])

  const handleToggleSpellCheck = useCallback(() => {
    if (!editor) return
    editor.commands.toggleSpellCheck()
    setSpellCheckEnabled(prev => !prev)
  }, [editor])

  const handleReplaceSuggestion = useCallback((replacement: string) => {
    if (!editor || !suggestion) return
    editor.chain()
      .focus()
      .insertContentAt({ from: suggestion.from, to: suggestion.to }, replacement)
      .run()
    setSuggestion(null)
  }, [editor, suggestion])

  const handleIgnoreWord = useCallback(() => {
    if (!editor || !suggestion) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = (editor.extensionStorage as any).spellCheck
    if (storage) {
      storage.ignoredWords.add(suggestion.word)
      storage.misspelled.delete(suggestion.word)
      const { tr } = editor.state
      editor.view.dispatch(tr.setMeta(spellCheckPluginKey, { results: true }))
    }
    setSuggestion(null)
  }, [editor, suggestion])

  const handleReplaceGrammar = useCallback((standard: string) => {
    if (!editor || !grammarSuggestion) return
    editor.chain()
      .focus()
      .insertContentAt({ from: grammarSuggestion.from, to: grammarSuggestion.to }, standard)
      .run()
    setGrammarSuggestion(null)
  }, [editor, grammarSuggestion])

  const handleLoadSample = useCallback(() => {
    if (!editor) return
    editor.commands.setContent(`<p>${SAMPLE_TEXT}</p>`)
    setBreakCount(0)
  }, [editor])

  if (!editor) return null

  return (
    <div className="space-y-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        {/* Primary action */}
        <button
          onClick={handleInsertBreaks}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          style={{ backgroundColor: '#c4553a' }}
        >
          Insert Word Breaks
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-[#e0ddd8] mx-1" />

        {/* Secondary actions */}
        <button
          onClick={handleRemoveBreaks}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#4a4a6a] border border-[#e0ddd8] bg-white hover:bg-[#f5f3ef] active:bg-[#ece8e2] transition-colors"
        >
          Remove
        </button>
        <button
          onClick={handleToggleVisibility}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
            showZwsp
              ? 'border-[#c4553a]/30 bg-[#c4553a]/5 text-[#c4553a]'
              : 'border-[#e0ddd8] bg-white text-[#4a4a6a] hover:bg-[#f5f3ef]'
          }`}
        >
          {showZwsp ? 'Hide ZWSP' : 'Show ZWSP'}
        </button>
        <button
          onClick={handleToggleSpellCheck}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
            spellCheckEnabled
              ? 'border-[#c4553a]/30 bg-[#c4553a]/5 text-[#c4553a]'
              : 'border-[#e0ddd8] bg-white text-[#4a4a6a] hover:bg-[#f5f3ef]'
          }`}
        >
          Spell Check {spellCheckEnabled ? 'On' : 'Off'}
        </button>

        <div className="flex-1" />

        <button
          onClick={handleLoadSample}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#8888a8] hover:text-[#4a4a6a] transition-colors"
        >
          Reset sample
        </button>
      </div>

      {/* Editor card */}
      <div
        ref={editorWrapperRef}
        className={`relative rounded-2xl border bg-white transition-shadow ${
          showZwsp ? 'zwsp-visible' : ''
        }`}
        style={{
          borderColor: '#e0ddd8',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.02)',
        }}
      >
        <EditorContent editor={editor} />

        {/* Suggestion popover */}
        {suggestion && (
          <div
            className="spell-popover"
            style={{ left: suggestion.x, top: suggestion.y }}
          >
            {/* Header with misspelled word */}
            <div
              className="px-3 py-2 border-b border-[#e0ddd8]/60 flex items-center gap-2"
              style={{ backgroundColor: '#fafaf8' }}
            >
              <span
                className="font-medium text-sm"
                style={{ fontFamily: '"Noto Sans Khmer", sans-serif', color: '#c4553a' }}
              >
                {suggestion.word}
              </span>
              <span className="text-[10px] text-[#8888a8] uppercase tracking-wider">
                misspelled
              </span>
            </div>

            {/* Suggestions */}
            <div className="py-1">
              {suggestion.suggestions.length > 0 ? (
                suggestion.suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleReplaceSuggestion(s)}
                    className="spell-popover-item"
                  >
                    {s}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-[#8888a8] italic">
                  No suggestions found
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-[#e0ddd8]/60 py-1">
              <button
                onClick={handleIgnoreWord}
                className="spell-popover-item !text-xs !text-[#8888a8] hover:!text-[#4a4a6a]"
              >
                Ignore this word
              </button>
            </div>
          </div>
        )}

        {/* Grammar suggestion popover (non-standard spelling) */}
        {grammarSuggestion && (
          <div
            className="spell-popover"
            style={{ left: grammarSuggestion.x, top: grammarSuggestion.y }}
          >
            <div
              className="px-3 py-2 border-b border-[#e0ddd8]/60 flex items-center gap-2"
              style={{ backgroundColor: '#fafaf8' }}
            >
              <span
                className="font-medium text-sm"
                style={{ fontFamily: '"Noto Sans Khmer", sans-serif', color: '#4a7fc4' }}
              >
                {grammarSuggestion.word}
              </span>
              <span className="text-[10px] text-[#8888a8] uppercase tracking-wider">
                non-standard
              </span>
            </div>

            <div className="py-1">
              <button
                onClick={() => handleReplaceGrammar(grammarSuggestion.standard)}
                className="spell-popover-item"
              >
                {grammarSuggestion.standard}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 mt-2.5 px-1 text-[11px] text-[#8888a8]">
        {breakCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: '#c4553a' }}
            />
            {breakCount} word breaks
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: dictStatus === 'full' ? '#3a7d5c' : '#b8860b',
            }}
          />
          {dictStatus === 'full' ? '50K words' : dictStatus === 'partial' ? '5K words' : 'Loading...'}
        </span>
        {spellCheckEnabled && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: spellCheckReady ? '#3a7d5c' : '#b8860b',
              }}
            />
            {spellCheckReady ? 'Spell check ready' : 'Loading spell check...'}
          </span>
        )}
        <span className="flex-1" />
        <span>
          <span className="underline decoration-wavy" style={{ textDecorationColor: '#c4553a', textUnderlineOffset: '2px' }}>Misspelled</span>
          {' '}&middot;{' '}
          <span className="underline decoration-wavy" style={{ textDecorationColor: '#4a7fc4', textUnderlineOffset: '2px' }}>Non-standard</span>
          {' '}&mdash; click for suggestions
        </span>
      </div>
    </div>
  )
}
