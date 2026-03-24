/**
 * Spell Check Worker - SymSpell Edition
 *
 * Uses SymSpell algorithm for fast spelling suggestions.
 * Accepts configurable dictionary URL for multi-language support.
 */

// Import browser-compatible SymSpell (relative path works from /workers/)
import { SymSpell, Verbosity } from '../lib/symspell-browser.js';

// ============================================================================
// State
// ============================================================================

let symspell = null;
let debugMode = false;

// ============================================================================
// LRU Cache Implementation
// ============================================================================

const CACHE_MAX_SIZE = 1000;

class LRUCache {
  constructor(maxSize = CACHE_MAX_SIZE) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

const correctCache = new LRUCache(CACHE_MAX_SIZE);
const suggestCache = new LRUCache(CACHE_MAX_SIZE);

// ============================================================================
// IndexedDB Cache for parsed dictionary entries
// ============================================================================

const DICT_CACHE_VERSION = 1;
const IDB_DB_NAME = 'khmer-spellcheck';
const IDB_STORE_NAME = 'dictionary';

function openIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedEntries(cacheKey) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const request = store.get(cacheKey);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.version === DICT_CACHE_VERSION) {
          resolve(result.entries);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function setCachedEntries(cacheKey, entries) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put({ version: DICT_CACHE_VERSION, entries }, cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

// ============================================================================
// Dictionary Loading
// ============================================================================

function parseDictionaryText(text) {
  const entries = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const tabIndex = line.indexOf('\t');
    if (tabIndex === -1) continue;
    const word = line.substring(0, tabIndex);
    const freq = parseInt(line.substring(tabIndex + 1), 10) || 1;
    if (word) {
      entries.push([word, freq]);
    }
  }
  return entries;
}

async function initDictionary(dictionaryUrl, cacheKey) {
  try {
    if (debugMode) {
      console.log('[SpellCheck] Loading SymSpell dictionary from', dictionaryUrl);
    }
    const startTime = performance.now();

    symspell = new SymSpell(2, 7, 1);

    // Try IndexedDB cache first
    let entries = await getCachedEntries(cacheKey);
    let fromCache = false;

    if (entries) {
      fromCache = true;
      if (debugMode) {
        console.log(`[SpellCheck] Loading ${entries.length} entries from IndexedDB cache`);
      }
    } else {
      const response = await fetch(dictionaryUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch dictionary: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      entries = parseDictionaryText(text);

      // Cache parsed entries (fire and forget)
      setCachedEntries(cacheKey, entries);
    }

    let wordCount = 0;
    for (const [word, freq] of entries) {
      symspell.createDictionaryEntry(word, freq);
      wordCount++;
    }

    const elapsed = performance.now() - startTime;

    if (debugMode) {
      console.log(`[SpellCheck] Dictionary loaded: ${wordCount.toLocaleString()} words in ${elapsed.toFixed(0)}ms${fromCache ? ' (from IndexedDB cache)' : ''}`);
    }

    self.postMessage({
      type: 'ready',
      wordCount,
      loadTime: elapsed
    });
  } catch (error) {
    console.error('[SpellCheck] Init error:', error);
    self.postMessage({
      type: 'error',
      error: error.message || String(error)
    });
  }
}

// ============================================================================
// Spell Checking Functions
// ============================================================================

function isWordCorrect(word) {
  const cached = correctCache.get(word);
  if (cached !== undefined) return cached;

  const isCorrect = symspell.isCorrect(word);
  correctCache.set(word, isCorrect);
  return isCorrect;
}

function getSuggestions(word, limit = 8) {
  const cached = suggestCache.get(word);
  if (cached !== undefined) {
    return { suggestions: cached.slice(0, limit), cached: true };
  }

  const results = symspell.lookup(word, Verbosity.CLOSEST, 2);
  const suggestions = results.slice(0, limit).map(item => item.term);
  suggestCache.set(word, results.map(item => item.term));

  return { suggestions, cached: false };
}

function batchCheckWords(words) {
  const results = {};
  for (const word of words) {
    results[word] = isWordCorrect(word);
  }
  return results;
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = function(e) {
  const { type, word, words, requestId, debug, dictionaryUrl, cacheKey } = e.data;

  if (type === 'init') {
    if (debug !== undefined) {
      debugMode = debug;
    }
    const url = dictionaryUrl || '/dictionaries/km_symspell_dictionary.txt';
    const key = cacheKey || 'km_symspell';
    initDictionary(url, key);
    return;
  }

  if (type === 'setDebug') {
    debugMode = debug === true;
    return;
  }

  if (type === 'batchCheck') {
    if (!symspell) {
      self.postMessage({ type: 'batchCheckResult', requestId, results: {}, error: 'Dictionary not loaded' });
      return;
    }

    try {
      const startTime = performance.now();
      const results = batchCheckWords(words || []);
      const elapsed = performance.now() - startTime;

      self.postMessage({ type: 'batchCheckResult', requestId, results, elapsed });
    } catch (error) {
      self.postMessage({ type: 'batchCheckResult', requestId, results: {}, error: error.message || String(error) });
    }
    return;
  }

  if (type === 'check') {
    if (!symspell) {
      self.postMessage({ type: 'checkResult', requestId, word, isCorrect: true, error: 'Dictionary not loaded' });
      return;
    }

    try {
      const isCorrect = isWordCorrect(word);
      self.postMessage({ type: 'checkResult', requestId, word, isCorrect });
    } catch (error) {
      self.postMessage({ type: 'checkResult', requestId, word, isCorrect: true, error: error.message || String(error) });
    }
    return;
  }

  if (type === 'suggest') {
    if (!symspell) {
      self.postMessage({ type: 'suggestions', requestId, word, suggestions: [], error: 'Dictionary not loaded' });
      return;
    }

    try {
      const startTime = performance.now();
      const { suggestions, cached } = getSuggestions(word, 8);
      const elapsed = performance.now() - startTime;

      self.postMessage({ type: 'suggestions', requestId, word, suggestions, elapsed, cached });
    } catch (error) {
      self.postMessage({ type: 'suggestions', requestId, word, suggestions: [], error: error.message || String(error) });
    }
    return;
  }

  if (type === 'clearCache') {
    correctCache.clear();
    suggestCache.clear();
    self.postMessage({ type: 'cacheCleared' });
    return;
  }
};
