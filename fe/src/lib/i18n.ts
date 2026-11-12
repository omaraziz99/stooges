// English is written inline in the components and doubles as the key; the
// Manglish table below maps it. Anything missing falls back to English, so a
// new string never breaks, it just stays English until it is added here.
// Placeholders are {name}. Only the app's own text belongs here, never
// message content, names, or AI-written report text.
import { Fragment, createElement, type ReactNode } from 'react'

export type Lang = 'en' | 'manglish'
export type Vars = Record<string, string | number>

const MANGLISH: Record<string, string> = {
  // Login
  'Create account': 'Buat account',
  'Log in': 'Masuk lah',
  Name: 'Nama',
  Email: 'Email',
  Password: 'Password',
  'At least {n} characters': 'Minimum {n} character ah',
  'Enter your name.': 'Eh, put your nama first lah.',
  'Use at least {n} characters for your password.': 'Password must at least {n} character one, cannot so short lah.',
  'Creating account…': 'Creating account, wait ah…',
  'Logging in…': 'Logging in, jap ah…',
  'Wrong email or password.': 'Alamak, email or password salah lah.',
  'An account with this email already exists. Log in instead.': 'This email got account already lah. Just log in can?',
  'Too many attempts. Try again in a few minutes.': 'Wah, try so many times. Rest a while then try again lah.',
  'Enter a valid email address.': 'Your email like not correct leh.',
  'Something went wrong. Try again.': 'Aiyo, something went wrong. Try again lah.',

  // Preferences
  Theme: 'Theme',
  'Kopi O': 'Kopi O',
  'Teh Susu': 'Teh Susu',
  'Manglish mode': 'Manglish mode',
  'Switch to Kopi O (dark)': 'Tukar to Kopi O (gelap)',
  'Switch to Teh Susu (light)': 'Tukar to Teh Susu (terang)',
  On: 'On liao',
  Off: 'Off',

  // Sidebar
  'Search channels': 'Cari channel',
  'KPI insights': 'KPI insights',
  Channels: 'Channel-channel',
  'No channels match “{q}”.': 'Got no channel like “{q}” leh.',
  'Add channel': 'Tambah channel',
  'Channel name': 'Channel nama',
  "What's it about? (optional)": 'About what one? (optional lah)',
  'Work channel: include in KPI insights': 'Work channel: put inside KPI insights',
  'Off by default. Everyone sees a badge when it is on.': 'Default off one. If on, everybody can see the badge.',
  'Use letters or numbers in the name.': 'Name must got letter or number lah.',
  Create: 'Buat',
  'Creating…': 'Buat-ing…',
  Cancel: 'Tak jadi',
  'Edit name': 'Tukar nama',
  'Sign out': 'Chow already',
  Save: 'Simpan',
  'Opted in': 'Join already',
  'Not opted in': 'Not join yet',
  Connected: 'Connected liao',
  'Signing in…': 'Signing in, jap…',
  'Connecting…': 'Connecting, wait ah…',
  'Offline, retrying…': 'Offline lah, trying again…',
  'Whether the KPI agent may read your messages in work channels. Off until you turn it on.':
    'Can the KPI agent read your message in work channel or not. Off until you on it yourself.',
  'Opt in to KPI insights?\n\nAn AI agent will read your messages in channels marked "KPI insights on" and note positive contributions for you and your manager. It never reads other channels and records no scores.\n\nYou can opt out at any time.':
    'Want to join KPI insights or not?\n\nThe AI agent will read your message in channel got "KPI insights on" and write down the good stuff you do, for you and your boss. Other channel it won\'t simply read, and no marks one.\n\nAnytime also can opt out.',
  'Opt out of KPI insights?\n\nThe agent will stop reading your messages and leave you out of the next report.':
    'Sure want to opt out ah?\n\nThe agent won\'t read your message already, next report also no you.',
  'Work channel': 'Work channel',

  // Workspace
  'No channels yet. Create one with {add} in the sidebar.': 'No channel yet leh. Use {add} at the sidebar to make one lah.',
  'Open channel list': 'Buka channel list',
  'Unknown command {cmd}. Try /kpi-<name>.': 'What command is {cmd} ah? Try /kpi-<name> lah.',
  'The KPI report is still loading. Try again in a moment.': 'KPI report still loading, wait a while then try again ah.',
  'No KPI report for you yet. Opt in from the sidebar; it appears after the agent next runs.':
    'No KPI report for you yet leh. Opt in at the sidebar first, after the agent run then got.',
  'You can only open your own KPI review.': 'Can only open your own KPI review one lah.',
  'No one called "{q}" in the report. Try {options}.': 'Got nobody called "{q}" in the report leh. Try {options} lah.',
  '"{q}" matches {names}. Type more of the name.': '"{q}" can be {names} leh. Type more of the name lah.',
  'KPI review for {name}': 'KPI review for {name}',
  '{n} item': '{n} item',
  '{n} items': '{n} item',

  // Channel
  'Include #{name} in KPI insights?\n\nThe KPI agent will read messages here from people who have opted in. Everyone in the channel will see a badge saying so.':
    'Put #{name} inside KPI insights ah?\n\nThe KPI agent will read message here from people who opt in. Everybody in the channel will see the badge one.',
  'Stop including #{name} in KPI insights?': 'Take #{name} out from KPI insights ah?',
  'This is the start of #{name}.': 'This one the start of #{name} lah.',
  'Loading messages…': 'Loading message, wait ah…',
  'The KPI agent reads messages here, only from people who have opted in.':
    'KPI agent read message here, only from people who opt in one.',
  'The KPI agent never reads this channel.': 'KPI agent sure won\'t read this channel one.',
  'KPI insights on': 'KPI insights on liao',
  'Not reviewed': 'Nobody check one',
  'Turn off': 'Tutup',
  'Turn on': 'Buka',
  'Message #{name}': 'Say something in #{name} lah',

  // Attachments and channel deletion
  'Attach file': 'Lampir file',
  Attachments: 'Lampiran',
  'Uploading…': 'Uploading, wait ah…',
  'Remove attachment': 'Buang lampiran',
  'Up to {n} attachments per message.': 'One message maximum {n} file only lah.',
  'Files can be up to 10 MB.': 'File maximum 10 MB only ah.',
  "That file type isn't supported. Use an image, PDF, text, or Office/zip file.":
    'This kind of file cannot leh. Use picture, PDF, text, or Office/zip file lah.',
  'Too many uploads. Try again in a few minutes.': 'Wah, upload so many already. Rest a while then try again.',
  'Delete channel': 'Buang channel',
  'Channel settings': 'Channel setting',
  'Star channel': 'Bintang channel ni',
  'Unstar channel': 'Buang bintang',
  Starred: 'Favourite',
  'Delete #{name}? Every message in it is deleted for everyone. This cannot be undone.':
    'Confirm want to buang #{name} ah? All message inside also gone for everybody. Cannot undo one ok.',

  // Composer
  'Tab to complete · Enter to run': 'Tab to complete · Enter to jalan',
  'Run command': 'Jalan command',
  Send: 'Hantar',

  // Messages and threads
  'Delete this message? This cannot be undone.': 'Confirm want to delete ah? Cannot undo one ok.',
  '{n} reply': '{n} reply',
  '{n} replies': '{n} reply',
  'Add reaction': 'Bagi reaction',
  'Reply in thread': 'Reply in thread',
  Reply: 'Balas',
  'Delete message': 'Buang message',
  Delete: 'Buang',
  'This message was deleted.': 'This message kena delete already.',
  Thread: 'Thread',
  'Reply…': 'Balas sikit…',

  // KPI review panel and parts
  'KPI review · {name}': 'KPI review · {name}',
  'Only visible to you': 'Only you can see one',
  'AI-drafted from {channels}, {from} to {to}. Check the linked messages before using this in a review.':
    'AI write from {channels}, {from} until {to}. Check the message first before use for review ah.',
  'Evidence ({n})': 'Bukti ({n})',
  'Open full profile in KPI insights →': 'Tengok full profile in KPI insights →',
  'No evidence found for {name} in {channels} for this period. Their work may happen in other channels or tools, so ask about it directly.':
    'No bukti for {name} in {channels} this period leh. Maybe the work happen in other channel or tool, so better ask directly lah.',
  Highlights: 'Yang best',
  'For your 1-on-1': 'For your 1-on-1 (over kopi)',
  'No written review was generated for this person. The evidence below is still available.':
    'No written review for this person leh. But the bukti below still got.',
  "No chat evidence yet for {pillars}. This work may happen outside these channels, so it's worth asking about.":
    'No chat bukti yet for {pillars}. Maybe happen outside these channel, so worth asking lah.',
  '{n} teammate reaction': '{n} kawan react',
  '{n} teammate reactions': '{n} kawan react',
  'Why: {reason}': 'Why ah: {reason}',
  'Open in #{channel} →': 'Go #{channel} tengok →',
  'Low impact': 'Small impact only',
  'Medium impact': 'Medium impact',
  'High impact': 'Power impact',
  'Technical leadership': 'Technical leadership',
  'Knowledge sharing': 'Share knowledge',
  'Industry intelligence': 'Industry kepoh',
  'Ownership & initiative': 'Ownership & inisiatif',

  // KPI dashboard
  'Your KPI insights': 'Your KPI insights',
  "This is your own report. Only you and your manager can see it; you cannot see anyone else's.":
    'This one your own report. Only you and your boss can see; other people\'s one you cannot see.',
  'Loading report…': 'Loading report, wait ah…',
  'No report for you yet': 'No report for you yet leh',
  "You see your own report here, and nobody else's. It appears once you have opted in ({kpi} in your account menu: click your name in the sidebar), posted in a channel marked {on}, and the agent has run. Manager accounts see everyone's.":
    'Here you see your own report only, other people\'s cannot. It will come out after you opt in ({kpi} in your account menu: click your name at the sidebar), post in channel got {on}, and the agent run already. Boss account can see everybody one.',
  'The KPI agent reads those channels, asks an AI model what each opted-in person visibly contributed, and writes the reports. With the relay running, run:':
    'The KPI agent read those channel, ask the AI what each person who opt in really contributed, then write the report. With the relay running, run this:',
  "It needs {gemini} and {secret} in {env}. The report appears here as soon as it's published.":
    'Need {gemini} and {secret} in {env}. Once publish, the report straight away come out here.',
  'Partial report.': 'Report half only.',
  "{n} conversations and the written reviews are still pending because the AI quota ran out. Run {cmd} again after it resets; finished conversations won't be sent again.":
    '{n} conversation and the written review still pending because AI quota finish already. Run {cmd} again after reset; the done one won\'t send again.',
  'AI-drafted evidence, for conversations, not rankings.': 'AI-drafted bukti, for chit-chat, not for ranking.',
  "Each item links to the messages it comes from. Check them before using any item in a review. Chat shows only part of anyone's work.":
    'Each item got link to the message it come from. Check first before use in review ah. Chat only show part of people\'s work.',
  '{n} conversations reviewed by {model} on {date}': '{n} conversation checked by {model} on {date}',
  '{n} skipped': '{n} skip',
  'Tip: type {cmd} in any channel to open a review': 'Tip: type {cmd} in any channel to open review lah',
  'Team evidence by pillar': 'Team bukti by pillar',
  'Team evidence by KPI item': 'Team bukti by KPI item',
  'KPI items by level': 'KPI item ikut level',
  'KPI item': 'KPI item',
  'KPI items': 'KPI item-item',
  Weight: 'Berat',
  Evidence: 'Bukti',
  '{n} person': '{n} orang',
  '{n} people': '{n} orang',
  '{n} pieces of evidence': '{n} bukti',
  '(by level, alphabetical)': '(ikut level, ikut ABC)',
  'No evidence for this KPI item yet.': 'No bukti for this KPI item yet leh.',
  'Sample report.': 'Sample report only.',
  'Built from simple keyword rules, not AI, so the dashboard can be shown without an API key. Do not use it for real reviews.':
    'This one make from simple keyword rule, not AI, so can demo without API key. Don\'t use for real review ah.',
  'Technical Delivery': 'Technical Delivery',
  People: 'Orang',
  '(alphabetical)': '(ikut ABC)',
  '{n} messages': '{n} message',
  'No evidence found in these channels yet': 'No bukti in these channel yet leh',
  '← All people': '← Semua orang',
  '{n} pieces of evidence from {m} messages': '{n} bukti from {m} message',
  '{n} high': '{n} power',
  '{n} medium': '{n} medium',
  '{n} low': '{n} small',
  'impact · in chat:': 'impact · in chat:',
  'All ({n})': 'Semua ({n})',
  'No evidence in this pillar yet.': 'No bukti in this pillar yet leh.',
  'Filter by pillar': 'Filter by pillar',
}

function lookup(lang: Lang, text: string) {
  return lang === 'manglish' ? (MANGLISH[text] ?? text) : text
}

/** Translates text and fills its {placeholders}. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const s = lookup(lang, text)
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Like translate, but placeholder values may be React elements. */
export function translateRich(lang: Lang, text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = lookup(lang, text).split(/\{(\w+)\}/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? createElement(Fragment, { key: i }, part in vars ? vars[part] : `{${part}}`) : part,
  )
}
