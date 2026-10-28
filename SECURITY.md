# Security policy

## Reporting a vulnerability

Please report security issues privately to **security@revklik.com**. Do not open a public issue
or pull request for a vulnerability.

Include what you found, how to reproduce it (a request, a payload or a short proof of concept),
the version or commit, and the impact you expect. If it involves another person's data, stop at
the minimum needed to show the problem.

You can expect an acknowledgement within a few days and updates as the fix progresses. We ask for
reasonable time to release a fix before you disclose publicly, and we are happy to credit you.

## Scope

In scope: this repository (the Worker in `apps/app`, the dashboard in `apps/web`, the SDK, CLI and
tracker scripts) and the hosted service at app.revklik.com. Typical areas of interest are
authentication and session handling, API token scopes, tenant isolation between accounts and
sites, webhook signature checks, and injection or XSS in the dashboard or tracker.

Out of scope: findings that need a compromised device or admin account, denial of service by raw
traffic volume, missing hardening headers without a demonstrated impact, and issues in
third-party services we integrate with.

## Self-hosting

If you run your own instance you are responsible for its configuration: keep secrets in Wrangler
secrets (never in `wrangler.jsonc`), restrict who can register (see the README), and update
regularly. Run `gitleaks dir . --redact` on your fork before making it public.
