# SWEEP · channels — Telegram, Discord, COMMS, ACP, outbound messaging

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `channels`.
**Rank 3 of 10** — this is where real members meet the product from a phone, with no floor, no
browser and no way to tell a refusal from an absence.

## What you own

`sidecar/channels/` (`hub.js` especially) · `sidecar/acp/` · `respond.js` · `autonotify.js` ·
`frontend/app/channels.js` · `chat.js` · `comms` surfaces

## The failure states to walk

1. **A phone has no floor.** A browser appends the agent's placed props via `extraObjects`; a
   channel never does. Every code path that composes an office must be walked from a channel
   ingress, not from the browser. This is exactly how `/approvals on` cut a chat from 59 tools
   to 4 — the run had no floor to read props off, and nothing said so.
2. **Assert on the WIRE, never on a readout.** A readout is what lied last time. Capture the
   tool list / prompt / payload that reaches the PROVIDER and assert on that.
   **Trap: the wire spells a dotted tool with an underscore** (`fs.read` → `fs_read`) — a
   registry-spelled assertion passes vacuously forever.
3. **Every slash command, from every channel.** Commands are declared in TWO places
   (`slash.js` and `chat.js`) and can drift. Walk each command from Telegram AND from the
   browser and compare. Then walk them with arguments, with no arguments, and with garbage.
4. **Outbound is KNOWN-TARGETS-ONLY.** Free-form outbound addressing is an injection→exfil path.
   Prove `channel.send` and every sibling refuse an arbitrary target, and that the refusal is
   the whole call — not a truncation. A silently clipped payload delivered as success is a
   shipped bug class here (8,000-char ceiling, five partial messages, reported OK).
5. **Multi-bot and multi-chat.** Two bots, two chats, one station. Does a reply reach the chat
   that asked? Run two concurrent chats and check for crossed identity, crossed transcripts,
   crossed approval prompts.
6. **Interruption from a phone.** Start a long run from a channel, then: halt it, send a second
   message mid-run, restart the sidecar mid-run. Is the end state honest in the chat AND in the
   station, or does one of them keep a forever-RUNNING claim?
7. **Inline keyboards and stale callbacks.** Press an approval button twice. Press one from a
   message whose run has already ended. Press one after a sidecar restart. Each must fail
   honestly, never silently approve.
8. **Attachments both directions.** Send an image, a huge file, a zero-byte file, and a file
   with a unicode name. A deliverable must be `kind:'file'` or `'image'` — the honest-sounding
   `kind:'audio'` renders nothing at all.

## Done means

Every finding proven at the ingress or the wire against a booted sidecar with a real transport
mock, and each one filed with the exact message sequence that reproduces it.
