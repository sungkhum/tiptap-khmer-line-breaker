/**
 * SymSpell Browser Edition
 *
 * A self-contained browser-compatible version of SymSpell for Web Workers.
 * Extracted from node-symspell-new with dependencies removed.
 *
 * Original: https://github.com/Ravikumar-Pawar/node-symspell-new
 * Based on: https://github.com/wolfgarbe/SymSpell
 * License: MIT
 */

// ============================================================================
// Helper Functions (no external deps)
// ============================================================================

const nullDistanceResults = (string1, string2, maxDistance) => {
  if (string1 === null) {
    return string2 === null ? 0 : (string2.length <= maxDistance) ? string2.length : -1;
  }
  return string1.length <= maxDistance ? string1.length : -1;
};

const prefixSuffixPrep = (string1, string2) => {
  let len2 = string2.length;
  let len1 = string1.length;

  while (len1 !== 0 && string1[len1 - 1] === string2[len2 - 1]) {
    len1 = len1 - 1;
    len2 = len2 - 1;
  }

  let start = 0;
  while (start !== len1 && string1[start] === string2[start]) {
    start++;
  }

  if (start !== 0) {
    len2 -= start;
    len1 -= start;
  }

  return { len1, len2, start };
};

// ============================================================================
// Edit Distance (Damerau-Levenshtein)
// ============================================================================

class EditDistance {
  constructor() {
    this.baseChar1Costs = [];
    this.basePrevChar1Costs = [];
  }

  compare(string1, string2, maxDistance) {
    return this.distance(string1, string2, maxDistance);
  }

  distance(string1 = null, string2 = null, maxDistance) {
    if (string1 === null || string2 === null) {
      return nullDistanceResults(string1, string2, maxDistance);
    }

    if (maxDistance <= 0) {
      return (string1 === string2) ? 0 : -1;
    }

    maxDistance = Math.ceil(maxDistance);
    const iMaxDistance = (maxDistance <= Number.MAX_SAFE_INTEGER) ? maxDistance : Number.MAX_SAFE_INTEGER;

    if (string1.length > string2.length) {
      const t = string1;
      string1 = string2;
      string2 = t;
    }

    if (string2.length - string1.length > iMaxDistance) {
      return -1;
    }

    const { len1, len2, start } = prefixSuffixPrep(string1, string2);

    if (len1 === 0) {
      return (len2 <= iMaxDistance) ? len2 : -1;
    }

    if (len2 > this.baseChar1Costs.length) {
      this.baseChar1Costs = new Array(len2);
      this.basePrevChar1Costs = new Array(len2);
    }

    if (iMaxDistance < len2) {
      return this._distanceMax(string1, string2, len1, len2, start, iMaxDistance, this.baseChar1Costs, this.basePrevChar1Costs);
    }

    return this._distance(string1, string2, len1, len2, start, this.baseChar1Costs, this.basePrevChar1Costs);
  }

  _distance(string1, string2, len1, len2, start, char1Costs, prevChar1Costs) {
    char1Costs = [];

    for (let j = 0; j < len2;) {
      char1Costs[j] = ++j;
    }

    let char1 = ' ';
    let currentCost = 0;

    for (let i = 0; i < len1; ++i) {
      const prevChar1 = char1;
      char1 = string1[start + i];
      let char2 = ' ';
      let aboveCharCost = i;
      let leftCharCost = i;
      let nextTransCost = 0;

      for (let j = 0; j < len2; ++j) {
        const thisTransCost = nextTransCost;
        nextTransCost = prevChar1Costs[j];
        currentCost = leftCharCost;
        prevChar1Costs[j] = leftCharCost;
        leftCharCost = char1Costs[j];
        const prevChar2 = char2;
        char2 = string2[start + j];

        if (char1 !== char2) {
          if (aboveCharCost < currentCost) {
            currentCost = aboveCharCost;
          }

          if (leftCharCost < currentCost) {
            currentCost = leftCharCost;
          }

          ++currentCost;

          if ((i !== 0) && (j !== 0) &&
            (char1 === prevChar2) &&
            (prevChar1 === char2) &&
            (thisTransCost + 1 < currentCost)) {
            currentCost = thisTransCost + 1;
          }
        }

        char1Costs[j] = aboveCharCost = currentCost;
      }
    }

    return currentCost;
  }

