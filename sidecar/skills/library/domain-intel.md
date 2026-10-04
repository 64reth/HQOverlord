---
name: Domain Intelligence
slug: domain-intel
description: Passive domain reconnaissance — subdomains, SSL certs, WHOIS, DNS, and availability — with Python stdlib, no API keys.
category: Research
requires: [workbench]
license: MIT
default: false
---

Passive reconnaissance on a domain using only the Python standard library — zero dependencies, zero API keys. Run it with `shell.exec`.

Use for "what do we know about domain X", subdomain discovery, cert/expiry checks, WHOIS/registrar lookups, or a quick "is this domain taken".

**Passive only.** This inspects public DNS/cert/WHOIS records — it does NOT probe, scan ports, or send traffic to the target's application. For active security testing that's a separate, authorization-gated activity.

## What you can pull (stdlib recipes)
- **Subdomains** via Certificate Transparency logs: fetch `https://crt.sh/?q=%25.example.com&output=json` and dedupe the `name_value` field.
- **SSL certificate:** `ssl.get_server_certificate((host, 443))` / an `ssl` socket → issuer, SANs, `notAfter` expiry, cipher.
- **WHOIS:** open a socket to the TLD's WHOIS server on port 43, send `domain\r\n`, read the response → registrar, creation/expiry dates, name servers.
- **DNS records:** `socket.getaddrinfo` for A/AAAA; for MX/NS/TXT/CNAME query a resolver (`socket` + a small DNS query, or shell `nslookup`/`dig` if present).
- **Availability signal:** a domain with no DNS, no cert, and a "no match" WHOIS is likely available (passive inference, not authoritative — the registrar is the source of truth).

## Method
1. Take the domain; decide which checks matter (recon → subdomains + cert + DNS; due diligence → WHOIS + cert expiry).
2. Run each check, collecting structured output (JSON) so results compose.
3. Report: registrar + key dates, cert issuer + expiry (flag if <30 days), the discovered subdomains, and the DNS record set. Note anything anomalous (wildcard cert, very recent registration, mismatched name servers).

*Needs the WORKBENCH object to run the Python recon script.*
