// Chat attachments: uploaded to the relay's /files endpoint, then referenced
// from a message with NIP-92 "imeta" tags (and the URL in the text, so other
// Nostr clients still see a link).
import { finalizeEvent } from 'nostr-tools/pure'
import { API_URL } from './config'
import type { NostrEvent } from './relay'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
/** What the file picker offers; the server checks the bytes itself. */
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.zip,.docx,.xlsx,.pptx'

export type Attachment = {
  url: string
  type: string
  name: string
  size: number
  sha256: string
}

const FILES_URL = `${API_URL}/files`

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/** Uploads one file, signed with the user's key (NIP-98 HTTP auth). */
export async function uploadFile(secretKey: Uint8Array, file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 10 MB.`)
  const body = await file.arrayBuffer()
  const sha256 = hex(await crypto.subtle.digest('SHA-256', body))
  const auth = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['u', FILES_URL],
        ['method', 'POST'],
        ['payload', sha256],
      ],
    },
    secretKey,
  )
  let res: Response
  try {
    res = await fetch(FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(auth))}`, 'Content-Type': 'application/octet-stream' },
      body,
    })
  } catch {
    throw new Error(`Can't reach the file server at ${API_URL}.`)
  }
  const data = (await res.json().catch(() => null)) as { url?: string; type?: string; size?: number; error?: string } | null
  if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status}).`)
  return { url: data.url, type: data.type ?? file.type, name: file.name, size: data.size ?? file.size, sha256 }
}

/** NIP-92 imeta tag for an attachment. */
export const imetaTag = (a: Attachment) => [
  'imeta',
  `url ${a.url}`,
  `m ${a.type}`,
  `x ${a.sha256}`,
  `size ${a.size}`,
  `alt ${a.name}`,
]

/**
 * Attachments on a message. Only files on our own file server are shown, so a
 * crafted message can't make everyone's browser load an outside URL.
 */
export function attachmentsOf(event: NostrEvent): Attachment[] {
  const out: Attachment[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue
    const field = (k: string) => tag.find((v) => v.startsWith(`${k} `))?.slice(k.length + 1) ?? ''
    const url = field('url')
    if (!url.startsWith(`${FILES_URL}/`)) continue
    out.push({
      url,
      type: field('m'),
      name: field('alt') || 'file',
      size: Number(field('size')) || 0,
      sha256: field('x'),
    })
  }
  return out
}

/** Message text without the attachment links (they're shown as previews instead). */
export function textWithoutAttachments(content: string, attachments: Attachment[]) {
  let text = content
  for (const a of attachments) text = text.split(a.url).join('')
  return text.trim()
}

export const isImage = (a: Attachment) => a.type.startsWith('image/')

export const downloadUrl = (a: Attachment) => `${a.url}?name=${encodeURIComponent(a.name)}`

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
