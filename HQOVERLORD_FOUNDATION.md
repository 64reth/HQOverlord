# StarNet foundation

This branch starts from the working source in `C:\Projects\starnet` at `fbddbf992f8e7082196f07c3024781fcf1c276fc`, including its existing working-tree lockfile change. StarNet's application and licence notices are preserved. No archived HQ runtime code or data is migrated.

The previous HQOverlord main is preserved at tag `hq-runtime-v1` (`3067076a2e20b5c46586fff3caa1a5454eaa8258`).

Launch with Node.js and the package dependencies installed:

```powershell
Set-Location C:\Projects\HQOverlord
npm.cmd start
```

Open `http://127.0.0.1:8789`. This runs the real sidecar and Station together, not the UI-only server. The launcher defaults to `.local/starnet-foundation/workspaces` and uses StarNet's existing scratch-root guard to prevent automatic imports of another Station. An explicitly supplied `STARNET_WORKSPACES` overrides that location; `STARNET_PORT` overrides the port.
