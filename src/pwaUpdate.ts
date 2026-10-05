import { registerSW } from 'virtual:pwa-register'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // hourly — the only other update check is on navigation

/** True if any `<audio>`/`<video>` element in the page is actively playing. */
function isMediaPlaying(): boolean {
  return Array.from(document.querySelectorAll('audio, video')).some(
    (el) => !(el as HTMLMediaElement).paused,
  )
}

/**
 * Registers the service worker and reloads automatically once a new deploy's
 * worker activates (registerType: 'autoUpdate' in vite.config.ts). The plugin's
 * default auto-injected register script does NOT do this — it registers once and
 * never checks again — so this is registered manually instead (injectRegister: false).
 *
 * The reload is deferred while a track is actively playing — an unprompted full
 * page reload would otherwise cut off audio mid-track, which a music player should
 * never do. It fires as soon as playback pauses/ends instead.
 */
export function initPwaUpdates() {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS)
    },
    onNeedReload() {
      if (!isMediaPlaying()) {
        window.location.reload()
        return
      }
      // Poll rather than listen for 'pause': setting a new `src` on the <audio>
      // element at every track transition fires a transient pause as part of the
      // load algorithm, which would otherwise reload mid-queue between tracks.
      const poll = setInterval(() => {
        if (!isMediaPlaying()) {
          clearInterval(poll)
          window.location.reload()
        }
      }, 10_000)
    },
  })
}