  _distanceMax(string1, string2, len1, len2, start, maxDistance, char1Costs, prevChar1Costs) {
    char1Costs = [];

    for (let j = 0; j < len2; j++) {
      if (j < maxDistance) {
        char1Costs[j] = j + 1;
      } else {
        char1Costs[j] = maxDistance + 1;
      }
    }

    const lenDiff = len2 - len1;
    const jStartOffset = maxDistance - lenDiff;
    let jStart = 0;
    let jEnd = maxDistance;
    let char1 = ' ';
    let currentCost = 0;

    for (let i = 0; i < len1; ++i) {
      const prevChar1 = char1;
      char1 = string1[start + i];
      let char2 = ' ';
      let leftCharCost = i;
      let aboveCharCost = i;
      let nextTransCost = 0;

      jStart += (i > jStartOffset) ? 1 : 0;
      jEnd += (jEnd < len2) ? 1 : 0;

      for (let j = jStart; j < jEnd; ++j) {
        const thisTransCost = nextTransCost;
        nextTransCost = prevChar1Costs[j];
        currentCost = leftCharCost;
        prevChar1Costs[j] = leftCharCost;
        leftCharCost = char1Costs[j];
        const prevChar2 = char2;
        char2 = string2[start + j];

        if (char1 !== char2) {
          if (aboveCharCost < currentCost) {
            currentCost = aboveCharCost;
          }

          if (leftCharCost < currentCost) {
            currentCost = leftCharCost;
          }

          currentCost += 1;

          if (i !== 0 && j !== 0 &&
            char1 === prevChar2 &&
            prevChar1 === char2 &&
            thisTransCost + 1 < currentCost) {
            currentCost = thisTransCost + 1;
          }
        }

        aboveCharCost = currentCost;
        char1Costs[j] = currentCost;
      }

      if (char1Costs[i + lenDiff] > maxDistance) {
        return -1;
      }
    }

    return (currentCost <= maxDistance) ? currentCost : -1;
  }
}

// ============================================================================
// SuggestItem
// ============================================================================

class SuggestItem {
  constructor(term = '', distance = 0, count = 0) {
    this.term = term;
    this.distance = distance;
    this.count = count;
  }

  compareTo(other) {
    if (this.distance === other.distance) {
      return this.count - other.count;
    }
    return other.distance - this.distance;
  }
}

// ============================================================================
// Verbosity Enum
// ============================================================================

const Verbosity = {
  TOP: 0,      // Return suggestion with highest term frequency
  CLOSEST: 1,  // Return all suggestions of smallest edit distance
  ALL: 2       // Return all suggestions within maxEditDistance
};

// ============================================================================
// SymSpell Main Class
// ============================================================================

class SymSpell {
  static get N() {
    return 1024908267229;
  }

  static get Verbosity() {
    return Verbosity;
  }

  constructor(maxDictionaryEditDistance = 2, prefixLength = 7, countThreshold = 1) {
    this.maxDictionaryEditDistance = maxDictionaryEditDistance;
    this.prefixLength = prefixLength;
    this.countThreshold = countThreshold;

    this.words = new Map();
    this.maxDictionaryWordLength = 0;
    this.deletes = new Map();
    this.belowThresholdWords = new Map();
  }

