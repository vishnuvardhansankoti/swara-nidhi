import { authClient } from '../auth/authClient'

export class DriveApiError extends Error {
  code: number
  reason: string | null

  constructor(code: number, reason: string | null, message: string) {
    super(message)
    this.name = 'DriveApiError'
    this.code = code
    this.reason = reason
  }

  static async fromResponse(res: Response): Promise<DriveApiError> {
    try {
      const body = await res.json()
      const reason = body?.error?.errors?.[0]?.reason ?? null
      return new DriveApiError(res.status, reason, body?.error?.message ?? res.statusText)
    } catch {
      return new DriveApiError(res.status, null, res.statusText)
    }
  }

  get isRateLimit() {
    return this.code === 403 && (this.reason === 'userRateLimitExceeded' || this.reason === 'rateLimitExceeded')
  }

  get isPermissionDenied() {
    return (this.code === 403 && this.reason === 'insufficientFilePermissions') || this.code === 404
  }
}

/**
 * Wraps `fetch` for all Drive API calls: attaches the bearer token and
 * transparently retries exactly once on 401 after a silent token renewal.
 * Playback of already-fetched blobs never passes through here — see
 * PRD.md section 2.2.
 */
export async function driveFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async () => {
    const token = authClient.getState().accessToken
    if (!token) {
      await authClient.renewSilently()
    }
    return fetch(input, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${authClient.getState().accessToken}` },
    })
  }

  let response = await attempt()
  if (response.status === 401) {
    await authClient.renewSilently()
    response = await attempt()
  }
  return response
}

/** Exponential backoff with jitter, used for 403 rate-limit retries during scans. */
export async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; onRetry?: (attempt: number, delayMs: number) => void } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 6
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof DriveApiError) || !err.isRateLimit || attempt === maxAttempts) {
        throw err
      }
      const delayMs = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 300
      opts.onRetry?.(attempt, delayMs)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error('unreachable')
}
