import type { AuthState } from '../types'
import { loadGisScript } from './gisLoader'

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly' as const

type Listener = (state: AuthState) => void

class AuthClient {
  private state: AuthState = {
    status: 'signed-out',
    accessToken: null,
    tokenExpiresAtEpochMs: null,
    scope: SCOPE,
    lastError: null,
  }

  private listeners = new Set<Listener>()
  private tokenClient: ReturnType<Window['google']['accounts']['oauth2']['initTokenClient']> | null = null
  private pendingRequest: Promise<void> | null = null
  private pendingErrorHandler: ((error: { type: string; message?: string }) => void) | null = null

  getState(): AuthState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(partial: Partial<AuthState>) {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((l) => l(this.state))
  }

  private async ensureTokenClient() {
    if (this.tokenClient) return
    await loadGisScript()
    const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID
    if (!clientId) {
      throw new Error('VITE_GOOGLE_OAUTH_CLIENT_ID is not configured (see .env.example)')
    }
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // overridden per-request below
      error_callback: (error) => {
        // Catches popup_failed_to_open / popup_closed — cases where GIS never invokes
        // `callback` at all (e.g. a popup blocked for not following a user gesture),
        // which would otherwise hang the caller's promise forever.
        this.pendingErrorHandler?.(error)
      },
    })
  }

  /** First-ever sign-in: shows Google's consent popup. */
  async signIn(): Promise<void> {
    return this.requestToken('consent')
  }

  /** Silent renewal: no UI, succeeds only with an active Google session + prior grant. */
  async renewSilently(): Promise<void> {
    return this.requestToken('')
  }

  /**
   * Tries silent renewal first, falling back to the full consent popup only if that
   * fails (no active Google session, grant revoked, etc.). This is the right entry
   * point for any "reconnect" UI action — calling `signIn()` (consent) directly would
   * force the full Google account-chooser/consent screen every time, even for a user
   * who already granted access and just needs their in-memory token refreshed.
   */
  async reconnect(): Promise<void> {
    try {
      await this.renewSilently()
    } catch {
      await this.signIn()
    }
  }

  private requestToken(prompt: '' | 'consent'): Promise<void> {
    // Coalesce concurrent callers (e.g. two Drive calls 401'ing at once) into one request.
    if (this.pendingRequest) return this.pendingRequest

    this.setState({ status: 'authenticating', lastError: null })

    this.pendingRequest = new Promise<void>((resolve, reject) => {
      this.ensureTokenClient()
        .then(() => {
          const client = this.tokenClient!
          // initTokenClient's `callback` is fixed at construction time; GIS lets us
          // override it per-call via a closure captured in requestAccessToken's config
          // is not supported directly, so we reassign via a wrapper object instead.
          ;(client as unknown as { callback: (r: never) => void }).callback = (response: {
            access_token?: string
            expires_in?: number
            error?: string
            error_description?: string
          }) => {
            this.pendingRequest = null
            this.pendingErrorHandler = null
            if (response.error) {
              const failedSilently = prompt === ''
              this.setState({
                status: failedSilently ? 'expired' : 'signed-out',
                accessToken: null,
                tokenExpiresAtEpochMs: null,
                lastError: { code: 401, message: response.error_description ?? response.error },
              })
              reject(new Error(response.error_description ?? response.error))
              return
            }
            this.setState({
              status: 'signed-in',
              accessToken: response.access_token!,
              tokenExpiresAtEpochMs: Date.now() + (response.expires_in ?? 3600) * 1000,
              lastError: null,
            })
            resolve()
          }
          this.pendingErrorHandler = (error) => {
            // GIS calls this instead of `callback` when the popup never opened/completed —
            // without this, those cases would hang the caller's promise forever.
            this.pendingRequest = null
            this.pendingErrorHandler = null
            const failedSilently = prompt === ''
            this.setState({
              status: failedSilently ? 'expired' : 'signed-out',
              accessToken: null,
              tokenExpiresAtEpochMs: null,
              lastError: { code: 0, message: error.message ?? error.type },
            })
            reject(new Error(error.message ?? error.type))
          }
          client.requestAccessToken({ prompt })
        })
        .catch((err) => {
          this.pendingRequest = null
          this.pendingErrorHandler = null
          this.setState({ status: 'signed-out', lastError: { code: 0, message: String(err) } })
          reject(err)
        })
    })

    return this.pendingRequest
  }

  signOut() {
    this.setState({
      status: 'signed-out',
      accessToken: null,
      tokenExpiresAtEpochMs: null,
      lastError: null,
    })
  }
}

export const authClient = new AuthClient()
