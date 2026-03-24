/**
 * Khmer Text Breaking Utility
 * Uses Beam Search algorithm for word segmentation with frequency dictionary.
 *
 * Based on Unicode's Khmer orthographic syllable structure:
 * Khmer-syllable ::= (K H)* K M*
 * where K = consonant/independent vowel, H = COENG (្), M = combining marks
 *
 * CRITICAL RULE: You can NEVER break after a COENG (្, U+17D2).
 */

import { PROTECTED_PHRASES } from "./protected-phrases"
import { PREFIX_MAP, SUFFIX_MAP, PREFIXES_BY_LENGTH, SUFFIXES_BY_LENGTH, type AffixConfig } from "./khmer-affixes"
import { TITLE_SET, TITLES_BY_LENGTH, isTitle } from "./khmer-titles"

const ZWSP = "\u200B"
const WJ = "\u2060"

const CONNECTOR_CHARS = new Set(["-", "/", ".", ":"])

const CLOSING_PUNCTUATION = new Set([
  "។", "៕", "៖", "!", "?", ")", "]", "}", "»", "\u2019", "›",
  '"', "\u201D", ",", ".", ":", ";", "៚", "'", "\u2026", "-",
])

const OPENING_PUNCTUATION = new Set([
  "(", "[", "{", "«", "\u2018", "‹", '"', "\u201C",
])

class TrieNode {
  children: Map<string, TrieNode>
  isWord: boolean
  frequency: number

  constructor() {
    this.children = new Map()
    this.isWord = false
    this.frequency = 0
  }
}

class KhmerTrie {
  root: TrieNode
  wordCount = 0
  maxWordLength = 0

  // SymSpell-style delete neighborhood index for edit-distance-1 fuzzy matching.
  // Maps each single-character deletion of a dictionary word → the original word+freq.
  // Built lazily via buildFuzzyIndex() after the full dictionary is loaded.
  private deleteIndex: Map<string, Array<{ word: string; frequency: number }>> | null = null

  constructor() {
    this.root = new TrieNode()
  }

  insert(word: string, frequency = 1) {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode())
      }
      node = node.children.get(char)!
    }
    node.isWord = true
    node.frequency = frequency
    this.wordCount++
    if (word.length > this.maxWordLength) {
      this.maxWordLength = word.length
    }
  }

  reorderCoengs(text: string): string {
    const COENG = "\u17D2"
    let result = ""
    let i = 0

    while (i < text.length) {
      const code_i = text[i].codePointAt(0)!
      const isConsonant_i = code_i >= 0x1780 && code_i <= 0x17a2

      if (isConsonant_i) {
        let j = i + 1
        while (j < text.length) {
          const cj = text[j].codePointAt(0)!
          if ((cj >= 0x17b4 && cj <= 0x17c5) || (cj >= 0x17c6 && cj <= 0x17d1)) {
            j++
          } else {
            break
          }
        }
        const vowelSigns = text.substring(i + 1, j)

        if (vowelSigns.length > 0 && j + 1 < text.length && text[j] === COENG) {
          const cAfterCoeng = text[j + 1].codePointAt(0)!
          if (cAfterCoeng >= 0x1780 && cAfterCoeng <= 0x17a2) {
            result += text[i] + COENG + text[j + 1] + vowelSigns
            i = j + 2
            continue
          }
        }
      }

      result += text[i]
      i++
    }

    return result
  }

  collapseDoubledConsonants(text: string): string {
    const COENG = "\u17D2"
    let result = ""
    let i = 0

    while (i < text.length) {
      if (i + 2 < text.length) {
        const char1 = text[i]
        const char2 = text[i + 1]
        const char3 = text[i + 2]

        const code1 = char1.codePointAt(0)!
        const code3 = char3.codePointAt(0)!

        if (code1 >= 0x1780 && code1 <= 0x17a2 &&
            char2 === COENG &&
            code3 >= 0x1780 && code3 <= 0x17a2 &&
            char1 === char3) {
          result += char1
          i += 3
          continue
        }
      }

      result += text[i]
      i++
    }

    return result
  }

  normalizeForLookup(text: string): string {
    return this.collapseDoubledConsonants(this.reorderCoengs(text))
  }

  findVariantInTrie(text: string): { consumedLength: number; frequency: number } | null {
    const COENG = "\u17D2"
    let bestMatch: { consumedLength: number; frequency: number } | null = null

    const explore = (node: TrieNode, pos: number, didSkip: boolean) => {
      if (node.isWord && node.frequency !== 0 && pos > 0) {
        if (didSkip && (!bestMatch || pos > bestMatch.consumedLength)) {
          bestMatch = { consumedLength: pos, frequency: node.frequency }
        }
      }

      if (pos >= text.length) return

      const char = text[pos]
      const code = char.codePointAt(0)!
      const isConsonant = code >= 0x1780 && code <= 0x17a2

      if (isConsonant && pos + 2 < text.length &&
          text[pos + 1] === COENG && text[pos + 2] === char) {
        if (node.children.has(char)) {
          explore(node.children.get(char)!, pos + 3, true)
          explore(node.children.get(char)!, pos + 1, didSkip)
        }
      } else {
        if (node.children.has(char)) {
          explore(node.children.get(char)!, pos + 1, didSkip)
        }
      }
    }

    explore(this.root, 0, false)
    return bestMatch
  }

  findLongestMatch(text: string, startIndex: number): { word: string; frequency: number } | null {
    let node = this.root
    let lastMatch: { word: string; frequency: number } | null = null
    let currentWord = ""

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i]
      if (!node.children.has(char)) break
      node = node.children.get(char)!
      currentWord += char
      if (node.isWord) {
        if (node.frequency !== 0) {
          lastMatch = { word: currentWord, frequency: node.frequency }
        }
      }
    }

    const remainingText = text.substring(startIndex)
    if (remainingText.length >= 5 && remainingText.includes("\u17D2")) {
      const reordered = this.reorderCoengs(remainingText)
      const variantResult = this.findVariantInTrie(reordered)
      if (variantResult) {
        const originalWord = remainingText.substring(0, variantResult.consumedLength)
        if (!lastMatch || originalWord.length > lastMatch.word.length) {
          const adjustedFrequency = Math.floor(variantResult.frequency * 0.75)
          return { word: originalWord, frequency: adjustedFrequency }
        }
      }
    }

    return lastMatch
  }

  findAllMatches(
    text: string,
    startIndex: number,
    maxLength: number,
    charSets?: KhmerCharSets,
  ): Array<{ length: number; frequency: number }> {
    const matches: Array<{ length: number; frequency: number }> = []
    let node = this.root
    let currentLength = 0

    for (let i = startIndex; i < text.length && currentLength < maxLength; i++) {
      const char = text[i]
      if (!node.children.has(char)) break
      node = node.children.get(char)!
      currentLength++
      if (node.isWord) {
        let extendedLength = currentLength
        if (charSets && i + 1 < text.length && charSets.isRepetitionSign(text[i + 1])) {
          extendedLength = currentLength + 1
        }
        matches.push({ length: extendedLength, frequency: node.frequency })
      }
    }
    return matches
  }

  hasWord(word: string): boolean {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) return false
      node = node.children.get(char)!
    }
    return node.isWord && node.frequency !== 0
  }

  getFrequency(word: string): number {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) return 0
      node = node.children.get(char)!
    }
    return node.isWord ? node.frequency : 0
  }

  existsInTrie(word: string): boolean {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) return false
      node = node.children.get(char)!
    }
    return node.isWord
  }

  /**
   * Build the delete-neighborhood index for edit-distance-1 fuzzy matching.
   * For each dictionary word, generates all single-character deletions and
   * maps them to the original word. Call once after the full dictionary is loaded.
   */
  buildFuzzyIndex(): void {
    if (this.deleteIndex) return // already built
    this.deleteIndex = new Map()

    const addToIndex = (key: string, word: string, frequency: number) => {
      const existing = this.deleteIndex!.get(key)
      if (existing) {
        existing.push({ word, frequency })
      } else {
        this.deleteIndex!.set(key, [{ word, frequency }])
      }
    }

    // Walk the trie to collect all words
    const collectWords = (node: TrieNode, prefix: string) => {
      if (node.isWord && node.frequency > 0) {
        const word = prefix
        const chars = [...word] // spread for proper Unicode iteration

        // Only index words of length 3-20 chars (too short = too many collisions)
        if (chars.length >= 3 && chars.length <= 20) {
          // Index the word itself (for distance-0 exact match via the index)
          addToIndex(word, word, node.frequency)

          // Generate all single-character deletions
          for (let i = 0; i < chars.length; i++) {
            const deletion = chars.slice(0, i).join('') + chars.slice(i + 1).join('')
            addToIndex(deletion, word, node.frequency)
          }
        }
      }

      for (const [char, child] of node.children) {
        collectWords(child, prefix + char)
      }
    }

    collectWords(this.root, '')
  }

  /**
   * Find dictionary words within edit distance 1 of the query.
   * Uses the pre-built delete index for O(query_length) lookup.
   * Returns matches sorted by frequency descending.
   */
  fuzzyLookup(query: string): Array<{ word: string; frequency: number; distance: number }> {
    // Always check exact match first (fastest path)
    const exactFreq = this.getFrequency(query)
    if (exactFreq > 0) {
      return [{ word: query, frequency: exactFreq, distance: 0 }]
    }

    if (!this.deleteIndex) return []

    const chars = [...query]
    if (chars.length < 2 || chars.length > 20) return []

    const seen = new Map<string, { frequency: number; distance: number }>()

    // Check the query itself in the delete index.
    // If found, the dictionary word had chars deleted to produce our query,
    // meaning our query is a deletion of that word (we're missing a character).
    const queryHits = this.deleteIndex.get(query)
    if (queryHits) {
      for (const hit of queryHits) {
        if (hit.word !== query && !seen.has(hit.word)) {
          seen.set(hit.word, { frequency: hit.frequency, distance: 1 })
        }
      }
    }

    // Generate all single-character deletions of the query and look them up.
    // If found, either:
    // - The deletion matches a dictionary word exactly (query has an extra char)
    // - The deletion matches a deletion of a different dictionary word (substitution)
    for (let i = 0; i < chars.length; i++) {
      const deletion = chars.slice(0, i).join('') + chars.slice(i + 1).join('')
      const hits = this.deleteIndex.get(deletion)
      if (hits) {
        for (const hit of hits) {
          if (hit.word !== query && !seen.has(hit.word)) {
            // Verify it's truly edit distance 1 (delete index can have false positives at distance 2)
            const d = this.quickEditDistance(query, hit.word)
            if (d <= 1) {
              seen.set(hit.word, { frequency: hit.frequency, distance: d })
            }
          }
        }
      }
    }

    const results = Array.from(seen.entries()).map(([word, info]) => ({
      word,
      frequency: info.frequency,
      distance: info.distance,
    }))

    results.sort((a, b) => b.frequency - a.frequency)
    return results
  }

  /**
   * Quick edit distance calculation (Levenshtein, no transpositions).
   * Optimized: returns early if distance exceeds 1.
   */
  private quickEditDistance(a: string, b: string): number {
    const charsA = [...a]
    const charsB = [...b]
    const lenA = charsA.length
    const lenB = charsB.length

    if (Math.abs(lenA - lenB) > 1) return 2

    // Substitution (same length)
    if (lenA === lenB) {
      let diffs = 0
      for (let i = 0; i < lenA; i++) {
        if (charsA[i] !== charsB[i]) {
          diffs++
          if (diffs > 1) return 2
        }
      }
      return diffs
    }

    // Insertion/deletion (length differs by 1)
    const shorter = lenA < lenB ? charsA : charsB
    const longer = lenA < lenB ? charsB : charsA
    let diffs = 0
    let si = 0
    for (let li = 0; li < longer.length; li++) {
      if (si < shorter.length && shorter[si] === longer[li]) {
        si++
      } else {
        diffs++
        if (diffs > 1) return 2
      }
    }
    return diffs + (shorter.length - si)
  }
}

