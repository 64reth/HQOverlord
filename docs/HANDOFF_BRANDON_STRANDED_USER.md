# HANDOFF — Brandon, the user who cannot get past onboarding (2026-08-23)

Written mid-investigation, interrupted deliberately. Everything below is either **VERIFIED** (I ran it)
or **UNPROVEN** (labelled). Do not repeat my mistake of treating a merged fix as a fixed user.

## 2026-09-02 release-preparation update

The two missing recovery affordances are now implemented on the v0.10.13 repair lane:

- the unreachable screen renders a stable screenshot-readable diagnosis: `SAVE-403 · STALE WINDOW SESSION`
  or `SAVE-NET · SAVE REQUEST LOST`, plus **COPY RECOVERY DETAILS** with a selectable fallback;
- genesis exposes **USE A DIFFERENT ACCOUNT**, which clears the desktop token and sidecar link before
  starting a new account-link flow.

These changes make the next screenshot actionable and remove the wrong-account dead end. They do **not**
prove Brandon's underlying account mapping or prove the flow on macOS. Do not tell him the issue is fixed
until the account backend evidence and a physical Mac run confirm it.

---

## The user

- **Brandon Grusin**, macOS **Tahoe 26.3**, on **v0.10.9** (downloaded after being told each time it was fixed).
- Has **$22 of credits** on his StarNet account. Confirmed by Andrew, not by us.
- Beginner. **Will not run Terminal commands, will not send log files.** Any fix must work without his help.
  He does send screenshots.
- He has been asked to update **three times** on the promise it was fixed. It was not. That is the whole
  problem with this thread — do not send him another build without a proven cause.

## What he has reported, in order

1. First run: overseer would not wake. He reset by hand → landed on **PRIOR STATION DATA FOUND** (dead end).
2. After my fixes shipped: **"model didn't answer"** → then **"catalog is offline"**.
3. On v0.10.9: **STATION DATA UNREACHABLE** on first launch. RESTART STATION SERVICE did nothing.
   RETRY NOW did nothing. Also noted: it auto-logs him in (green dot), and there is **no log-out button**.
4. Latest: WAKE now says **"your StarNet account has no credits yet"** — while he has **$22**.

---

## VERIFIED: the fixes ARE in 0.10.9

Tag `v0.10.9` = `d69931f46`, cut 2026-08-23 00:09, AFTER my merges. Every one of these is an ancestor:

| commit | what |
|---|---|
| `0c311e8c8` | workspace owner: reclaim a claim stamped before the current OS boot |
| `1e651a03e` | `starnet_restart_sidecar` + RESTART STATION SERVICE button + auto-restart |
| `166552a7e` | START FRESH exit on the PRIOR STATION DATA gate |
| `d338fe95c` | empty-wallet truth on the connect screen + billing refusal copy |
| `ac1188fe7` | same-session link adoption (token survives the keychain move) |

So **he is running the fixes and is still stuck.** They did not address his cause.

## VERIFIED: my UNREACHABLE fix was aimed at the wrong thing

The STATION DATA UNREACHABLE screen is **StarNet's own HTML, served by the sidecar**. If the sidecar were
dead, that page could not render at all. Therefore on his machine **the engine is up and serving**; what
fails is the page's `/api/save` call. My restart button restarts something that was never down — which is
exactly why it changed nothing for him. That fix is not wrong, it is *irrelevant to this user*.

The screen's own subtitle splits the two remaining causes, and **nobody has read it yet**:
- `"station service refused this window (stale session)"` → 401/403, page/engine disagree on the per-launch
  token (`X-StarNet-Token`; page is `tauri://localhost`, token injected by `main.rs:3624`, header attached by
  `frontend/app/harness.js:~218`).
- `"station service not answering"` → the fetch threw; engine died after serving the page.

**Ask him for one screenshot and read that grey line.** Zero effort for him. Do this first.

---

## THE LIVE LEAD (where I was when stopped) — the $22 vs "no credits" contradiction

This is the most valuable thread. Read it carefully.

The message he now sees is **my code from yesterday** (`frontend/app/app.js`, `starnetOutOfCredit()`).
It fires **only** when the sidecar reports a **finite number ≤ 0**. Critically:

`sidecar/credits.js` `refresh()` — VERIFIED at the shipped tag — sets balance to **`null`, never 0**, whenever
the balance call fails or returns malformed data. And `null` does **not** trip my gate. Its own comment says:

> "This was the 0.10.8 escape: a station revoked on the account site kept its cached $0, so the app asserted
> both 'LINKED' and 'no credits' while the real account held **$22** and listed no linked stations."

**That comment is describing this exact user.** There is already a hotfix for that scenario on trunk
(`977294cbc` fix(credits): recover revoked station links truthfully, `ad5a55f1a` relock).

So, given the balance can only be `null` (silent) or a real number, and he IS seeing the refusal:

> **The cloud is authoritatively answering `balanceUsd: 0` for the account his station token belongs to.**

Which means the app is telling the truth about a **different account than the one holding his $22**. The
likely causes, in order:

1. **His device token is linked to a different account than the one he bought credits on** — e.g. he signed in
   with a different method/email on account.starnetos.com than the one the station paired to. This alone
   explains "worked for everybody else except this guy."
2. **His station link was revoked/replaced** on the account site (the 0.10.8 scenario), and the recovery path
   in `977294cbc` is not covering his case.
3. The balance is scoped to an `accountId` the sidecar is sending as empty/stale (`resolveCreditsConfig()` →
   `accountId` comes from `credits.json`; the shell strips only `deviceToken`).

### The one check that settles it — and it is on OUR side, not his

**Look up, on the account backend, which account ID his device token resolves to, and what balance that
account holds.** If that account shows $0 while his web login shows $22, the diagnosis is confirmed and
this was never a client bug at all. Andrew can do this without Brandon touching anything.

Second-best, still no Terminal for him: have him open **account.starnetos.com** in a browser and check
(a) the balance shown there, and (b) whether a **linked station/device is listed at all**. If no station is
listed but the app says LINKED, it is cause #2.

---

## Unfinished / owed

- **Never proved live on a Mac.** The whole desktop path (restart command, boot reclaim) was proved by
  `cargo check` and Windows-side CDP only. Flagged as owed at merge; it is still owed.
- ~~No log-out / unlink button on the connect screen.~~ Implemented as **USE A DIFFERENT ACCOUNT** on the
  v0.10.13 repair lane; still owes physical Mac proof.
- The old subtitle line was never captured from Brandon. The new stable support code makes the next screenshot
  sufficient to classify the save failure without Terminal or logs.

## Rules for whoever picks this up

1. **Do not ship him another build until you can name his cause with evidence.** He has burned three updates.
2. He does nothing but send screenshots. Design every diagnostic around that.
3. "Merged, gates green" is not "fixed for the user." I made that mistake in this session and it cost
   Andrew three round trips with a customer.
