// After logging in, the (decrypted) chat key is kept in this browser's
// localStorage so you stay signed in. Signing out removes it; the encrypted
// copy stays on the server for the next log-in.
import * as nip19 from 'nostr-tools/nip19'

const STORAGE_KEY = 'stooges.secretKey'

export function loadSecretKey(): Uint8Array | null {
  try {
    const hex = localStorage.getItem(STORAGE_KEY)
    return hex && /^[0-9a-f]{64}$/.test(hex) ? hexToBytes(hex) : null
  } catch {
    return null
  }
}

export function saveSecretKey(sk: Uint8Array) {
  try {
    localStorage.setItem(STORAGE_KEY, bytesToHex(sk))
  } catch {
    // Storage blocked (private mode): the session still works until reload.
  }
}

export function clearSecretKey() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function shortNpub(pubkey: string) {
  const npub = nip19.npubEncode(pubkey)
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
