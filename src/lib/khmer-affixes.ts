/**
 * Khmer Affix Configuration
 *
 * Defines productive prefixes and suffixes that can form valid compound words
 * even if the compound itself is not in the dictionary.
 *
 * Example: អ្នកចម្រៀង (singer) = អ្នក (doer prefix) + ចម្រៀង (to sing)
 * Even if "អ្នកចម្រៀង" is not in the dictionary, it's valid because:
 * - អ្នក is a known productive prefix
 * - ចម្រៀង is a known dictionary word
 *
 * The beam search word breaker uses this to:
 * 1. Validate OOV words that are actually valid compounds
 * 2. Optionally segment compounds at morpheme boundaries (isBreakPoint: true)
 */

export interface AffixConfig {
  text: string
  type: 'prefix' | 'suffix'
  /**
   * If true, insert a word break after prefix / before suffix.
   * Example: អ្នក (break) → "អ្នក|ចម្រៀង" (two segments)
   * If false, keep compound as single segment.
   * Example: សុខភាព → "សុខភាព" (one segment)
   */
  isBreakPoint: boolean
}

// Prefixes
// isBreakPoint: true = segment separately (អ្នក + ចម្រៀង → "អ្នក" | "ចម្រៀង")
// isBreakPoint: false = fused compound (មហា + សមុទ្រ → "មហាសមុទ្រ")
export const KHMER_PREFIXES: AffixConfig[] = [
  // Agentive/nominalization prefixes - typically segmented separately
  { text: 'អ្នក', type: 'prefix', isBreakPoint: true },  // doer/agent (អ្នកចម្រៀង = singer)
  { text: 'យ៉ាង', type: 'prefix', isBreakPoint: true }, 
  { text: 'ជន', type: 'prefix', isBreakPoint: true },   // person (ជនរងគ្រោះ = victim)
  { text: 'ការ', type: 'prefix', isBreakPoint: true },  // nominalization (ការធ្វើ = the doing)
  { text: 'សេចក្តី', type: 'prefix', isBreakPoint: true }, // abstract nominalization
  { text: 'លោក', type: 'prefix', isBreakPoint: true },  // Mr./Sir
  { text: 'លោកស្រី', type: 'prefix', isBreakPoint: true }, // Mrs./Madam
  { text: 'កញ្ញា', type: 'prefix', isBreakPoint: true }, // Miss
  { text: 'ឯកឧត្តម', type: 'prefix', isBreakPoint: true }, // His Excellency
  { text: 'លោកជំទាវ', type: 'prefix', isBreakPoint: true }, // Her Excellency
  { text: 'ព្រះ', type: 'prefix', isBreakPoint: true },  // sacred/royal prefix
  { text: 'ក្រុម', type: 'prefix', isBreakPoint: true }, // group (ក្រុមហ៊ុន = company)
  { text: 'ពួក', type: 'prefix', isBreakPoint: true },  // group/they (pluralizer)
  { text: 'គណៈ', type: 'prefix', isBreakPoint: true },  // committee/council
  { text: 'ប្រធាន', type: 'prefix', isBreakPoint: true }, // chief/head

  // Fused prefixes - keep compound as single word
  { text: 'អ', type: 'prefix', isBreakPoint: false },   // negative (អយុត្តិធម៌ = injustice)
  { text: 'អនុ', type: 'prefix', isBreakPoint: false }, // sub-/vice- (អនុប្រធាន = vice president)
  { text: 'មហា', type: 'prefix', isBreakPoint: false }, // great/grand (មហាសមុទ្រ = ocean)
  { text: 'សហ', type: 'prefix', isBreakPoint: false },  // co-/joint (សហការ = cooperate)
]

// Suffixes
// Most suffixes create fused compounds that stay as one word.
// Exception: ភorg org org (isBreakPoint: true) splits at morpheme boundary (org org org|org org org org)
export const KHMER_SUFFIXES: AffixConfig[] = [
  { text: 'កម្ម', type: 'suffix', isBreakPoint: false },    // -ification (ទំនើបកម្ម = modernization)
  { text: 'នីយកម្ម', type: 'suffix', isBreakPoint: false }, // -ization (formal)
  { text: 'ភាព', type: 'suffix', isBreakPoint: true },    // -ness/-ity (សុខភាព = health)
  { text: 'ធម៌', type: 'suffix', isBreakPoint: false },    // system/virtue (វប្បធម៌ = culture)
  { text: 'និយម', type: 'suffix', isBreakPoint: false },   // -ism (ប្រជាធិបតេយ្យនិយម = democracy)
  { text: 'វិទ្យា', type: 'suffix', isBreakPoint: false }, // -logy/science
  { text: 'សាស្ត្រ', type: 'suffix', isBreakPoint: false }, // -ology/science
  { text: 'វិស័យ', type: 'suffix', isBreakPoint: false },  // sector/field
  { text: 'ករ', type: 'suffix', isBreakPoint: false },     // -er/-or (កម្មករ = worker)
  { text: 'ការី', type: 'suffix', isBreakPoint: false },   // -er (formal)
  { text: 'ជន', type: 'suffix', isBreakPoint: false },     // person (suffix form)
  { text: 'ភក្តី', type: 'suffix', isBreakPoint: false },  // devotee/loyalist
  { text: 'ដ្ឋាន', type: 'suffix', isBreakPoint: false },  // place/station
  { text: 'មន្ទីរ', type: 'suffix', isBreakPoint: false }, // building/department
  { text: 'ាល័យ', type: 'suffix', isBreakPoint: false },   // office/institute (សាកលវិទ្យាល័យ = university)
  { text: 'ភិបាល', type: 'suffix', isBreakPoint: false },  // administration
  { text: 'ធិបតី', type: 'suffix', isBreakPoint: false },  // chief/president
  { text: 'ធិការ', type: 'suffix', isBreakPoint: false },  // authority/directorate
  { text: 'ការណ៍', type: 'suffix', isBreakPoint: false }, // affair/event (ព្រឹត្តការណ៍ = event)
]

// Combined list for iteration
export const ALL_AFFIXES: AffixConfig[] = [...KHMER_PREFIXES, ...KHMER_SUFFIXES]

// Fast lookup maps: text → config
export const PREFIX_MAP = new Map<string, AffixConfig>(
  KHMER_PREFIXES.map(p => [p.text, p])
)
export const SUFFIX_MAP = new Map<string, AffixConfig>(
  KHMER_SUFFIXES.map(s => [s.text, s])
)

// Sorted by length (longest first) for greedy matching
// Try longer affixes first to avoid partial matches
export const PREFIXES_BY_LENGTH = [...KHMER_PREFIXES]
  .sort((a, b) => b.text.length - a.text.length)
  .map(p => p.text)

export const SUFFIXES_BY_LENGTH = [...KHMER_SUFFIXES]
  .sort((a, b) => b.text.length - a.text.length)
  .map(s => s.text)
