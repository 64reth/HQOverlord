# Using StarNet from your editor (ACP)

StarNet speaks **ACP** — the [Agent Client Protocol](https://agentclientprotocol.com), the same protocol Zed
uses to talk to external coding agents. Point an ACP-capable editor at StarNet and you drive your *real*
station agents from inside your codebase: the same tools, the same consent gates, the same spend caps, and the
same station floor lighting up while it works.

This is the third way into StarNet, alongside the station window and the messaging channels:

| Surface | What it is | Where |
|---|---|---|
| Station window | the game/UI | `npm start` → http://127.0.0.1:8787 |
| Messaging channels | Telegram / Discord / Slack / Matrix / Signal | CHANNELS panel |
| **ACP (this doc)** | **your editor** | `npm run acp:serve` |
| MCP bridge | observe/message a station from another agent | `npm run mcp:serve` — see below |
| OpenAI-compatible API | another harness drives StarNet over HTTP | [`OPENAI_COMPAT.md`](OPENAI_COMPAT.md) |

## Setup

**StarNet must already be running** (`npm start`). The bridge is a thin client: it does not host agents, it
drives the station you already have. One sidecar owns a workspace — the bridge never touches your stores
directly, it calls the running station over loopback.

Register the agent with your editor. In Zed, `settings.json`:

```json
{
  "agent_servers": {
    "StarNet": {
      "command": "npm",
      "args": ["run", "-s", "acp:serve"],
      "env": {}
    }
  }
}
```

`command`/`args` are whatever runs `sidecar/acp/serve.js` from the repo. If your editor spawns it from a
different working directory, use an absolute path instead:

```json
{ "command": "node", "args": ["C:/path/to/starnet/sidecar/acp/serve.js"] }
```

Then open the agent panel in your editor and pick **StarNet**.

### If your station is not on the default port

The bridge assumes `127.0.0.1:8787`. Override with flags or env:

```bash
node sidecar/acp/serve.js --port=8788 --host=127.0.0.1
```

| Flag | Env | Default |
|---|---|---|
| `--port=` | `STARNET_PORT` | `8787` |
| `--host=` | `STARNET_HOST` | `127.0.0.1` |
| `--token=` | `STARNET_TOKEN` / `STARNET_API_TOKEN` | discovered automatically |

You normally do **not** set a token. The station mints a fresh API token per launch and injects it into the
page it serves; the bridge reads it the same way the browser does. Set one explicitly only if you run the
station with a fixed `STARNET_API_TOKEN`.

## What you get in the editor

- **Streaming answers.** The reply arrives as it is generated.
- **A live tool list.** Every tool call shows up as it happens, with a human title (`Read sidecar/loop.js`,
  `Run npm test`) and a **file location**, so your editor can jump to what the agent is looking at. Calls are
  typed — read / edit / search / execute / fetch — so an `execute` is easy to spot in a long list.
- **Native approval cards.** When the station's consent gate fires, your editor asks you: *Allow once*,
  *Allow for the rest of this session*, or *Reject*. This is the real gate — rejecting it means the write does
  not happen. Nothing is pre-approved for the editor that would not be pre-approved in the station.
- **Cancel.** Stopping the turn in your editor really aborts the run (it does not keep spending in the
  background).
- **A visible station.** An ACP run is a normal StarNet run: the floor animates, the transcript lands, spend
  is metered against your caps, and the run appears in the station's own history.

### Capabilities an editor session has

A session is granted the coding office: files, shell + verify, web/browser, and memory. The session's working
directory rides along as the project scope, so the first file tool asks you to trust that folder — the same
folder-trust prompt the station uses, surfaced as an approval card.

## Known limits (v1)

These are real gaps, listed so you are not surprised by them:

- **OpenRouter only, for now.** The bridge asks the station which model to run headless, and that resolution is
  the same one the station's other headless host uses: provider `openrouter` plus `STARNET_DEFAULT_MODEL`. If
  your station is set up on Codex/Grok/Kimi only, the bridge reports *"StarNet has no runnable model
  configured"* rather than guessing — set an OpenRouter key and a default model to use ACP today.
- **No image attachments.** The bridge does not advertise the ACP image capability, so a well-behaved editor
  will not offer to attach one. If a client sends one anyway, the turn tells the model that N images were
  attached and could not be delivered, rather than silently answering about text it never saw.
- **A very large prompt is truncated at 200k characters**, and the turn says so — it does not quietly drop the
  second half.
- **No thought stream.** StarNet's event contract reports *that* a model is reasoning, not the reasoning text
  (deliberately — a thinking delta must never be emitted as normal output). So there is nothing to show in an
  editor's "thinking" pane, and the bridge advertises none.
- **No diff previews on edits.** An edit is reported with the tool's own result summary rather than a
  before/after diff, because the run stream carries a summary, not the old and new text.
- **The agent reads from disk, not from your unsaved buffers.** ACP lets a client offer its own filesystem so
  an agent can see unsaved edits; the bridge does not use it, so save before you ask about a file.
- **No slash-command menu.** Type what you want in prose; the station's own slash commands are not published
  to the editor's `/` menu yet.
- **Sessions live in the bridge process.** If your editor reconnects to a session id from a previous bridge
  process, the bridge says so plainly instead of handing you a session with a silently empty history — start a
  new one.
- **One turn at a time per session.** A second prompt while one is in flight is refused rather than racing two
  runs against one transcript.

## Troubleshooting

Everything the bridge logs goes to **stderr** (stdout is the protocol stream — a single stray byte there would
corrupt it). Check your editor's agent log.

| What you see | What it means |
|---|---|
| `StarNet is not running (or its API token could not be read)` | the station is not up on that host/port, or the port is wrong |
| `StarNet has no runnable model configured` | set an **OpenRouter** key and a default model (see the limits above) |
| `StarNet rejected this bridge's API token` | the station restarted and minted a new token — restart the agent in your editor so it re-reads it |
| `(stopped: this run hit a spend cap …)` | MISSION CONTROL → BUDGET |
| `(stopped: reached the step limit for one turn …)` | send `continue` |

## ACP vs the MCP bridge

Both are stdio JSON-RPC bridges to a running station, and they do different jobs:

- **ACP (`acp:serve`)** — *your editor drives a StarNet agent.* Full agent runs with tools, streaming, and
  approval cards.
- **MCP (`mcp:serve`)** — *another agent observes and messages a station.* It reads run history, transcripts,
  channels, and live events, and can answer permission prompts. It deliberately runs **no** agent turns.

Use ACP to work. Use MCP to watch.

## Implementation notes

- `sidecar/acp/core.js` — the pure protocol core: JSON-RPC dispatch, session lifecycle, the StarNet-event →
  `session/update` mapping, tool classification, the permission round-trip, stop-reason mapping. No I/O.
- `sidecar/acp/serve.js` — the ambient edge: stdio framing, token discovery, and streaming `POST /api/run`.
- `GET /api/runtime/agent` — the small read the bridge uses to learn which provider/model the station would
  run headless (`/api/run` requires an explicit model; a local client never sees the page state that has it).
- Tests: `test/acp-core.test.js` (protocol decisions, against fakes) and `test/acp.e2e.test.js` (a real
  sidecar, the real bridge process, driven over real stdio as a client — including that an approved card
  really writes the file and a rejected one really does not).

It rides `/api/run` rather than the OpenAI-compatible `/v1` surface for one reason: an editor integration lives
on the live tool list and the mid-run approval card, and those are *events*. `/api/run` streams them, and it is
already fenced by the per-launch token the bridge holds — so ACP adds no new authentication surface.
