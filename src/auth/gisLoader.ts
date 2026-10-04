// Loads the Google Identity Services script exactly once, on demand.

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

let loadPromise: Promise<void> | null = null

export function loadGisScript(): Promise<void> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'))
    document.head.appendChild(script)
  })

  return loadPromise
}
