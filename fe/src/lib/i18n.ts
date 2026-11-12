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

  // Composer
  'Tab to complete · Enter to run': 'Tab to complete · Enter to jalan',
  'Run command': 'Jalan command',
  Send: 'Hantar',

  // Messages and threads
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
  'Evidence ({n})': 'Evidence ({n})',
  'Open full profile in KPI insights →': 'Tengok full profile in KPI insights →',
  'No evidence found for {name} in {channels} for this period. Their work may happen in other channels or tools, so ask about it directly.':
    'No evidence for {name} in {channels} this period leh. Maybe their work happen in other channel or tool, so ask them direct lah.',
  Highlights: 'Yang best',
  'No written review was generated for this person. The evidence below is still available.':
    'No written review for this bos leh. But the evidence below still got.',
  "No chat evidence yet for {pillars}. This work may happen outside these channels, so it's worth asking about.":
    'No chat evidence yet for {pillars}. Maybe happen outside these channel, so worth asking lah.',
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
    "This one your own report. Only you and your manager can see, other people's one you cannot see.",
  'Loading report…': 'Loading report, jap ah…',
  'No report for you yet': 'No report for you yet leh',
  "You see your own report here, and nobody else's. It appears once you have opted in ({kpi} in your account menu: click your name in the sidebar), posted in a channel marked {on}, and the agent has run. Manager accounts see everyone's.":
    "Here you see your own report only, other people's cannot. It will come out after you opt in ({kpi} in your account menu: click your name at the sidebar), post in channel got {on}, and the agent run already. Manager account can see everybody one.",
  'The KPI agent reads those channels, asks an AI model what each opted-in person visibly contributed, and writes the reports. With the relay running, run:':
    'The KPI agent read those channel, ask the AI what each person who opt in really contributed, then write the report. With the relay running, run this:',
  "It needs {gemini} and {secret} in {env}. The report appears here as soon as it's published.":
    'Need {gemini} and {secret} in {env}. Once publish, the report straight away come out here.',
  'Partial report.': 'Report half-half only.',
  "{n} conversations and the written reviews are still pending because the AI quota ran out. Run {cmd} again after it resets; finished conversations won't be sent again.":
    "{n} conversation and the written review still pending because AI quota habis already. Run {cmd} again after it reset, the done one won't send again one.",
  "Each item links to the messages it comes from. Check them before using any item in a review. Chat shows only part of anyone's work.":
    'Each item got link to the message it come from. Check first before you use in review ah. Chat only show part of their work one.',
  'Team evidence by pillar': 'Team bukti by pillar',
  'Team evidence by KPI item': 'Team bukti by KPI item',
  'KPI item': 'KPI item',
  'KPI items': 'KPI item',
  Weight: 'Weight',
  Evidence: 'Evidence',
  '{n} person': '{n} orang',
  '{n} pieces of evidence': '{n} evidence',
  'No evidence for this KPI item yet.': 'No evidence for this KPI item yet leh.',
  'Technical Delivery': 'Technical Delivery',
  People: 'Bos',
  '(alphabetical)': '(ikut ABC)',
  'No evidence found in these channels yet': 'No evidence in these channel yet leh',
  '← All people': '← Semua bos',
  'No evidence in this pillar yet.': 'No bukti in this pillar yet leh.',
  'Filter by pillar': 'Filter by pillar',

  // Confirm cards (ConfirmDialog)
  'Turn on KPI insights?': 'Want to on KPI insights ah?',
  'An AI agent looks for your positive contributions in work channels, so they are easy to bring up in your 1-on-1s.':
    'An AI agent will find your good contributions in work channel, so senang to bring up in your 1-on-1.',
  'Reads only channels marked "KPI insights on"': 'Only read channel marked "KPI insights on"',
  'Notes what you did well. No scores, no rankings, no mistakes': 'Only note what you do well. No score, no ranking, no salah',
  'Only you and managers can see your report': 'Only you and the boss can see your report',
  'You can turn it off at any time': 'Can off anytime one',
  'Not now': 'Later lah',
  'Turn off KPI insights?': 'Want to off KPI insights ah?',
  'The agent stops reading your messages from now on': 'From now on the agent stop reading your message',
  'Your report is removed the next time the agent runs': 'Next time the agent run, your report kena remove',
  'You can turn it back on at any time': 'Can on back anytime one',
  'Keep it on': 'Keep it on lah',

  'Include #{name} in KPI insights?': 'Put #{name} into KPI insights ah?',
  'The agent reads messages here only from people who opted in': 'The agent only read message here from people who opt in',
  'Everyone in the channel sees a "KPI insights on" badge': 'Everybody in the channel can see the "KPI insights on" badge',
  'The agent stops reading this channel from its next run': 'Next run onwards, the agent stop reading this channel',
  'Delete #{name}?': 'Buang #{name} ah?',
  'Every message in it is deleted for everyone. This cannot be undone.': 'All the message inside also kena delete for everybody. Cannot undo one ok.',
  'Delete this message?': 'Confirm want to delete ah?',
  'This cannot be undone.': 'Cannot undo one ok.',

  // Performance reviews (Reviews.tsx)
  'Suggested reviews': 'Should review soon',
  'People with no recent review, or no chat evidence this period. A prompt to check in, not a judgement.': 'Bos who long time never review, or no chat evidence this period. Just a reminder to check in, not to judge ah.',
  'Everyone has a recent or upcoming review.': 'Everybody got recent or upcoming review already. Steady lah!',
  'No review on record': 'Never review before',
  'Last review {n} months ago': 'Last review {n} month ago already',
  'No chat evidence this period': 'No chat evidence this period leh',
  'Book review': 'Book review',
  'View profile': 'Tengok profile',
  'Show fewer': 'Show less',
  'Show all {n}': 'Show all {n}',
  'Your performance review': 'Your performance review',
  'with {name}': 'with {name}',
  'Performance review booked': 'Performance review booked already',
  Reschedule: 'Tukar time',
  'Cancel review': 'Cancel review',
  'No performance review booked': 'No performance review booked yet',
  'Last review: {date}': 'Last review: {date}',
  'Book performance review': 'Book performance review',
  'Pick a time in the future.': 'Pick a time later lah, cannot go back in time one.',
  'Reschedule the review': 'Tukar review time',
  'Book a performance review': 'Book a performance review',
  'With {name}. They and managers can see this booking.': 'With {name}. Only they and manager can see this booking.',
  Date: 'Tarikh',
  Time: 'Masa',
  Length: 'How long',
  '{n} minutes': '{n} minit',
  'Note for {name} (optional)': 'Note for {name} (if got)',
  'Agenda, or anything to prepare': 'Agenda, or anything to prepare ah',
  'Save changes': 'Save',
  'Cancel the review with {name}?': 'Confirm cancel the review with {name} ah?',
  '{when}. It is removed for {name} and for managers.': '{when}. Will remove for {name} and manager also.',
  'Keep it': 'Keep lah',
  'Review booked: {date}': 'Review booked: {date}',

  // Landing page
  'Main': 'Main',
  'Features': 'Features',
  'Privacy': 'Privacy',
  'Try now': 'Try now lah',
  'See how it works': 'Tengok how it work',
  'The team dashboard: evidence per KPI item as clay hills, and the team in numbers': 'The team dashboard: evidence for each KPI item as clay bukit, and the team in numbers',
  'Chat': 'Chat',
  "A channel, with a person's KPI review open beside the conversation": "A channel, with a bos's KPI review open beside the conversation",
  "Type {cmd} in any channel and that person's review opens beside the conversation, visible only to you.": "Type {cmd} in any channel, that bos's review straight away open beside the conversation, only you can see one.",
  "A person's page: summary, KPI items with weights, and evidence over time": "A bos's page: summary, KPI item with weight, and evidence over time",
  'Know who to review next': 'Know who to review next',
  'Booking a performance review from the suggested reviews': 'Booking a performance review from the suggestion',
  'Book, reschedule or cancel a review in a few clicks. The person sees it on their own page.': 'Book, tukar time or cancel a review in a few click. The bos can see it on their own page.',
  'Each person gets a summary, highlights and things to talk about. Never a score.': 'Each bos get a summary, the best bits and things to talk about. Never got score one.',
  'Tour': 'Tour',
  'Good work {mascot} gets {noticed}': 'Good work {mascot} sure kena {noticed}',
  noticed: 'notice one',
  'Your team talks in channels. Stooges spots the good work and keeps it as evidence for reviews.':
    'Your team chat in channel. Stooges spot the good work and keep it as evidence for review.',
  'Small, quick, and ships it.': 'Small only, but fast. Ship already.',
  'Stays cool when things break.': 'Stay cool even when things rosak.',
  'Says it, then does it.': 'Say already, sure do one.',
  'Pulls the team together.': 'Tarik the whole team together.',
  'Also counted:': 'Also count:',
  'Every kind of work counts': 'Every kind of work also count one',
  "Shipping a feature, unblocking a teammate, flagging a risk early. The KPI agent files each one under your framework's KPI items, with a link back to the message.":
    "Ship a feature, unblock your kawan, flag a risk early. The KPI agent put each one under your framework's KPI item, with link back to the message.",
  'Managers walk into reviews with real examples. People see the same evidence about themselves.':
    'Manager go into review with real example. The bos also can see the same evidence about themselves.',
  'Everything a manager needs': 'Everything manager need, all here',
  'Evidence for every KPI item, a nudge when a review is due, and the person in the loop the whole way.':
    'Evidence for every KPI item, a reminder when review is due, and the bos know what is going on from start to end.',
  'The team at a glance': 'The whole team, one look only',
  "One clay hill per KPI item, as tall as the team's evidence for it.": 'One clay bukit for each KPI item. More evidence, more tinggi.',
  'Opt in, opt out, any time': 'Opt in, opt out, anytime also can',
  'Nobody is read until they switch KPI insights on themselves.': 'Nobody kena read until they on KPI insights themselves.',
  'KPI insights off': 'KPI insights off',
  'Every finding cites a message': 'Every finding got message to back it up',
  'Each finding must quote something the person wrote, or it is dropped.': 'Each finding must quote something the bos wrote. If not, buang.',
  'A nudge when a review is overdue or there is no chat evidence yet. Never a ranking.':
    'A reminder when review overdue already or no chat evidence yet. Never got ranking one.',
  'Booked, and they see it too': 'Booked already, and they also can see',
  "The review shows up on the person's own page, with your note.": "The review appear on the bos's own page, with your note.",
  'Take a look around': 'Come, tengok around',
  'Screens': 'Screen',
  'Dashboard': 'Dashboard',
  'Person': 'Bos',
  'Booking': 'Booking',
  "The whole team on one page: evidence per KPI item, who to review next, and each person's page a click away.":
    "The whole team in one page: evidence for each KPI item, who to review next, and each bos's page one click only.",
  'Try it yourself': 'Try yourself lah',
  'Filed under {item}': 'Masuk under {item}',
  'KPI agent is reading #project-orbit…': 'KPI agent tengah read #project-orbit…',
  'Built for trust': 'Can trust one',
  'Opt-in only': 'Opt in only',
  'Nobody is read until they turn KPI insights on themselves, and they can turn it off at any time.': 'Nobody kena read until they on KPI insights themselves, and can off anytime.',
  'Work channels only': 'Work channel only',
  'The agent reads only channels marked for KPI insights. Everything else is never read.': 'The agent only read channel marked for KPI insights. Other channel never read one.',
  'No scores, no rankings': 'No score, no ranking',
  'Evidence to talk about, never a score or a leaderboard. No weaknesses are written.': 'Evidence for chit-chat, never a score or leaderboard. No weakness written one.',
  'Private reports': 'Private report',
  'Each person sees their own report. Only managers see the team.': 'Each bos see their own report only. Only manager can see the whole team.',
  'Try it with your team': 'Try with your team lah',
  'Create an account in a few seconds, or log in if you have one.': 'Create account in a few second, or log in if you got one already.',

  // Team dashboard
  'The KPI agent reads only these channels, and only messages from people who opted in.': 'The KPI agent only read these channel, and only message from bos who opt in.',
  'In this report': 'Got in this report',
  'From the next run': 'Next run onwards',
  'Turned off since this report': 'Off already since this report',
  'No channel is marked for KPI insights.': 'No channel turn on KPI insights yet leh.',
  "A channel's creator turns KPI insights on or off from the channel header.": 'Only the channel creator can on or off KPI insights, at the channel header.',
  Settings: 'Setting',
  'updated {date}': 'last update {date}',
  'Discussion points': 'Things to talk about',
  Close: 'Tutup',
  'Team insights': 'Team punya insights',
  'Back to chat': 'Balik chat',
  'How the framework works': 'How this framework work',
  Level: 'Level',
  'Team evidence per KPI item, left to right. A taller hill means more evidence was found in chat.':
    'Team evidence for each KPI item, left to right. Bukit more tinggi, more evidence found in chat lah.',
  'Conversations reviewed': 'Conversation checked',
  'Pieces of evidence': 'Evidence found',
  'Work channels': 'Work channel',
  'Report in numbers': 'Report in numbers',
  'Grouped by level, alphabetical. Open anyone for their evidence and review notes.':
    'Ikut level, ikut ABC. Click any bos to tengok their evidence and review notes.',
  'Search people': 'Cari bos',
  'All levels': 'Semua level',
  'No one matches "{q}".': 'Takde bos called "{q}" leh.',
  'No written review yet. The evidence is ready.': 'No written review yet, but the evidence ready already.',
  'latest {date}': 'latest {date}',
  "Each level has its own weighted KPI items. Every piece of evidence is filed under one item of the person's own level. Weights show what matters most; they are never added up into a score.":
    "Each level got its own KPI item with weight. Every evidence go under one item of that bos's own level. Weight show what more important lah, but never add up into a score one.",
  'What counts as evidence': 'What count as evidence',
  'Visible only to {name} and managers.': 'Only {name} and manager can see one.',
  'Messages in work channels': 'Message in work channel',
  'Latest evidence': 'Latest evidence',
  'AI-drafted summary': 'AI-drafted summary',
  'Worth asking about': 'Better ask about this',
  'No chat evidence yet for these items. This work may happen outside these channels, so ask about it.':
    'No chat evidence yet for these item. Maybe the work happen outside these channel, so better ask lah.',
  'Evidence over time': 'Evidence over time',
  'Per week. Colours match the KPI items.': 'Per week. Colour same as the KPI item.',
  'Week of {date}': 'Week of {date}',
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