class KhmerCharSets {
  KHMER_BASE_START = 0x1780
  KHMER_BASE_END = 0x17ff
  COENG = "\u17D2"
  BANTOC = "\u17CB"
  REPETITION_SIGN = "\u17D7"

  consonants: Set<string>
  independentVowels: Set<string>
  dependentVowels: Set<string>
  signs: Set<string>
  combiningMarks: Set<string>
  baseChars: Set<string>

  constructor() {
    this.consonants = new Set()
    for (let i = 0x1780; i <= 0x17a2; i++) {
      this.consonants.add(String.fromCodePoint(i))
    }

    this.independentVowels = new Set()
    for (let i = 0x17a3; i <= 0x17b3; i++) {
      this.independentVowels.add(String.fromCodePoint(i))
    }

    this.dependentVowels = new Set()
    for (let i = 0x17b4; i <= 0x17c5; i++) {
      this.dependentVowels.add(String.fromCodePoint(i))
    }

    this.signs = new Set()
    for (let i = 0x17c6; i <= 0x17d1; i++) {
      this.signs.add(String.fromCodePoint(i))
    }
    this.signs.add(String.fromCodePoint(0x17d3))
    this.signs.add(String.fromCodePoint(0x17dd))

    this.combiningMarks = new Set([...this.dependentVowels, ...this.signs])
    this.baseChars = new Set([...this.consonants, ...this.independentVowels])
  }

  isKhmerChar(char: string): boolean {
    const code = char.codePointAt(0)!
    return code >= this.KHMER_BASE_START && code <= this.KHMER_BASE_END
  }

  isKhmerDigit(char: string): boolean {
    const code = char.codePointAt(0)!
    return code >= 0x17e0 && code <= 0x17e9
  }

  isBase(char: string): boolean {
    return this.baseChars.has(char)
  }

  isCombiningMark(char: string): boolean {
    return this.combiningMarks.has(char)
  }

  isCoeng(char: string): boolean {
    return char === this.COENG
  }

  isBantoc(char: string): boolean {
    return char === this.BANTOC
  }

  isRepetitionSign(char: string): boolean {
    return char === this.REPETITION_SIGN
  }

  isConsonant(char: string): boolean {
    return this.consonants.has(char)
  }

  isDanglingBantoc(token: string): boolean {
    if (token.length !== 2) return false
    return this.isConsonant(token[0]) && this.isBantoc(token[1])
  }

  startsWithDanglingBantoc(token: string): boolean {
    if (token.length < 2) return false
    return this.isConsonant(token[0]) && this.isBantoc(token[1])
  }

  endsWithDanglingVowel(token: string): boolean {
    if (token.length === 0) return false
    const lastChar = token[token.length - 1]
    const danglingVowels = new Set(['\u17BB', '\u17B7', '\u17B8', '\u17BD'])
    return danglingVowels.has(lastChar)
  }

  private static readonly SEMIVOWELS = new Set(['យ', 'វ'])

  isSemivowel(char: string): boolean {
    return KhmerCharSets.SEMIVOWELS.has(char)
  }

