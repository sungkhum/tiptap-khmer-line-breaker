import titlesData from './khmer-titles.json'

export const KHMER_TITLES: string[] = titlesData as string[]
export const TITLE_SET = new Set<string>(KHMER_TITLES)
export const TITLES_BY_LENGTH = [...KHMER_TITLES].sort((a, b) => b.length - a.length)

export function isTitle(word: string): boolean {
  return TITLE_SET.has(word)
}
