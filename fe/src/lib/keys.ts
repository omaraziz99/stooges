// Your identity is a secret key kept in this browser's localStorage.
// That's fine for a POC; a real deployment would use a signer extension or
// an encrypted keystore instead.
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

/** Accepts an nsec1… key or 64 hex characters. Throws on anything else. */
export function parseSecretKey(input: string): Uint8Array {
  const value = input.trim()
  if (/^[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value.toLowerCase())
  try {
    const decoded = nip19.decode(value)
    if (decoded.type === 'nsec') return decoded.data
  } catch {
    // fall through
  }
  throw new Error('That is not a valid secret key (expected nsec1… or 64 hex characters).')
}

export const toNsec = (sk: Uint8Array) => nip19.nsecEncode(sk)

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
