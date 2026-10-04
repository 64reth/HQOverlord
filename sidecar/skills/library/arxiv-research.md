---
name: arXiv Research
slug: arxiv-research
description: Search and retrieve academic papers from arXiv's free API — by keyword, author, category, or paper ID.
category: Research
requires: [dish]
license: MIT
default: false
---

Find and read academic papers on arXiv. The API is free and keyless; the paper pages and PDFs are fetchable with web_fetch.

Use when the Commander wants recent papers on a topic, a specific paper's abstract, or an author's/category's output.

## Search
Hit the query API through the browser/fetch layer and read the returned Atom XML:
```
web_fetch("https://export.arxiv.org/api/query?search_query=all:diffusion+transformer&max_results=5&sortBy=submittedDate&sortOrder=descending")
```
Each `<entry>` has the title, `<id>` (the arXiv id after `/abs/`), `<published>` date, `<author>` names, `<summary>` (abstract), and `<category term=...>`. Pull those out and present a numbered list.

## Query syntax
| Prefix | Searches | Example |
|---|---|---|
| `all:` | all fields | `all:transformer+attention` |
| `ti:` | title | `ti:large+language+models` |
| `au:` | author | `au:vaswani` |
| `abs:` | abstract | `abs:reinforcement+learning` |
| `cat:` | category | `cat:cs.AI` |

Combine with `+AND+`, `+OR+`, `+ANDNOT+`; exact phrase with quotes (`ti:"chain of thought"`). Sort with `&sortBy=submittedDate&sortOrder=descending` for the latest.

## Get a specific paper
- Metadata: `web_fetch("https://export.arxiv.org/api/query?id_list=2402.03300")`
- Abstract page: `web_fetch("https://arxiv.org/abs/2402.03300")`
- Full PDF text: `web_fetch("https://arxiv.org/pdf/2402.03300")`

## Present it
For each result: `[id] Title — Authors — date — categories`, a two-line summary, and the PDF link. When the Commander picks one, fetch the PDF and pull the specific claims they need, citing the id.

*Needs the DISH (web) object to query arXiv and fetch papers.*
