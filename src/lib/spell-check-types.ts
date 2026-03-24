/**
 * TypeScript types for the spell check worker message protocol.
 */

// ============================================================================
// Messages: Main Thread → Worker
// ============================================================================

export interface SpellCheckInitMessage {
  type: 'init'
  dictionaryUrl?: string
  cacheKey?: string
  symspellUrl?: string
  debug?: boolean
}

export interface SpellCheckSetDebugMessage {
  type: 'setDebug'
  debug: boolean
}

export interface SpellCheckBatchCheckMessage {
  type: 'batchCheck'
  words: string[]
  requestId: string
}

export interface SpellCheckSingleCheckMessage {
  type: 'check'
  word: string
  requestId: string
}

export interface SpellCheckSuggestMessage {
  type: 'suggest'
  word: string
  requestId: string
}

export interface SpellCheckClearCacheMessage {
  type: 'clearCache'
}

export type SpellCheckWorkerMessage =
  | SpellCheckInitMessage
  | SpellCheckSetDebugMessage
  | SpellCheckBatchCheckMessage
  | SpellCheckSingleCheckMessage
  | SpellCheckSuggestMessage
  | SpellCheckClearCacheMessage

// ============================================================================
// Messages: Worker → Main Thread
// ============================================================================

export interface SpellCheckReadyResponse {
  type: 'ready'
  wordCount: number
  loadTime?: number
}

export interface SpellCheckBatchCheckResponse {
  type: 'batchCheckResult'
  requestId: string
  results: Record<string, boolean>
  elapsed?: number
  error?: string
}

export interface SpellCheckSingleCheckResponse {
  type: 'checkResult'
  requestId: string
  word: string
  isCorrect: boolean
  error?: string
}

export interface SpellCheckSuggestionsResponse {
  type: 'suggestions'
  requestId: string
  word: string
  suggestions: string[]
  elapsed?: number
  cached?: boolean
  error?: string
}

export interface SpellCheckErrorResponse {
  type: 'error'
  error: string
}

export interface SpellCheckCacheClearedResponse {
  type: 'cacheCleared'
}

export type SpellCheckWorkerResponse =
  | SpellCheckReadyResponse
  | SpellCheckBatchCheckResponse
  | SpellCheckSingleCheckResponse
  | SpellCheckSuggestionsResponse
  | SpellCheckErrorResponse
  | SpellCheckCacheClearedResponse

// ============================================================================
// Request Tracking
// ============================================================================

export interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const DEFAULT_REQUEST_TIMEOUT = 5000

// ============================================================================
// Worker Manager
// ============================================================================

export class SpellCheckWorkerManager {
  private worker: Worker | null = null
  private pendingRequests = new Map<string, PendingRequest<unknown>>()
  private isReady = false
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private debugMode = false
  private _wordCount = 0

  constructor(debugMode = false) {
    this.debugMode = debugMode
  }

  async init(dictionaryUrl?: string, cacheKey?: string, workerUrl = '/workers/spell-check-worker.js', symspellUrl?: string): Promise<number> {
    if (typeof window === 'undefined') {
      throw new Error('Worker can only be initialized in browser environment')
    }

    this.worker = new Worker(workerUrl, { type: 'module' })

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    this.worker.onmessage = (e: MessageEvent<SpellCheckWorkerResponse>) => {
      this.handleMessage(e.data)
    }

    this.worker.onerror = (e) => {
      console.error('[SpellCheckManager] Worker error:', e)
    }

    this.worker.postMessage({
      type: 'init',
      dictionaryUrl,
      cacheKey,
      symspellUrl,
      debug: this.debugMode,
    } as SpellCheckInitMessage)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'))
      }, 30000)

      this.readyPromise!.then(() => {
        clearTimeout(timeout)
        resolve(this._wordCount)
      })
    })
  }

  private handleMessage(data: SpellCheckWorkerResponse): void {
    switch (data.type) {
      case 'ready':
        this.isReady = true
        this._wordCount = data.wordCount
        if (this.readyResolve) this.readyResolve()
        break

      case 'batchCheckResult':
      case 'checkResult':
      case 'suggestions':
        this.resolveRequest(data.requestId, data)
        break

      case 'error':
        console.error('[SpellCheckManager] Worker error:', data.error)
        break

      case 'cacheCleared':
        break
    }
  }

  private resolveRequest(requestId: string, data: unknown): void {
    const pending = this.pendingRequests.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(requestId)
      pending.resolve(data)
    }
  }

  private sendRequest<T>(
    message: SpellCheckWorkerMessage & { requestId?: string },
    timeout = DEFAULT_REQUEST_TIMEOUT,
  ): Promise<T> {
    if (!this.worker || !this.isReady) {
      return Promise.reject(new Error('Worker not ready'))
    }

    const requestId = generateRequestId()
    const messageWithId = { ...message, requestId }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Request timeout: ${message.type}`))
      }, timeout)

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      })

      this.worker!.postMessage(messageWithId)
    })
  }

  async batchCheck(words: string[]): Promise<Record<string, boolean>> {
    const response = await this.sendRequest<SpellCheckBatchCheckResponse>({
      type: 'batchCheck',
      words,
      requestId: '',
    })
    if (response.error) throw new Error(response.error)
    return response.results
  }

  async check(word: string): Promise<boolean> {
    const response = await this.sendRequest<SpellCheckSingleCheckResponse>({
      type: 'check',
      word,
      requestId: '',
    })
    if (response.error) throw new Error(response.error)
    return response.isCorrect
  }

  async suggest(word: string): Promise<string[]> {
    const response = await this.sendRequest<SpellCheckSuggestionsResponse>({
      type: 'suggest',
      word,
      requestId: '',
    })
    if (response.error) throw new Error(response.error)
    return response.suggestions
  }

  setDebug(debug: boolean): void {
    this.debugMode = debug
    if (this.worker) {
      this.worker.postMessage({ type: 'setDebug', debug } as SpellCheckSetDebugMessage)
    }
  }

  clearCache(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'clearCache' } as SpellCheckClearCacheMessage)
    }
  }

  terminate(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Worker terminated'))
    }
    this.pendingRequests.clear()

    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.isReady = false
  }

  get ready(): boolean {
    return this.isReady
  }

  get wordCount(): number {
    return this._wordCount
  }
}
