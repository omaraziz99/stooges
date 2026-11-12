// Email + password accounts. The password never leaves the browser:
//   - authKey = PBKDF2(password, salted with the email): proves the password to
//     the server, which stores only a bcrypt hash of it;
//   - the chat key is encrypted with the password (NIP-49 ncryptsec) before it
//     is uploaded, and decrypted here after log-in.
// The server never holds a usable key or password. A forgotten password
// therefore can't be reset without starting a new identity.
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip49 from 'nostr-tools/nip49'
import { API_URL } from './config'

export const MIN_PASSWORD = 8
const PBKDF2_ITERATIONS = 600_000

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

async function deriveAuthKey(email: string, password: string): Promise<string> {
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`stooges-auth:${normalizeEmail(email)}`), iterations: PBKDF2_ITERATIONS },
    material,
    256,
  )
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function call<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Also what a browser reports when the server is an older version without
    // the accounts API (its CORS preflight fails).
    throw new Error(`Can't reach the accounts service at ${API_URL}. Check the server is running the latest version.`)
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!data) throw new Error(`The server at ${API_URL} doesn't have the accounts API yet. Redeploy the backend.`)
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.')
  return data
}

/** Creates an account and returns the new user's secret key. */
export async function signUp(email: string, password: string): Promise<Uint8Array> {
  const sk = generateSecretKey()
  const [authKey, ncryptsec] = await Promise.all([
    deriveAuthKey(email, password),
    Promise.resolve().then(() => nip49.encrypt(sk, password)),
  ])
  await call('/api/signup', { email: normalizeEmail(email), auth_key: authKey, pubkey: getPublicKey(sk), ncryptsec })
  return sk
}

/** Logs in and returns the user's secret key, decrypted locally. */
export async function logIn(email: string, password: string): Promise<Uint8Array> {
  const authKey = await deriveAuthKey(email, password)
  const { pubkey, ncryptsec } = await call<{ pubkey: string; ncryptsec: string }>('/api/login', {
    email: normalizeEmail(email),
    auth_key: authKey,
  })
  let sk: Uint8Array
  try {
    sk = nip49.decrypt(ncryptsec, password)
  } catch {
    throw new Error('Wrong email or password.')
  }
  if (getPublicKey(sk) !== pubkey) throw new Error('Wrong email or password.')
  return sk
}
