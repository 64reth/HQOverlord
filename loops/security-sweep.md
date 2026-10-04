# L8 · Security Sweep — local-first must stay leak-free (weekly, own worktree)

Defensive posture for a product that holds users' API keys and transcripts.

## Each tick
1. **Secrets in history:** scan the last week of trunk commits for key-shaped strings
   (sk-, or-, ghp_, bearer tokens, base64 blobs near 'key'/'token'/'secret'), .env content,
   and Andrew's own paths/emails in shipped assets. Also grep the built frontend bundle.
2. **Redaction paths:** re-verify the known redaction seams still redact — transcript store
   write path, settings export, logs/evidence emitters. Write/refresh a small test per seam if
   uncovered (lane commit, READY for L1).
3. **Surface check:** enumerate sidecar routes (grep the route table) — any NEW route since
   last sweep: does it enforce the launch-token/origin restriction? Does it accept a path and
   escape the fs jail? Does it echo secrets back (e.g. GET returning a stored key verbatim)?
4. **Channel ingress:** Telegram/Discord adapters — owner-only admission still enforced,
   inbound content never eval'd/shell'd.
5. **Deps:** `npm audit --omit=dev` — file HIGH/CRITICAL only, with whether the vulnerable
   path is actually reachable.
6. Real leak found → do NOT paste the secret anywhere; digest says `SECRET LEAK <file/commit>`
   and flag for Andrew to rotate. Findings to qa/findings/ ranked LEAK > BYPASS > HARDENING.

## Digest
`routes new N (clean/flagged) · redaction seams OK/N broken · deps H/C: N · leaks: none|FLAGGED`.