  /**
   * Add a word to the dictionary with its frequency count.
   * @param {string} key - The word to add
   * @param {number} count - The frequency count
   * @returns {boolean} - True if word was added as correctly spelled
   */
  createDictionaryEntry(key, count) {
    if (count <= 0) {
      if (this.countThreshold > 0) return false;
      count = 0;
    }

    let countPrevious = -1;

    if (this.countThreshold > 1 && this.belowThresholdWords.has(key)) {
      countPrevious = this.belowThresholdWords.get(key);
      count = (Number.MAX_SAFE_INTEGER - countPrevious > count) ? countPrevious + count : Number.MAX_SAFE_INTEGER;

      if (count >= this.countThreshold) {
        this.belowThresholdWords.delete(key);
      } else {
        this.belowThresholdWords.set(key, count);
        return false;
      }
    } else if (this.words.has(key)) {
      countPrevious = this.words.get(key);
      count = (Number.MAX_SAFE_INTEGER - countPrevious > count) ? countPrevious + count : Number.MAX_SAFE_INTEGER;
      this.words.set(key, count);
      return false;
    } else if (count < this.countThreshold) {
      this.belowThresholdWords.set(key, count);
      return false;
    }

    this.words.set(key, count);

    if (key.length > this.maxDictionaryWordLength) {
      this.maxDictionaryWordLength = key.length;
    }

    const edits = this.editsPrefix(key);
    edits.forEach((deleteWord) => {
      if (this.deletes.has(deleteWord)) {
        this.deletes.get(deleteWord).push(key);
      } else {
        this.deletes.set(deleteWord, [key]);
      }
    });

    return true;
  }

  editsPrefix(key) {
    const hashSet = new Set();

    if (key.length <= this.maxDictionaryEditDistance) {
      hashSet.add('');
    }

    if (key.length > this.prefixLength) {
      key = key.substring(0, this.prefixLength);
    }

    hashSet.add(key);
    return this.edits(key, 0, hashSet);
  }

  edits(word, editDistance, deleteWords) {
    editDistance++;

    if (word.length > 1) {
      for (let i = 0; i < word.length; i++) {
        const del = word.substring(0, i) + word.substring(i + 1);

        if (!deleteWords.has(del)) {
          deleteWords.add(del);

          if (editDistance < this.maxDictionaryEditDistance) {
            this.edits(del, editDistance, deleteWords);
          }
        }
      }
    }

    return deleteWords;
  }

