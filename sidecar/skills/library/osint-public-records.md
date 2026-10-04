---
name: OSINT Public Records
slug: osint-public-records
description: Cross-reference public records — corporate filings, contracts, lobbying, sanctions, courts, archives — into an evidence chain with explicit confidence.
category: Research
requires: [dish]
license: MIT
default: false
---

An investigative framework for public-records OSINT: resolve an entity across many public sources, build cross-links with explicit confidence, and produce a structured evidence chain. Everything here is public data fetched over the web.

Use for "follow the money", corporate due diligence, sanctions screening, litigation history, or "what's been said about X". Do NOT use for general web research (use Web Research) or anything requiring private/paywalled data.

## Public sources (all web-fetchable, no key)
- **SEC EDGAR** — company filings: `https://efts.sec.gov/LATEST/search-index?q=<name>` and `https://www.sec.gov/cgi-bin/browse-edgar`.
- **USAspending** — federal contracts/grants by recipient (`api.usaspending.gov`).
- **OFAC SDN** — sanctions screening (the consolidated list, searchable).
- **OpenCorporates** — company registrations across jurisdictions.
- **CourtListener** — US federal + state court opinions.
- **ICIJ Offshore Leaks** — offshore entity database.
- **Wayback Machine** — recover dead/changed pages (`web.archive.org`).
- **Wikipedia + Wikidata** — narrative + structured facts.
- **GDELT** — global news monitoring.

## Method
1. **Frame** the question and the entity to resolve.
2. **Resolve the entity.** Names vary (LLC suffixes, abbreviations, transliterations). Collect every spelling/identifier (ticker, CIK, registration number) so you can join across sources.
3. **Gather** from the relevant sources with web_fetch. Record the source URL and retrieval date beside every fact.
4. **Cross-link.** A link between two facts gets an explicit confidence: *confirmed* (two independent sources), *probable* (one strong source), *speculative* (circumstantial/timing only). Never present speculative as confirmed.
5. **Evidence chain.** Present the finding as a chain: claim → each supporting fact → its source → its confidence. Separately list what you could NOT confirm.

## Rules
- **Public records only.** No accessing private accounts, no social-engineering, no paywalled data.
- **Confidence is mandatory** on every link — an OSINT report without confidence levels misleads.
- **Cite the URL and date** for every fact; archive volatile pages via Wayback.

*Needs the DISH (web) object to fetch public records.*
