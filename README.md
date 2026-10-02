# HQ

A local-first operating system for running multiple isolated, agent-powered businesses.

## Core law

HQ knows how to operate businesses.
HQ does not know what any particular business does.

Business-specific behaviour is supplied through applications, configuration, capabilities, workflows, knowledge and integrations.

Build 002 introduces the [core domain and event contracts](docs/build-002.md).
Run `npm run typecheck` and `npm test` to validate the workspace.

The first [operational Control Centre](docs/architecture/control-centre.md) adds business-scoped artifacts, dependent jobs, safe `web.read`, truthful SSE telemetry and a small operations room. Run `npm run build:web`, then `npm run control-centre`. Paid execution is disabled by default; customer contact and deployment remain manual.