  /**
   * Find spelling suggestions for the input term.
   * @param {string} input - The word to check
   * @param {number} verbosity - Verbosity level (TOP, CLOSEST, or ALL)
   * @param {number} maxEditDistance - Maximum edit distance (default: dictionary max)
   * @param {Object} options - Additional options
   * @returns {SuggestItem[]} - Array of suggestions
   */
  lookup(input, verbosity, maxEditDistance = null, { includeUnknown, ignoreToken } = {}) {
    if (maxEditDistance === null) {
      maxEditDistance = this.maxDictionaryEditDistance;
    }

    if (maxEditDistance > this.maxDictionaryEditDistance) {
      throw new Error('maxEditDistance cannot exceed dictionary maxEditDistance');
    }

    const suggestions = [];
    const inputLen = input.length;

    if (inputLen - maxEditDistance > this.maxDictionaryWordLength) {
      return suggestions;
    }

    let suggestionCount = 0;
    if (this.words.has(input)) {
      suggestionCount = this.words.get(input);
      suggestions.push(new SuggestItem(input, 0, suggestionCount));

      if (verbosity !== Verbosity.ALL) {
        return suggestions;
      }
    }

    if (maxEditDistance === 0) {
      return suggestions;
    }

    const consideredDeletes = new Set();
    const consideredSuggestions = new Set();
    consideredSuggestions.add(input);

    let maxEditDistance2 = maxEditDistance;
    let candidatePointer = 0;
    const candidates = [];

    let inputPrefixLen = inputLen;
    if (inputPrefixLen > this.prefixLength) {
      inputPrefixLen = this.prefixLength;
      candidates.push(input.substring(0, inputPrefixLen));
    } else {
      candidates.push(input);
    }

    const distanceComparer = new EditDistance();

    while (candidatePointer < candidates.length) {
      const candidate = candidates[candidatePointer++];
      const candidateLen = candidate.length;
      const lengthDiff = inputPrefixLen - candidateLen;

      if (lengthDiff > maxEditDistance2) {
        if (verbosity === Verbosity.ALL) {
          continue;
        }
        break;
      }

      if (this.deletes.has(candidate)) {
        const dictSuggestions = this.deletes.get(candidate);

        for (let i = 0; i < dictSuggestions.length; i++) {
          const suggestion = dictSuggestions[i];
          const suggestionLen = suggestion.length;

          if (suggestion === input) {
            continue;
          }

          if (Math.abs(suggestionLen - inputLen) > maxEditDistance2 ||
              suggestionLen < candidateLen ||
              (suggestionLen === candidateLen && suggestion !== candidate)) {
            continue;
          }

          const sugPrefixLen = Math.min(suggestionLen, this.prefixLength);
          if (sugPrefixLen > inputPrefixLen && sugPrefixLen - candidateLen > maxEditDistance2) {
            continue;
          }

          let distance;
          const min = 0;

          if (candidateLen === 0) {
            distance = Math.max(inputLen, suggestionLen);
            if (distance > maxEditDistance2 || consideredSuggestions.has(suggestion)) {
              continue;
            }
            consideredSuggestions.add(suggestion);
          } else if (suggestionLen === 1) {
            if (input.indexOf(suggestion[0]) < 0) {
              distance = inputLen;
            } else {
              distance = inputLen - 1;
            }
            if (distance > maxEditDistance2 || consideredSuggestions.has(suggestion)) {
              continue;
            }
            consideredSuggestions.add(suggestion);
          } else {
            if (this.prefixLength - maxEditDistance === candidateLen) {
              const minVal = Math.min(inputLen, suggestionLen) - this.prefixLength;
              if (minVal > 1 &&
                  input.substring(inputLen + 1 - minVal) !== suggestion.substring(suggestionLen + 1 - minVal)) {
                continue;
              }
            } else {
              const minSuggestionLen = Math.min(suggestionLen, inputLen);
              if (this.prefixLength - maxEditDistance === minSuggestionLen) {
                const minVal = Math.min(inputLen, suggestionLen) - this.prefixLength;
                if (minVal > 1 &&
                    input.substring(inputLen + 1 - minVal) !== suggestion.substring(suggestionLen + 1 - minVal)) {
                  continue;
                }
              }
            }

            if (consideredSuggestions.has(suggestion)) {
              continue;
            }
            consideredSuggestions.add(suggestion);

            distance = distanceComparer.compare(input, suggestion, maxEditDistance2);
            if (distance < 0) {
              continue;
            }
          }

          if (distance <= maxEditDistance2) {
            suggestionCount = this.words.get(suggestion);
            const si = new SuggestItem(suggestion, distance, suggestionCount);

            if (suggestions.length > 0) {
              switch (verbosity) {
                case Verbosity.CLOSEST:
                  if (distance < maxEditDistance2) {
                    suggestions.length = 0;
                  }
                  break;
                case Verbosity.TOP:
                  if (distance < maxEditDistance2 || suggestionCount > suggestions[0].count) {
                    maxEditDistance2 = distance;
                    suggestions[0] = si;
                  }
                  continue;
              }
            }

            if (verbosity !== Verbosity.ALL) {
              maxEditDistance2 = distance;
            }

            suggestions.push(si);
          }
        }
      }

      if (lengthDiff < maxEditDistance && candidateLen <= this.prefixLength) {
        if (verbosity !== Verbosity.ALL && lengthDiff >= maxEditDistance2) {
          continue;
        }

        for (let i = 0; i < candidateLen; i++) {
          const del = candidate.substring(0, i) + candidate.substring(i + 1);

          if (!consideredDeletes.has(del)) {
            consideredDeletes.add(del);
            candidates.push(del);
          }
        }
      }
    }

    if (suggestions.length > 1) {
      suggestions.sort((a, b) => {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        return b.count - a.count;
      });
    }

    return suggestions;
  }

  /**
   * Check if a word exists in the dictionary (exact match).
   * @param {string} word - The word to check
   * @returns {boolean} - True if word exists in dictionary
   */
  isCorrect(word) {
    return this.words.has(word);
  }

  /**
   * Get the word count in the dictionary.
   * @returns {number} - Number of words
   */
  get wordCount() {
    return this.words.size;
  }
}

// Export for ES modules
export { SymSpell, SuggestItem, Verbosity, EditDistance };
