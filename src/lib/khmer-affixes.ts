/**
 * Khmer Affix Configuration
 *
 * Defines productive prefixes and suffixes that can form valid compound words
 * even if the compound itself is not in the dictionary.
 */

export interface AffixConfig {
  text: string
  type: 'prefix' | 'suffix'
  isBreakPoint: boolean
}

export const KHMER_PREFIXES: AffixConfig[] = [
  { text: 'អ្នក', type: 'prefix', isBreakPoint: true },
  { text: 'យ៉ាង', type: 'prefix', isBreakPoint: true },
  { text: 'ជន', type: 'prefix', isBreakPoint: true },
  { text: 'ការ', type: 'prefix', isBreakPoint: true },
  { text: 'សេចក្តី', type: 'prefix', isBreakPoint: true },
  { text: 'លោក', type: 'prefix', isBreakPoint: true },
  { text: 'លោកស្រី', type: 'prefix', isBreakPoint: true },
  { text: 'កញ្ញា', type: 'prefix', isBreakPoint: true },
  { text: 'ឯកឧត្តម', type: 'prefix', isBreakPoint: true },
  { text: 'លោកជំទាវ', type: 'prefix', isBreakPoint: true },
  { text: 'ព្រះ', type: 'prefix', isBreakPoint: true },
  { text: 'ក្រុម', type: 'prefix', isBreakPoint: true },
  { text: 'ពួក', type: 'prefix', isBreakPoint: true },
  { text: 'គណៈ', type: 'prefix', isBreakPoint: true },
  { text: 'ប្រធាន', type: 'prefix', isBreakPoint: true },
  { text: 'អ', type: 'prefix', isBreakPoint: false },
  { text: 'អនុ', type: 'prefix', isBreakPoint: false },
  { text: 'មហា', type: 'prefix', isBreakPoint: false },
  { text: 'សហ', type: 'prefix', isBreakPoint: false },
]

export const KHMER_SUFFIXES: AffixConfig[] = [
  { text: 'កម្ម', type: 'suffix', isBreakPoint: false },
  { text: 'នីយកម្ម', type: 'suffix', isBreakPoint: false },
  { text: 'ភាព', type: 'suffix', isBreakPoint: true },
  { text: 'ធម៌', type: 'suffix', isBreakPoint: false },
  { text: 'និយម', type: 'suffix', isBreakPoint: false },
  { text: 'វិទ្យា', type: 'suffix', isBreakPoint: false },
  { text: 'សាស្ត្រ', type: 'suffix', isBreakPoint: false },
  { text: 'វិស័យ', type: 'suffix', isBreakPoint: false },
  { text: 'ករ', type: 'suffix', isBreakPoint: false },
  { text: 'ការី', type: 'suffix', isBreakPoint: false },
  { text: 'ជន', type: 'suffix', isBreakPoint: false },
  { text: 'ភក្តី', type: 'suffix', isBreakPoint: false },
  { text: 'ដ្ឋាន', type: 'suffix', isBreakPoint: false },
  { text: 'មន្ទីរ', type: 'suffix', isBreakPoint: false },
  { text: 'ាល័យ', type: 'suffix', isBreakPoint: false },
  { text: 'ភិបាល', type: 'suffix', isBreakPoint: false },
  { text: 'ធិបតី', type: 'suffix', isBreakPoint: false },
  { text: 'ធិការ', type: 'suffix', isBreakPoint: false },
  { text: 'ការណ៍', type: 'suffix', isBreakPoint: false },
]

export const ALL_AFFIXES: AffixConfig[] = [...KHMER_PREFIXES, ...KHMER_SUFFIXES]

export const PREFIX_MAP = new Map<string, AffixConfig>(
  KHMER_PREFIXES.map(p => [p.text, p])
)
export const SUFFIX_MAP = new Map<string, AffixConfig>(
  KHMER_SUFFIXES.map(s => [s.text, s])
)

export const PREFIXES_BY_LENGTH = [...KHMER_PREFIXES]
  .sort((a, b) => b.text.length - a.text.length)
  .map(p => p.text)

export const SUFFIXES_BY_LENGTH = [...KHMER_SUFFIXES]
  .sort((a, b) => b.text.length - a.text.length)
  .map(s => s.text)
