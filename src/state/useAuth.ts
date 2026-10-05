import { useEffect, useState } from 'react'
import { authClient } from '../auth/authClient'
import type { AuthState } from '../types'

export function useAuth(): AuthState & {
  signIn: () => Promise<void>
  renewSilently: () => Promise<void>
  reconnect: () => Promise<void>
  signOut: () => void
} {
  const [state, setState] = useState<AuthState>(authClient.getState())

  useEffect(() => authClient.subscribe(setState), [])

  return {
    ...state,
    signIn: () => authClient.signIn(),
    renewSilently: () => authClient.renewSilently(),
    reconnect: () => authClient.reconnect(),
    signOut: () => authClient.signOut(),
  }
}