  isDependentMark(char: string): boolean {
    return this.dependentVowels.has(char) || this.signs.has(char)
  }

  isPunctuation(char: string): boolean {
    const code = char.codePointAt(0)!
    if (code >= 0x17d4 && code <= 0x17da && code !== 0x17d7) return true
    if ('.,;:!?()[]{}"\'-–—…'.includes(char)) return true
    return false
  }

  findSyllableEnd(text: string, index: number): number {
    if (index >= text.length) return index

    const char = text[index]
    if (!this.isBase(char)) return index + 1

    let pos = index + 1

    while (pos < text.length) {
      const c = text[pos]
      if (this.isCoeng(c)) {
        if (pos + 1 < text.length && this.isBase(text[pos + 1])) {
          pos += 2
          continue
        } else {
          pos++
          continue
        }
      }
      if (this.isCombiningMark(c)) {
        pos++
        continue
      }
      break
    }

    return pos
  }

  canBreakAt(text: string, index: number): boolean {
    if (index <= 0 || index >= text.length) return false

    const before = text[index - 1]
    const after = text[index]

    if (before === WJ || after === WJ) return false
    if (this.isCoeng(before) || this.isCoeng(after)) return false
    if (before === "\u17D0") return false
    if (this.isRepetitionSign(after)) return false
    if (CONNECTOR_CHARS.has(before) && this.isKhmerChar(after)) return false
    if (CONNECTOR_CHARS.has(after) && this.isKhmerChar(before)) return false
    if (this.isCombiningMark(after)) return false
    if (this.isCombiningMark(before) && !this.isBase(after) && !/\s/.test(after) && !this.isPunctuation(after)) {
      return false
    }

    return true
  }

  countSyllables(word: string): number {
    let count = 0
    let pos = 0
    while (pos < word.length) {
      if (this.isKhmerChar(word[pos])) {
        const end = this.findSyllableEnd(word, pos)
        count++
        pos = end
      } else {
        pos++
      }
    }
    return count || 1
  }

  extractClusters(text: string): string[] {
    const clusters: string[] = []
    let pos = 0

    while (pos < text.length) {
      const char = text[pos]
      if (!this.isKhmerChar(char)) {
        clusters.push(char)
        pos++
        continue
      }
      if (this.isBase(char)) {
        const clusterEnd = this.findSyllableEnd(text, pos)
        clusters.push(text.substring(pos, clusterEnd))
        pos = clusterEnd
      } else {
        clusters.push(char)
        pos++
      }
    }

    return clusters
  }
}

function isPunctuation(char: string): boolean {
  return CLOSING_PUNCTUATION.has(char) || OPENING_PUNCTUATION.has(char)
}

export interface DictionaryEntry {
  word: string
  frequency: number
}

export class KhmerBreaker {
  private trie: KhmerTrie
  private charSets: KhmerCharSets
  private useIntlSegmenter: boolean

  private MIN_FREQUENCY_FOR_SINGLE_CHAR = 4000
  private MIN_FREQUENCY_FOR_TWO_CHAR = 1000

  constructor(dictionaryData: DictionaryEntry[] | null = null) {
    this.trie = new KhmerTrie()
    this.charSets = new KhmerCharSets()
    this.useIntlSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl

    if (dictionaryData) {
      this.loadDictionary(dictionaryData)
    }
  }

  private fullDictionaryLoaded = false

  loadDictionary(dictionaryData: DictionaryEntry[]) {
    for (const entry of dictionaryData) {
      if (entry.word && entry.word.length > 0) {
        this.trie.insert(entry.word, entry.frequency || 1)
      }
    }
  }

