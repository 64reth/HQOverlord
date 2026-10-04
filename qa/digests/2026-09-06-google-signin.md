# Google account sign-in implementation receipt

`agent/google-account-signin` advanced `feat/harness-backend` by exact fast-forward
from `948557c62` to tested source `be47bd04e` on 2026-09-06. Existing uncommitted
integration-tree work in `qa/STATUS.md` and `docs/HANDOFF_ROOMS_2026-09-04.md` was
preserved. This separate receipt avoids editing the other session's active status file.

Customers now use **Sign in with Google** for Gmail, Drive, Calendar, Docs and Sheets.
The customer credential form and Google preview setup steps are removed. StarNet's
publisher-owned Desktop registration supplies the native PKCE flow; a local MCP
adapter exposes 23 tools over stable Google APIs. Missing publisher configuration
produces an unavailable state, never a request for customer developer credentials.
The public release workflow requires the registration; internal builds may omit it.

Verification:

- Full canonical fast manifest: **724/724 passed**, including the combined Abilities
  changes, Google tests, source inventory, and both corrected error-handling ratchets.
- Full canonical HTTP manifest: **101/101 passed**. The default 15-minute wrapper
  expired near the end of the first run; the complete manifest was rerun with a
  40-minute outer allowance, without skipping tests or changing timeouts in source.
- Google HTTP tests passed again after the final error-body cleanup and Abilities
  integration. Coverage includes all five services, PKCE, denied/partial consent,
  callback replay, cancellation during exchange, durable-save failure, restart,
  token refresh, revocation, removal and token redaction.
- Live seeded app at `127.0.0.1:8946`: Google cards showed **Sign in with Google**
  with zero client-ID/client-secret inputs. A synthetic provider completed Gmail
  authorization and exposed six tools. Restarting the sidecar with `--keep` and
  opening a fresh browser tab restored the account and six tools. After combining
  the newer Abilities interface, a fresh tab again showed the Google Docs sign-in
  button and zero developer credential inputs.
- The website app mirror and changed JavaScript syntax checks passed.

Logs remain in the isolated worktree under `dev/google-fast-integrated.log`,
`dev/google-http-complete.log` and `dev/google-signin-integrated.log`.

**Public activation remains unverified.** No StarNet Google Desktop registration
was supplied, no real Google account consent was completed, and no signed installer
was exercised. The owner report remains open. Publisher activation and Google review
are described in [GOOGLE_SIGN_IN.md](../../docs/GOOGLE_SIGN_IN.md); customers never
perform those steps. No release or deployment was made.
