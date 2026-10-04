// Minimal ambient types for the Google Identity Services token client.
// https://developers.google.com/identity/oauth2/web/reference/js-reference

export {}

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient(config: GisTokenClientConfig): GisTokenClient
        }
      }
    }
  }
}

interface GisTokenResponse {
  access_token: string
  expires_in: number // seconds
  scope: string
  token_type: string
  error?: string
  error_description?: string
}

interface GisTokenClientConfig {
  client_id: string
  scope: string
  callback: (response: GisTokenResponse) => void
  error_callback?: (error: { type: string; message?: string }) => void
}

interface GisTokenClient {
  requestAccessToken(overrideConfig?: { prompt?: '' | 'consent' | 'select_account' }): void
}