  async loadFullDictionaryAsync(url = '/dictionaries/km_frequency_dictionary.json'): Promise<void> {
    if (this.fullDictionaryLoaded) return

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch dictionary: ${response.status}`)
      }

      const data: Record<string, number> = await response.json()
      const entries = Object.entries(data)

      let newWords = 0
      for (const [word, frequency] of entries) {
        if (word && word.length > 0) {
          if (!this.trie.existsInTrie(word)) {
            this.trie.insert(word, frequency)
            newWords++
          }
        }
      }

      // Build fuzzy index for edit-distance-1 matching
      this.trie.buildFuzzyIndex()

      this.fullDictionaryLoaded = true
      console.log(`[KhmerBreaker] Full dictionary loaded. Added ${newWords} new words. Total: ${this.trie.wordCount}. Fuzzy index built.`)
    } catch (error) {
      console.error("[KhmerBreaker] Failed to load full dictionary:", error)
    }
  }

  isFullDictionaryLoaded(): boolean {
    return this.fullDictionaryLoaded
  }

  // ============ Affix-Based Compound Detection ============

  checkAffixCompound(word: string): {
    type: 'prefix' | 'suffix'
    affix: AffixConfig
    affixText: string
    remainder: string
    remainderFreq: number
    isBreakPoint: boolean
  } | null {
    for (const prefixText of PREFIXES_BY_LENGTH) {
      if (word.startsWith(prefixText) && word.length > prefixText.length) {
        const remainder = word.slice(prefixText.length)
        const remainderFreq = this.trie.getFrequency(remainder)

        if (remainderFreq > 0) {
          const remainderClusters = this.charSets.extractClusters(remainder).length
          const minRemainderFreq = remainderClusters === 1 ? 5000 : 0

          if (remainderFreq < minRemainderFreq) continue

          const affix = PREFIX_MAP.get(prefixText)!

          return {
            type: 'prefix',
            affix,
            affixText: prefixText,
            remainder,
            remainderFreq,
            isBreakPoint: affix.isBreakPoint,
          }
        }
      }
    }

    for (const suffixText of SUFFIXES_BY_LENGTH) {
      if (word.endsWith(suffixText) && word.length > suffixText.length) {
        const stem = word.slice(0, -suffixText.length)
        let stemFreq = this.trie.getFrequency(stem)

        if (stemFreq === 0 && stem.length >= 3 && stem.includes("\u17D2")) {
          const reordered = this.trie.reorderCoengs(stem)
          const variantResult = this.trie.findVariantInTrie(reordered)
          if (variantResult && variantResult.consumedLength === reordered.length) {
            stemFreq = Math.floor(variantResult.frequency * 0.75)
          }
        }

        if (stemFreq > 0) {
          const stemClusters = this.charSets.extractClusters(stem).length
          const minStemFreq = stemClusters === 1 ? 5000 : 0

          if (stemFreq < minStemFreq) continue

          const affix = SUFFIX_MAP.get(suffixText)!

          return {
            type: 'suffix',
            affix,
            affixText: suffixText,
            remainder: stem,
            remainderFreq: stemFreq,
            isBreakPoint: affix.isBreakPoint,
          }
        }
      }
    }

    return null
  }

  private hasKhmerLetters(text: string): boolean {
    for (const char of text) {
      if (this.charSets.isKhmerChar(char) && !this.charSets.isKhmerDigit(char)) {
        return true
      }
    }
    return false
  }

  private applyProtectedPhrases(text: string): string {
    if (!text || PROTECTED_PHRASES.length === 0) return text

    const phrases = [...PROTECTED_PHRASES].sort((a, b) => b.length - a.length)

    let result = text
    for (const phrase of phrases) {
      if (result.includes(phrase)) {
        const wrappedPhrase = WJ + phrase + WJ
        if (!result.includes(wrappedPhrase)) {
          result = result.split(phrase).join(wrappedPhrase)
        }
      }
    }
    return result
  }

  private mergeKnownCompounds(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    const out: string[] = []
    let i = 0

    while (i < segments.length) {
      const seg = segments[i]

      if (/^\s+$/.test(seg) || this.isPurelyClosingPunctuation(seg) || this.isPurelyOpeningPunctuation(seg)) {
        out.push(seg)
        i++
        continue
      }

      let best = seg
      let bestJ = i

      let combined = seg
      for (let j = i + 1; j < Math.min(i + 5, segments.length); j++) {
        const next = segments[j]
        if (/^\s+$/.test(next) || this.isPurelyClosingPunctuation(next) || this.isPurelyOpeningPunctuation(next)) {
          break
        }
        combined += next
        if (this.trie.hasWord(combined)) {
          best = combined
          bestJ = j
        }
      }

      out.push(best)
      i = bestJ + 1
    }

    return out
  }

  getSegments(text: string): string[] {
    if (!text || text.length === 0) return []

    const cleanedText = text.replace(/([\u1780-\u17FF])([-\/.:\u2013\u2014])\u200B+([\u1780-\u17FF])/g, '$1$2$3')
      .replace(/([\u1780-\u17FF])\u200B+([-\/.:\u2013\u2014])([\u1780-\u17FF])/g, '$1$2$3')

    const userChunks = cleanedText.split(ZWSP)
    const allSegments: string[] = []

    for (const chunk of userChunks) {
      if (!chunk) continue

      const chunkSegments = this.segmentChunk(chunk)
      const connectorMerged = this.mergeConnectors(chunkSegments)
      const punctMerged = this.mergePunctuation(connectorMerged)
      const compoundMerged = this.mergeKnownCompounds(punctMerged)
      const fuzzyMerged = this.mergeFuzzyMisspellings(compoundMerged)
      allSegments.push(...fuzzyMerged)
    }

    return allSegments
  }

  /**
   * Merge consecutive short segments that form a near-dictionary word.
   * Detects "shredded" misspellings where the beam search split an unknown
   * word into valid fragments. Uses fuzzy lookup (edit distance 1) to check
   * if the merged form is close to a real dictionary word.
   *
   * Example: ["org org org", "org", "org org org"] → merged = "org org org org org org org org org org org org org org org org" → fuzzy match
   * to "org org org org org org org org org org org org" (distance 1) → keep as single segment.
   */
  private mergeFuzzyMisspellings(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    const result: string[] = []
    let i = 0

    while (i < segments.length) {
      const seg = segments[i]
      const clusters = this.charSets.extractClusters(seg).length

      // Skip whitespace, punctuation, and long segments (3+ clusters with high frequency)
      if (/^\s+$/.test(seg) || this.isPurelyClosingPunctuation(seg) || this.isPurelyOpeningPunctuation(seg)) {
        result.push(seg)
        i++
        continue
      }

      // Only start merge attempts from short (≤ 2 clusters) or unknown segments
      const segFreq = this.trie.getFrequency(seg)
      if (clusters > 2 && segFreq > 0) {
        result.push(seg)
        i++
        continue
      }

      // Try merging 2, 3, 4 consecutive segments and check fuzzy match
      let bestMerge = ''
      let bestMergeEnd = i
      let bestFuzzyFreq = 0

      for (let j = i + 1; j <= Math.min(i + 4, segments.length); j++) {
        const nextSeg = segments[j - 1]
        // Stop at whitespace/punctuation
        if (/^\s+$/.test(nextSeg) || this.isPurelyClosingPunctuation(nextSeg) || this.isPurelyOpeningPunctuation(nextSeg)) break
        // Stop at high-frequency words (≥ 30000) — those are almost certainly correct breaks
        if (this.trie.getFrequency(nextSeg) >= 30000) break

        let merged = ''
        let mergedClusters = 0
        for (let k = i; k < j; k++) {
          merged += segments[k]
          mergedClusters += this.charSets.extractClusters(segments[k]).length
        }

        // Skip if implausible word length
        if (mergedClusters < 2 || mergedClusters > 6) continue
        // Skip if already a known word (mergeKnownCompounds handles this)
        if (this.trie.hasWord(merged)) continue

        // Check fuzzy match — is the merged form close to a real word?
        const fuzzyResults = this.trie.fuzzyLookup(merged)
        if (fuzzyResults.length > 0 && fuzzyResults[0].distance <= 1) {
          const bestResult = fuzzyResults[0]
          // Only accept if the fuzzy match has reasonable frequency
          if (bestResult.frequency > bestFuzzyFreq && bestResult.frequency >= 100) {
            bestMerge = merged
            bestMergeEnd = j
            bestFuzzyFreq = bestResult.frequency
          }
        }
      }

      if (bestMergeEnd > i + 1) {
        result.push(bestMerge)
        i = bestMergeEnd
      } else {
        result.push(seg)
        i++
      }
    }

    return result
  }

  private mergeConnectors(segments: string[]): string[] {
    if (segments.length <= 2) return segments

    const result: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      if (
        segment.length === 1 &&
        CONNECTOR_CHARS.has(segment) &&
        result.length > 0 &&
        i + 1 < segments.length
      ) {
        const prev = result[result.length - 1]
        const next = segments[i + 1]
        const prevHasKhmer = [...prev].some(c => isKhmerCodePoint(c.codePointAt(0) || 0))
        const nextHasKhmer = [...next].some(c => isKhmerCodePoint(c.codePointAt(0) || 0))

        if (prevHasKhmer && nextHasKhmer) {
          result[result.length - 1] = prev + segment + next
          i++
          continue
        }
      }

      result.push(segment)
    }

    return result
  }

  private mergePunctuation(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    const result: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      if (this.isPurelyOpeningPunctuation(segment)) {
        if (i + 1 < segments.length) {
          segments[i + 1] = segment + segments[i + 1]
          continue
        }
      }

      if (this.isPurelyClosingPunctuation(segment)) {
        if (result.length > 0) {
          result[result.length - 1] += segment
          continue
        }
      }

      result.push(segment)
    }

    return result
  }

  private isPurelyOpeningPunctuation(segment: string): boolean {
    if (!segment || segment.length === 0) return false
    for (const char of segment) {
      if (!OPENING_PUNCTUATION.has(char)) return false
    }
    return true
  }

  private isPurelyClosingPunctuation(segment: string): boolean {
    if (!segment || segment.length === 0) return false
    for (const char of segment) {
      if (!CLOSING_PUNCTUATION.has(char)) return false
    }
    return true
  }

  private segmentChunk(text: string): string[] {
    const parts = text.split(/(\s+)/)
    const segments: string[] = []

    for (const part of parts) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        segments.push(part)
        continue
      }

      const scriptRuns = splitByScript(part)

      for (const run of scriptRuns) {
        if (!run.isKhmer) {
          segments.push(run.text)
          continue
        }

        const hasKhmer = [...run.text].some((c) => this.charSets.isKhmerChar(c))
        if (!hasKhmer) {
          segments.push(run.text)
          continue
        }

        const { leading, core, trailing } = this.extractPunctuation(run.text)

        if (!core) {
          if (leading) segments.push(leading)
          if (trailing) segments.push(trailing)
          continue
        }

        const protectedCore = this.applyProtectedPhrases(core)
        const joinedRegions = this.splitByWJ(protectedCore)
        const coreSegments: string[] = []

        for (const region of joinedRegions) {
          if (region.isJoined) {
            coreSegments.push(region.text)
          } else {
            const beamSegments = this.beamSegment(region.text)

            let finalSegments = beamSegments
            if (this.useIntlSegmenter) {
              try {
                const intlSegments = this.segmentWithIntl(region.text)
                finalSegments = this.improveWithIntlHints(beamSegments, intlSegments, region.text)
              } catch {
                // Fall through to beam search result
              }
            }
            coreSegments.push(...finalSegments)
          }
        }

        if (coreSegments.length > 0) {
          if (leading) {
            coreSegments[0] = leading + coreSegments[0]
          }
          if (trailing) {
            coreSegments[coreSegments.length - 1] += trailing
          }
          segments.push(...coreSegments)
        } else {
          if (leading) segments.push(leading)
          if (trailing) segments.push(trailing)
        }
      }
    }

    return segments
  }

  private splitByWJ(text: string): Array<{ text: string; isJoined: boolean }> {
    if (!text.includes(WJ)) {
      return [{ text, isJoined: false }]
    }

    const regions: Array<{ text: string; isJoined: boolean }> = []
    let pos = 0

    while (pos < text.length) {
      const wjStart = text.indexOf(WJ, pos)

      if (wjStart === -1) {
        if (pos < text.length) {
          const remaining = text.substring(pos)
          if (remaining) regions.push({ text: remaining, isJoined: false })
        }
        break
      }

      if (wjStart > pos) {
        regions.push({ text: text.substring(pos, wjStart), isJoined: false })
      }

      const wjEnd = text.indexOf(WJ, wjStart + 1)

      if (wjEnd === -1) {
        regions.push({ text: text.substring(wjStart), isJoined: true })
        break
      }

      regions.push({ text: text.substring(wjStart, wjEnd + 1), isJoined: true })
      pos = wjEnd + 1
    }

    return regions
  }

  private segmentWithIntl(text: string): string[] {
    const segmenter = new Intl.Segmenter("km", { granularity: "word" })
    const segments: string[] = []

    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (isWordLike || segment.trim()) {
        segments.push(segment)
      }
    }

    return segments
  }

  private improveWithIntlHints(beamSegments: string[], intlSegments: string[], _originalText: string): string[] {
    const knownWordCount = beamSegments.filter((s) => this.trie.hasWord(s)).length
    const knownWordRatio = knownWordCount / beamSegments.length

    if (knownWordRatio >= 0.5) return beamSegments

    const khmerDigitColonPattern = /^[\u17E0-\u17E9]+:[\u17E0-\u17E9]*$/
    if (beamSegments.length === 1 && khmerDigitColonPattern.test(beamSegments[0])) return beamSegments
    if (beamSegments.some(seg => khmerDigitColonPattern.test(seg))) return beamSegments

    return this.validateAndMergeSegments(intlSegments)
  }

  private validateAndMergeSegments(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    const merged: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const hasDanglingBantoc = this.charSets.isDanglingBantoc(seg) || this.charSets.startsWithDanglingBantoc(seg)
      if (hasDanglingBantoc && !this.trie.hasWord(seg) && merged.length > 0) {
        merged[merged.length - 1] += seg
      } else {
        merged.push(seg)
      }
    }

    const result: string[] = []
    let i = 0

    while (i < merged.length) {
      let bestMatch = merged[i]
      let bestMatchLen = 1
      let combined = merged[i]

      for (let j = i + 1; j < Math.min(i + 5, merged.length); j++) {
        combined += merged[j]
        if (this.trie.hasWord(combined)) {
          bestMatch = combined
          bestMatchLen = j - i + 1
        }
      }

      result.push(bestMatch)
      i += bestMatchLen
    }

    return result
  }

  // ============ Beam Search ============
  private static readonly BEAM_WIDTH = 8
  private static readonly MAX_WORD_LEN = 20
  private static readonly OOV_PENALTY = 6.0
  private static readonly OOV_SINGLE_CLUSTER_PENALTY = 12.0
  private static readonly DANGLING_BANTOC_PENALTY = 20.0
  private static readonly DANGLING_VOWEL_PENALTY = 15.0
  private static readonly SEMIVOWEL_BOUNDARY_PENALTY = 3.0
  private static readonly BOUNDARY_PENALTY = 2.0
  private static readonly LENGTH_BONUS = 0.25
  private static readonly COMPOUND_BONUS = 0

  private isSafeBoundary(text: string, endIndex: number): boolean {
    if (endIndex <= 0 || endIndex >= text.length) return true
    return this.charSets.canBreakAt(text, endIndex)
  }

  private extendPastCombiningMarks(text: string, pos: number): number {
    const endPos = text.length
    if (pos >= endPos) return pos
    if (this.isSafeBoundary(text, pos)) return pos

    let extended = pos
    while (extended < endPos) {
      const ch = text[extended]
      if (this.charSets.isCombiningMark(ch) || this.charSets.isCoeng(ch) || this.charSets.isRepetitionSign(ch)) {
        extended++
        if (this.charSets.isCoeng(ch) && extended < endPos && this.charSets.isBase(text[extended])) {
          extended++
        }
      } else {
        break
      }
    }

    if (extended > pos && this.isSafeBoundary(text, extended)) return extended
    return -1
  }

  private static readonly MAX_OOV_CLUSTERS = 8

  private findOovChunkEnd(text: string, start: number): number {
    const endPos = text.length
    let pos = start

    pos = this.charSets.findSyllableEnd(text, pos)
    if (pos <= start) pos = start + 1

    while (pos < endPos && !this.isSafeBoundary(text, pos)) pos++

    let clusters = 1

    while (pos < endPos) {
      const ch = text[pos]
      if (/\s/.test(ch)) break
      if (this.charSets.isPunctuation(ch)) break

      if (this.charSets.canBreakAt(text, pos)) {
        const maxLen = Math.min(KhmerBreaker.MAX_WORD_LEN, endPos - start)
        const crossBoundaryMatches = this.trie.findAllMatches(text, start, maxLen)
        const hasCrossingWord = crossBoundaryMatches.some(m => {
          const wordEnd = start + m.length
          return wordEnd > pos && this.isSafeBoundary(text, wordEnd)
        })

        if (!hasCrossingWord) {
          const match = this.trie.findLongestMatch(text, pos)
          if (match && this.isSignificantWord(match)) {
            const matchEnd = pos + match.word.length
            if (matchEnd >= endPos || this.charSets.canBreakAt(text, matchEnd)) break
          }
        }
      }

      const nextPos = this.charSets.findSyllableEnd(text, pos)
      if (nextPos > pos) {
        pos = nextPos
      } else {
        pos++
      }

      while (pos < endPos && !this.isSafeBoundary(text, pos)) pos++

      clusters++
      if (clusters >= KhmerBreaker.MAX_OOV_CLUSTERS) break
    }

    return pos
  }

  private beamSegment(text: string): string[] {
    if (!text || text.length === 0) return []

    const endPos = text.length

    type BeamState = { pos: number; score: number; pieces: string[] }
    let states: BeamState[] = [{ pos: 0, score: 0, pieces: [] }]

    while (states.length > 0) {
      if (states.every(s => s.pos >= endPos)) break

      const nextStates: BeamState[] = []

      for (const s of states) {
        if (s.pos >= endPos) {
          nextStates.push(s)
          continue
        }

        const ch = text[s.pos]

        if (ch === ' ' || ch === '\t' || ch === '\n') {
          nextStates.push({
            pos: s.pos + 1,
            score: s.score,
            pieces: [...s.pieces, ch],
          })
          continue
        }

        if (this.charSets.isKhmerDigit(ch)) {
          let runEnd = s.pos + 1
          while (runEnd < endPos) {
            const nextCh = text[runEnd]
            if (this.charSets.isKhmerDigit(nextCh)) {
              runEnd++
            } else if (CONNECTOR_CHARS.has(nextCh)) {
              if (runEnd + 1 < endPos && this.charSets.isKhmerDigit(text[runEnd + 1])) {
                runEnd++
              } else if (runEnd + 1 >= endPos) {
                runEnd++
                break
              } else {
                break
              }
            } else {
              break
            }
          }
          nextStates.push({
            pos: runEnd,
            score: s.score,
            pieces: [...s.pieces, text.slice(s.pos, runEnd)],
          })
          continue
        }

        if (this.charSets.isPunctuation(ch)) {
          nextStates.push({
            pos: s.pos + 1,
            score: s.score,
            pieces: [...s.pieces, ch],
          })
          continue
        }

        if (!this.charSets.isKhmerChar(ch)) {
          let runEnd = s.pos + 1
          while (runEnd < endPos && !this.charSets.isKhmerChar(text[runEnd]) &&
                 text[runEnd] !== ' ' && !this.charSets.isPunctuation(text[runEnd])) {
            runEnd++
          }
          nextStates.push({
            pos: runEnd,
            score: s.score,
            pieces: [...s.pieces, text.slice(s.pos, runEnd)],
          })
          continue
        }

        const maxLen = Math.min(KhmerBreaker.MAX_WORD_LEN, endPos - s.pos)
        const matches = this.trie.findAllMatches(text, s.pos, maxLen, this.charSets)

        const remainingForVariant = text.substring(s.pos)
        if (remainingForVariant.length >= 5 && remainingForVariant.includes("\u17D2")) {
          const reordered = this.trie.reorderCoengs(remainingForVariant)
          const variantResult = this.trie.findVariantInTrie(reordered)
          if (variantResult) {
            const longestDirect = matches.length > 0 ? Math.max(...matches.map(m => m.length)) : 0
            if (variantResult.consumedLength > longestDirect) {
              const adjustedFreq = Math.floor(variantResult.frequency * 0.75)
              matches.push({ length: variantResult.consumedLength, frequency: adjustedFreq })
            }
          }
        }

        const candidates: Array<{ len: number; score: number; segments?: string[] }> = []

        for (const m of matches) {
          let end = s.pos + m.length

          if (m.frequency === 0) continue

          if (!this.isSafeBoundary(text, end)) {
            const extended = this.extendPastCombiningMarks(text, end)
            if (extended < 0) continue
            end = extended
          }

          const word = text.slice(s.pos, end)
          const len = end - s.pos

          let freq = m.frequency
          if (len > m.length) {
            const extendedFreq = this.trie.getFrequency(word)
            freq = extendedFreq > 0 ? extendedFreq : Math.min(freq, 10)
          }

          const penalty = this.shortWordPenalty(word, freq)
          if (!Number.isFinite(penalty)) continue

          let sc = Math.log((freq || 1) + 1)
          sc += KhmerBreaker.LENGTH_BONUS * len
          sc -= KhmerBreaker.BOUNDARY_PENALTY
          sc -= penalty
          candidates.push({ len, score: sc })
        }

        let compound: ReturnType<typeof this.checkAffixCompound> = null
        let compoundLen = 0

        for (let tryLen = maxLen; tryLen >= 4; tryLen--) {
          let tryEnd = s.pos + tryLen
          let wasExtended = false

          if (!this.isSafeBoundary(text, tryEnd)) {
            const extended = this.extendPastCombiningMarks(text, tryEnd)
            if (extended < 0) continue
            tryEnd = extended
            wasExtended = true
          }

          const tryWord = wasExtended
            ? text.slice(s.pos, s.pos + tryLen)
            : text.slice(s.pos, tryEnd)
          const tryCompound = this.checkAffixCompound(tryWord)
          if (tryCompound) {
            if (!tryCompound.isBreakPoint && tryCompound.type === 'suffix') {
              const suffixStartInText = s.pos + tryWord.length - tryCompound.affixText.length
              const longestAtSuffix = this.trie.findLongestMatch(text, suffixStartInText)
              if (longestAtSuffix && suffixStartInText + longestAtSuffix.word.length > tryEnd) {
                continue
              }
            }

            if (wasExtended && tryCompound.isBreakPoint) {
              if (tryCompound.type === 'prefix') {
                tryCompound.remainder = text.slice(s.pos + tryCompound.affixText.length, tryEnd)
              } else {
                const affixStart = s.pos + tryLen - tryCompound.affixText.length
                tryCompound.affixText = text.slice(affixStart, tryEnd)
              }
            }
            compound = tryCompound
            compoundLen = tryEnd - s.pos
            break
          }
        }

        let oovEnd = this.findOovChunkEnd(text, s.pos)

        if (oovEnd < endPos && this.charSets.isRepetitionSign(text[oovEnd])) {
          oovEnd++
        }

        if (!compound) {
          const oovText = text.slice(s.pos, oovEnd)
          const oovClusterCount = this.charSets.extractClusters(oovText).length

          const hasStrongDictMatch = matches.some(m => m.frequency >= 1000 && m.length >= 3)
          if (oovClusterCount >= 2 && !hasStrongDictMatch) {
            for (const suffixText of SUFFIXES_BY_LENGTH) {
              const affix = SUFFIX_MAP.get(suffixText)!
              if (affix.isBreakPoint) continue

              const suffixEnd = oovEnd + suffixText.length
              if (suffixEnd > endPos) continue

              if (text.substring(oovEnd, suffixEnd) === suffixText) {
                let extendedEnd = suffixEnd
                if (extendedEnd < endPos && !this.isSafeBoundary(text, extendedEnd)) {
                  const extended = this.extendPastCombiningMarks(text, extendedEnd)
                  if (extended < 0) continue
                  extendedEnd = extended
                }

                const suffixFreq = this.trie.getFrequency(suffixText)
                if (suffixFreq > 0) {
                  compound = {
                    type: 'suffix',
                    affix,
                    affixText: suffixText,
                    remainder: oovText,
                    remainderFreq: Math.floor(suffixFreq * 0.5),
                    isBreakPoint: false,
                  }
                  compoundLen = extendedEnd - s.pos
                  break
                }
              }
            }
          }
        }

        if (compound && s.pos + compoundLen < endPos && this.charSets.isRepetitionSign(text[s.pos + compoundLen])) {
          compoundLen++
        }

        const oovLen = compound ? compoundLen : (oovEnd - s.pos)
        const oovChunk = text.slice(s.pos, s.pos + oovLen)

        if (compound) {
          if (compound.isBreakPoint) {
            if (compound.type === 'prefix') {
              const prefixLen = compound.affixText.length
              const remainderLen = compound.remainder.length

              const prefixDictFreq = this.trie.getFrequency(compound.affixText)
              const prefixFreq = prefixDictFreq > 0 ? prefixDictFreq : 10000
              const prefixContrib = Math.log(prefixFreq + 1) + KhmerBreaker.LENGTH_BONUS * prefixLen

              const remainderContrib = Math.log(compound.remainderFreq + 1) + KhmerBreaker.LENGTH_BONUS * remainderLen

              const compoundScore = prefixContrib + remainderContrib - KhmerBreaker.BOUNDARY_PENALTY

              candidates.push({
                len: oovLen,
                score: compoundScore,
                segments: [compound.affixText, compound.remainder],
              })
            } else {
              const stemLen = compound.remainder.length
              const suffixLen = compound.affixText.length

              const stemContrib = Math.log(compound.remainderFreq + 1) + KhmerBreaker.LENGTH_BONUS * stemLen
              const suffixDictFreq = this.trie.getFrequency(compound.affixText)
              const suffixFreq = suffixDictFreq > 0 ? suffixDictFreq : 10000
              const suffixContrib = Math.log(suffixFreq + 1) + KhmerBreaker.LENGTH_BONUS * suffixLen
              const compoundScore = stemContrib + suffixContrib - KhmerBreaker.BOUNDARY_PENALTY

              candidates.push({
                len: oovLen,
                score: compoundScore,
                segments: [compound.remainder, compound.affixText],
              })
            }
          } else {
            let effectiveFreq = compound.remainderFreq
            if (compound.type === 'suffix') {
              const suffixDictFreq = this.trie.getFrequency(compound.affixText)
              effectiveFreq = Math.max(effectiveFreq, suffixDictFreq)
            }
            const compoundScore = Math.log(effectiveFreq + 1) +
              KhmerBreaker.LENGTH_BONUS * oovLen +
              KhmerBreaker.COMPOUND_BONUS -
              KhmerBreaker.BOUNDARY_PENALTY

            candidates.push({ len: oovLen, score: compoundScore })
          }
        }

        const oovClusters = this.charSets.extractClusters(oovChunk).length
        const oovPenalty = oovClusters <= 1
          ? KhmerBreaker.OOV_SINGLE_CLUSTER_PENALTY
          : KhmerBreaker.OOV_PENALTY

        const oovLengthBonus = KhmerBreaker.LENGTH_BONUS * oovLen * 0.5

        candidates.push({
          len: oovLen,
          score: -oovPenalty - KhmerBreaker.BOUNDARY_PENALTY + oovLengthBonus,
        })

        for (const c of candidates) {
          const pieceEnd = s.pos + c.len
          let score = c.score
          const pieces = c.segments ?? [text.slice(s.pos, pieceEnd)]

          if (pieces.length === 1) {
            const piece = pieces[0]

            if (this.charSets.isDanglingBantoc(piece) || this.charSets.startsWithDanglingBantoc(piece)) {
              if (!this.trie.hasWord(piece)) {
                score -= KhmerBreaker.DANGLING_BANTOC_PENALTY
              }
            }

            if (this.charSets.endsWithDanglingVowel(piece)) {
              if (!this.trie.hasWord(piece)) {
                score -= KhmerBreaker.DANGLING_VOWEL_PENALTY
              }
            }

            if (pieceEnd < text.length && piece.length > 0) {
              const lastChar = piece[piece.length - 1]
              const nextChar = text[pieceEnd]
              if (this.charSets.isDependentMark(lastChar) && this.charSets.isSemivowel(nextChar)) {
                const nextNextChar = pieceEnd + 1 < text.length ? text[pieceEnd + 1] : ''
                if (nextNextChar && this.charSets.isBase(nextNextChar)) {
                  score -= KhmerBreaker.SEMIVOWEL_BOUNDARY_PENALTY
                }
              }
            }
          }

          nextStates.push({
            pos: pieceEnd,
            score: s.score + score,
            pieces: [...s.pieces, ...pieces],
          })
        }
      }

      nextStates.sort((a, b) => (b.score - a.score) || (b.pos - a.pos))
      states = nextStates.slice(0, KhmerBreaker.BEAM_WIDTH)
    }

    states.sort((a, b) => {
      if (a.pos !== b.pos) return b.pos - a.pos
      const avgA = a.pieces.length > 0 ? a.score / a.pieces.length : a.score
      const avgB = b.pieces.length > 0 ? b.score / b.pieces.length : b.score
      return avgB - avgA
    })
    const result = states[0]?.pieces ?? [text]

    const merged: string[] = []
    for (let i = 0; i < result.length; i++) {
      const piece = result[i]
      if (
        merged.length > 0 &&
        !this.trie.hasWord(piece) &&
        this.charSets.extractClusters(piece).length <= 1
      ) {
        merged[merged.length - 1] += piece
      } else {
        merged.push(piece)
      }
    }

    return merged
  }

  insertBreakOpportunities(text: string): string {
    const segments = this.getSegments(text)

    let result = ""
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const isWhitespace = /^\s+$/.test(segment)
      const prevIsWhitespace = i > 0 && /^\s+$/.test(segments[i - 1])

      if (i > 0 && !isWhitespace && !prevIsWhitespace) {
        result += ZWSP
      }
      result += segment
    }

    return result
  }

  getTextWithBreaks(text: string): string {
    return this.insertBreakOpportunities(text)
  }

  /**
   * Get segments annotated with dictionary info for spell checking.
   *
   * After normal segmentation, detects runs of consecutive short, non-dictionary
   * fragments that likely represent a single misspelled word shredded by the
   * beam search. These runs are merged back into a single "suspect" segment.
   *
   * Returns array of { text, isKnown, from } where:
   * - text: the segment text (ZWSP-free)
   * - isKnown: true if the word is in the dictionary
   * - from: character offset in the original text
   */
  getSegmentsForSpellCheck(text: string): Array<{ text: string; isKnown: boolean; from: number }> {
    const segments = this.getSegments(text)
    const result: Array<{ text: string; isKnown: boolean; from: number }> = []

    let offset = 0
    // Build raw segment list with positions and dictionary status.
    // Track both the cleaned text (for dictionary lookup) and the original
    // position/length in the source text (for decorations).
    const raw: Array<{
      text: string       // cleaned segment (no ZWSP/punct)
      isKnown: boolean
      from: number       // position in original text
      origLen: number    // length in original text (may include ZWSP/punct)
      clusters: number
    }> = []

    for (const seg of segments) {
      const idx = text.indexOf(seg, offset)
      const from = idx >= 0 ? idx : offset

      const isWhitespace = /^\s+$/.test(seg)
      const isPunct = seg.length === 1 && (seg.codePointAt(0)! >= 0x17d4 && seg.codePointAt(0)! <= 0x17da)

      if (!isWhitespace && !isPunct) {
        const clean = seg.replace(/[\u200B]/g, '')
          .replace(/^[\u17D4-\u17DA.,!?;:]+/, '')
          .replace(/[\u17D4-\u17DA.,!?;:]+$/, '')
        if (!clean) { offset = from + seg.length; continue }

        // Skip Khmer digit-only segments
        if (/^[\u17E0-\u17E9]+$/.test(clean)) { offset = from + seg.length; continue }

        const isKnown = this.trie.hasWord(clean)
        const clusters = this.charSets.extractClusters(clean).length
        raw.push({ text: clean, isKnown, from, origLen: seg.length, clusters })
      }

      offset = from + seg.length
    }

    // Detect "shredded" misspellings by trying to merge consecutive short
    // segments (≤ 2 clusters each). At each position, try merging 2, 3, or 4
    // segments ahead. Accept the longest merge whose combined form is:
    //   - NOT in the dictionary (it's an unknown word = suspect misspelling)
    //   - 2-6 clusters total (plausible Khmer word length)
    //
    // This catches cases like org org(1cl) + org(1cl) + org org org(1cl) = "org org org org org org org org org org org org org org org org" which is a
    // misspelling of org org org org org org org org org org org org. Even though org org org has high frequency, the merged
    // form isn't a real word.
    //
    // We skip merging when the combined form IS a dictionary word.
    let i = 0
    while (i < raw.length) {
      const seg = raw[i]

      // Only try merging from short segments (≤ 2 clusters)
      if (seg.clusters > 2) {
        result.push({ text: seg.text, isKnown: seg.isKnown, from: seg.from })
        i++
        continue
      }

      // Try merging 2, 3, 4 segments — take the longest unknown merge.
      // Stop merging when we hit a segment that is:
      //   - Long (3+ clusters), OR
      //   - High frequency (≥ 30000) — common words like ជorg org, org org org org org org, org org org org org org org
      const HIGH_FREQ_THRESHOLD = 30000

      let bestMerge = ''
      let bestMergeEnd = i
      let bestMergeClusters = 0

      for (let j = i + 1; j <= Math.min(i + 4, raw.length); j++) {
        const nextSeg = raw[j - 1]
        // Stop if the next segment to include is long (3+ clusters) or high-frequency
        if (nextSeg.clusters > 2 || this.trie.getFrequency(nextSeg.text) >= HIGH_FREQ_THRESHOLD) break

        let merged = ''
        let mergedClusters = 0
        for (let k = i; k < j; k++) {
          merged += raw[k].text
          mergedClusters += raw[k].clusters
        }

        if (mergedClusters < 2 || mergedClusters > 6) continue
        if (this.trie.hasWord(merged)) continue

        bestMerge = merged
        bestMergeEnd = j
        bestMergeClusters = mergedClusters
      }

      if (bestMergeEnd > i + 1) {
        // Calculate the span in the original text: from first segment's start
        // to last merged segment's end
        const lastMerged = raw[bestMergeEnd - 1]
        const mergedOrigLen = (lastMerged.from + lastMerged.origLen) - raw[i].from
        result.push({ text: bestMerge, isKnown: false, from: raw[i].from })
        i = bestMergeEnd
      } else {
        result.push({ text: seg.text, isKnown: seg.isKnown, from: seg.from })
        i++
      }
    }

    return result
  }

  private extractPunctuation(text: string): { leading: string; core: string; trailing: string } {
    let leading = ""
    let trailing = ""
    let start = 0
    let end = text.length

    while (start < text.length && (OPENING_PUNCTUATION.has(text[start]) || CLOSING_PUNCTUATION.has(text[start]))) {
      leading += text[start]
      start++
    }

    while (end > start && (CLOSING_PUNCTUATION.has(text[end - 1]) || OPENING_PUNCTUATION.has(text[end - 1]))) {
      trailing = text[end - 1] + trailing
      end--
    }

    const core = text.substring(start, end)
    return { leading, core, trailing }
  }

  private isSignificantWord(match: { word: string; frequency: number }): boolean {
    const clusterCount = this.charSets.extractClusters(match.word).length

    if (clusterCount >= 3) return true
    if (clusterCount <= 1) return match.frequency >= this.MIN_FREQUENCY_FOR_SINGLE_CHAR
    return match.frequency >= this.MIN_FREQUENCY_FOR_TWO_CHAR
  }

  private static readonly LOW_FREQ_PENALTY_MULTIPLIER = 4.0
  private static readonly LOW_FREQ_SINGLE_CLUSTER_MULTIPLIER = 8.0

  private shortWordPenalty(word: string, freq: number): number {
    const clusters = this.charSets.extractClusters(word).length

    if (clusters >= 3) return 0

    if (clusters <= 1) {
      if (freq >= this.MIN_FREQUENCY_FOR_SINGLE_CHAR) return 0
      const ratio = (this.MIN_FREQUENCY_FOR_SINGLE_CHAR - freq) / this.MIN_FREQUENCY_FOR_SINGLE_CHAR
      return KhmerBreaker.LOW_FREQ_SINGLE_CLUSTER_MULTIPLIER * ratio
    }

    const threshold = this.MIN_FREQUENCY_FOR_TWO_CHAR
    if (freq >= threshold) return 0

    const ratio = (threshold - freq) / threshold
    return KhmerBreaker.LOW_FREQ_PENALTY_MULTIPLIER * ratio
  }
}

export default KhmerBreaker

const KHMER_RANGE_START = 0x1780
const KHMER_RANGE_END = 0x17ff
const KHMER_DIGIT_START = 0x17e0
const KHMER_DIGIT_END = 0x17e9

function isKhmerCodePoint(codePoint: number): boolean {
  return codePoint >= KHMER_RANGE_START && codePoint <= KHMER_RANGE_END
}

function isKhmerDigit(codePoint: number): boolean {
  return codePoint >= KHMER_DIGIT_START && codePoint <= KHMER_DIGIT_END
}

function splitByScript(text: string): Array<{ text: string; isKhmer: boolean }> {
  if (!text) return []

  const runs: Array<{ text: string; isKhmer: boolean }> = []
  let currentRun = ""
  let currentIsKhmer: boolean | null = null
  let currentIsKhmerDigit: boolean | null = null

  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    const cp = char.codePointAt(0) || 0
    const charIsKhmer = isKhmerCodePoint(cp)
    const charIsKhmerDigit = isKhmerDigit(cp)

    const ZWSP_CHAR = '\u200B'
    let isConnectorBetweenKhmer = false
    let skipZwspAfterConnector = false
    if (CONNECTOR_CHARS.has(char) && currentIsKhmer === true && currentRun.length > 0) {
      const nextChar = i + 1 < chars.length ? chars[i + 1] : null
      const nextNextChar = i + 2 < chars.length ? chars[i + 2] : null
      if (nextChar && isKhmerCodePoint(nextChar.codePointAt(0) || 0)) {
        isConnectorBetweenKhmer = true
      } else if (nextChar === ZWSP_CHAR && nextNextChar && isKhmerCodePoint(nextNextChar.codePointAt(0) || 0)) {
        isConnectorBetweenKhmer = true
        skipZwspAfterConnector = true
      }
    }

    const isZwspAfterConnector = char === ZWSP_CHAR &&
      currentRun.length > 0 &&
      CONNECTOR_CHARS.has(currentRun[currentRun.length - 1]) &&
      currentIsKhmer === true &&
      i + 1 < chars.length &&
      isKhmerCodePoint((chars[i + 1].codePointAt(0) || 0))

    const isBreakPoint = !isConnectorBetweenKhmer && !isZwspAfterConnector && (
      char === " " || /\s/.test(char) || OPENING_PUNCTUATION.has(char) || CLOSING_PUNCTUATION.has(char)
    )

    if (isConnectorBetweenKhmer) {
      currentRun += char
      if (skipZwspAfterConnector) {
        currentRun += chars[i + 1]
        i++
      }
      currentIsKhmerDigit = null
    } else if (isZwspAfterConnector) {
      currentRun += char
    } else if (isBreakPoint) {
      if (currentRun) {
        runs.push({ text: currentRun, isKhmer: currentIsKhmer ?? false })
        currentRun = ""
        currentIsKhmer = null
        currentIsKhmerDigit = null
      }
      runs.push({ text: char, isKhmer: true })
    } else if (currentIsKhmer === null) {
      currentRun = char
      currentIsKhmer = charIsKhmer
      currentIsKhmerDigit = charIsKhmerDigit
    } else if (charIsKhmer !== currentIsKhmer) {
      if (currentRun) {
        runs.push({ text: currentRun, isKhmer: currentIsKhmer })
      }
      currentRun = char
      currentIsKhmer = charIsKhmer
      currentIsKhmerDigit = charIsKhmerDigit
    } else if (charIsKhmer && currentIsKhmer) {
      if (currentIsKhmerDigit === false && charIsKhmerDigit) {
        if (currentRun) {
          runs.push({ text: currentRun, isKhmer: true })
        }
        currentRun = char
        currentIsKhmerDigit = true
      } else {
        currentRun += char
        if (!charIsKhmerDigit) {
          currentIsKhmerDigit = false
        }
      }
    } else {
      currentRun += char
    }
  }

  if (currentRun) {
    runs.push({ text: currentRun, isKhmer: currentIsKhmer ?? false })
  }

  return runs
}
