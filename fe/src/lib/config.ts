// Where the backend lives. In production set VITE_RELAY_URL
// (e.g. wss://your-relay.up.railway.app). Locally it falls back to port 7777
// on the same host.
export const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:7777`

/** The same server over HTTP(S), for the accounts API. */
export const API_URL = RELAY_URL.replace(/^ws/, 'http').replace(/\/+$/, '')
