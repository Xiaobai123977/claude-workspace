const {networkRetryable}=require('./upstream-response.cjs')
const { setTimeout: sleep } = require('node:timers/promises')

function retryDelay(headers, attempt, { baseDelayMs = 1000, maxDelayMs = 30000, random = Math.random } = {}) {
  const milliseconds = headers?.get('retry-after-ms')
  const after = headers?.get('retry-after')
  if (milliseconds && Number.isFinite(Number(milliseconds)) && Number(milliseconds) >= 0) return Math.ceil(Number(milliseconds))
  if (after) {
    const seconds = Number(after)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
    const date = Date.parse(after)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }
  return Math.min(maxDelayMs, Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.75 + random() * 0.5)))
}

// Retry only before a response is returned to the caller. Streaming output is never replayed.
async function fetchWithRetry(fetcher, url, init, { timeout = 120000, onRetry = () => {}, policy = {}, prepare, shouldRetry, getDelay } = {}) {
  const maxRetries = policy.maxRetries ?? 10
  const requestId = require('node:crypto').randomUUID()
  const emit = event => { try { onRetry({ requestId, maxRetries, ...event }) } catch { /* UI observers must not break requests. */ } }
  let retries = 0, release = () => {}, lastReason
  try {
    while (true) {
      init.signal?.throwIfAborted()
      const prepared=await prepare?.()
      init.signal?.throwIfAborted()
      const attempt = new AbortController()
      let timedOut = false
      const abort = () => attempt.abort(init.signal.reason)
      init.signal?.addEventListener('abort', abort, { once: true })
      const attemptTimeout=prepared?.timeout||timeout,startedAt=Date.now()
      const reportAttempt=()=>emit({phase:retries?'attempting':'requesting',attempt:retries,...(lastReason||{reason:'pending'}),startedAt,timeoutAt:startedAt+attemptTimeout})
      const progressTimer=retries?undefined:setTimeout(reportAttempt,policy.noticeDelayMs??10000)
      if(retries)reportAttempt()
      const timer = setTimeout(() => { timedOut = true; attempt.abort() }, attemptTimeout)
      release = () => { clearTimeout(timer); clearTimeout(progressTimer);init.signal?.removeEventListener('abort', abort);attempt.abort() }
      let response, error
      try { response = await fetcher(url, { ...init, signal: attempt.signal }) } catch (e) { error = e }
      // The proxy fetcher resolves after response validation/first real output.
      // Keep the stream timeout alive, but never revive first-response waiting
      // while that already accepted stream is still being consumed.
      clearTimeout(progressTimer)
      if (init.signal?.aborted) { release(); throw init.signal.reason || new Error('请求已取消') }
      let retryable = response
        ? response.headers.get('x-should-retry') !== 'false' && ([408, 409, 425, 429].includes(response.status) || response.status >= 500)
        : timedOut || networkRetryable(error)
      if(shouldRetry)retryable=shouldRetry(response,error,retryable)
      if (!retryable || retries >= maxRetries) {
        if (response) return { response, retries, release }
        release()
        if((typeof error?.code==='string'&&error.code.startsWith('UPSTREAM_')))throw error
        throw new Error(`${timedOut ? '上游请求超时' : '上游网络连接失败'}${retries ? `，已重试 ${retries} 次` : ''}`)
      }
      const suggested=retryDelay(response?.headers, retries + 1, policy)
      const delay = getDelay ? getDelay(response,error,suggested) : suggested
      // A very long server cooldown should be reported, rather than retried before its deadline.
      if (delay > (policy.maxWaitMs ?? 300000)) {
        if (response) return { response, retries, release, cooldownExceeded: true }
        release(); throw new Error('上游要求的重试等待时间超过上限')
      }
      release()
      void response?.body?.cancel().catch(() => {})
      retries++
      lastReason = response?.headers.get('x-claude-gui-stream-error')==='true'?{reason:'upstream',errorType:decodeURIComponent(response.headers.get('x-claude-gui-error-type')||''),...(response.headers.has('x-claude-gui-upstream-status')?{status:Number(response.headers.get('x-claude-gui-upstream-status'))}:{})}:(typeof error?.code==='string'&&error.code.startsWith('UPSTREAM_'))?{reason:'upstream',errorType:error.code==='UPSTREAM_EMPTY_RESPONSE'?'未返回有效内容':'响应格式错误'}:{ reason: response ? 'http' : timedOut ? 'timeout' : 'network', ...(response ? { status: response.status } : {}) }
      emit({ phase: 'waiting', attempt: retries, nextAt: Date.now() + delay, ...lastReason })
      await sleep(delay, undefined, { signal: init.signal })
    }
  } catch (error) {
    release(); throw error
  } finally { emit({ phase: 'cleared' }) }
}

module.exports = { fetchWithRetry, retryDelay }
