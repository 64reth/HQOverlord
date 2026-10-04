# StarNet Google activation — prepared 2026-09-06

## Update — owner-approved activation, 20:11 UTC

The owner approved the prepared Google action and packaging a 0.11.0 installer for testing before public release. **StarNet Desktop** (Desktop app) was created in `starnet-505202`; the first attempt failed without saving a client, and the verified retry succeeded. The existing Web client was preserved.

The downloaded native registration passed `scripts/stage-google-client.mjs`, was stored as `STARNET_GOOGLE_DESKTOP_CLIENT_JSON` in `androoAGI/starnet` (secret metadata confirmed at 20:02:13 UTC), and is included in the local test package. Registration bytes were not committed or printed. The bundled staging copy matches the validated registration.

All five exact Workspace APIs below were enabled, each confirmed by Google's Enabled state. The 11 unique implemented scopes (including OpenID and email) were saved in Data Access with factual usage explanations. Google's console confirmed **Data access changes saved!** No verification was submitted and no approval was claimed. Branding links, the final privacy/data-flow review, the required demonstration, and real-account lifecycle acceptance remain outstanding. This is no longer waiting for owner permission to create the client.

The sections below preserve the original pre-approval findings and preparation plan; their statements that configuration is absent are historical.

This is a preparation record, not an approval or a claim that public Google Workspace
sign-in is working. The existing project was inspected through the signed-in Cloud
Console. No Google configuration or credentials were created or changed.

## Confirmed existing setup

- Project: **StarNet**, `starnet-505202`.
- One existing OAuth client: **StarNet Account**, type **Web application**.
- Audience: **External**, publishing status **In production**.
- Data Access: all three declared-scope lists are empty.
- Verification Center: no sensitive/restricted-scope verification required for the
  presently empty declaration; this does not approve the new Workspace scopes.
- Branding: app name StarNet, authorized domain `starnetos.com`; home page, privacy
  policy and terms links are empty. Branding is not verified/shown to users.
- Enabled services: all 22 rows inspected. Gmail, Drive, Calendar, Docs and Sheets
  APIs are absent.
- GitHub release secret `STARNET_GOOGLE_DESKTOP_CLIENT_JSON`: absent.

## Concrete prepared action

The browser form at
https://console.cloud.google.com/auth/clients/create?project=starnet-505202
has **Application type: Desktop app**, **Name: StarNet Desktop**. Create has not been
clicked. Explicit approval was requested to create this client and store its native
registration in `androoAGI/starnet` as `STARNET_GOOGLE_DESKTOP_CLIENT_JSON`.

Preserve the existing Web client and its secret. The release staging script rejects
Web registrations; a Desktop/native client is the architecture the merged code uses.
Creating this client alone will not complete public Workspace activation.

## Remaining activation work

1. Create the approved Desktop client; download its installed JSON and configure the
   exact named release secret. Run `scripts/stage-google-client.mjs` to validate it.
   Never commit the generated registration or put it in a transcript.
2. Enable `gmail.googleapis.com`, `drive.googleapis.com`, `calendar-json.googleapis.com`,
   `docs.googleapis.com`, and `sheets.googleapis.com` in this project, verifying each
   exact service in Google's library before activation.
3. Complete branding links. Public pages currently resolve at:
   - https://starnetos.com/
   - https://starnetos.com/legal/privacy
   - https://starnetos.com/legal/terms
4. Review the privacy disclosure against the new integration before using it for
   verification. The existing policy enumerates outbound cases but does not describe
   Google Workspace API access. In particular, document which Google content may enter
   agent transcripts, model-provider requests and the optional credits relay. Do not
   assume desktop execution means data never reaches another server.
5. Declare the exact scopes below and complete Google's applicable verification.
   Prepare a real consent-and-feature demonstration, including the actual data flow.
   Do not attest to approval, a security assessment, or Limited Use compliance without
   establishing it for the selected provider and relay behavior.
6. Exercise real-account sign-in, denial, read/create/edit where supported, refresh,
   disconnect/revocation and restart on the signed Windows and Mac installers.

## Requested scopes from the frozen candidate

Source: `sidecar/mcp/catalog.js` at `979099385` (each service is authorized separately).

| Service | Additional scopes, under `https://www.googleapis.com/auth/` |
| --- | --- |
| Every service | `userinfo.email`, plus `openid` |
| Gmail | `gmail.readonly`, `gmail.compose` |
| Drive | `drive.readonly`, `drive.file` |
| Calendar | `calendar.calendarlist.readonly`, `calendar.events.readonly`, `calendar.events.freebusy` |
| Docs | `documents`, `drive.file`, `drive.readonly` |
| Sheets | `spreadsheets`, `drive.file`, `drive.readonly` |

## Draft privacy addition for review (not published)

**Google Workspace — only when you connect an account.** If you authorize a Google
service, StarNet's local connector calls that service's API using the permissions you
approve. Gmail tools can search and read messages and attachments, create drafts, and
send approved drafts. Calendar tools read calendars, events and availability. Drive
tools search/read/export files and manage permitted file metadata; Docs and Sheets
tools can read, create and edit documents or spreadsheets. Each service is connected
independently.

**Data used in agent work.** Google content returned by a tool can become part of the
agent's conversation and requests to your selected model provider. On the StarNet
Credits path those model requests pass through the credits gateway. Local transcript,
artifact and memory retention and deletion behavior must be explained alongside the
connector's account-token handling. Disconnecting an account must not be described
as deleting already-created transcripts or artifacts unless that behavior is verified.

Before adopting this text, finish the token-storage/disconnect and downstream-retention
review and add the applicable data-use commitments that the owner can substantiate.
This draft intentionally does not invent a blanket compliance or no-training promise.

## Sources checked

- [Existing public privacy policy](https://starnetos.com/legal/privacy)
- [Existing public terms](https://starnetos.com/legal/terms)
- [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

Google's verification guidance calls for accurate scope declarations and privacy
disclosures about access, use, storage and sharing. Restricted data passing through
third-party servers can require additional security assessment. These requirements
must be assessed against StarNet's actual model-provider and credits-relay paths.
