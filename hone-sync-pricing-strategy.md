# Hone — Sync & Pricing Strategy

## Core Principles

1. **Hone is fully open source.** The editor is free, forever. No features are gated behind a paywall.
2. **You only pay for our servers.** The only paid element is using Hone's hosted relay at `sync.hone.codes`.
3. **No lock-in.** The relay server is open source. Anyone can self-host their own relay and owe nothing.

---

## What the Relay Does

The relay is **not** a settings sync service. It is the core infrastructure that enables Hone as a **multi-device editor**.

The primary use case: you're working on your Mac, you close the lid, pull out your phone, and your project is just *there* — files, AI chat history, everything. No git commit, no push, no GitHub auth dance in a third-party app.

This solves the fundamental problem with every mobile code editor today: they all start with "first, connect to GitHub" or "first, clone a repo." Hone starts with "you already have your project, just keep working."

### What syncs

- Project files and file contents
- AI chat history and context
- Editor state (open files, cursor positions)

### Sync architecture

The relay is **not** a real-time streaming service. Clients can't be assumed to always have internet or be online simultaneously. This is a **sync problem**, not a streaming problem.

- Each device maintains a **full local copy** of the project state.
- When connectivity exists, devices sync through the relay by pushing and pulling deltas.
- When offline, you keep working locally. Changes reconcile when connectivity returns.
- The relay is a **dumb mailbox**: it holds undelivered deltas until the other side picks them up, then forgets them.

### Conflict resolution

The intelligence lives in the **clients**, not the server.

- If only one device edited a file → fast-forward.
- If both devices edited the same file → show a merge conflict (like git).
- AI chat history is append-only → interleave by timestamp.

### Delta format

A lightweight operation log: "file created," "file modified" (with diff or full content depending on size), "file deleted," "AI chat message appended," "cursor moved to X." Generic enough to not lock into a specific sync strategy, structured enough for clients to merge intelligently.

This same delta format could eventually support real-time collaboration between two desktops — but that's a future concern.

---

## Pricing Tiers

| Tier | Price | What you get |
|------|-------|--------------|
| **Free** | $0 | Full editor, no sync. Self-host the relay if you want. |
| **Personal** | $12/year (~$1/mo) | Sync one project between two devices. 500MB delta history. |
| **Pro** | $36/year (~$3/mo) | Unlimited projects, unlimited devices. 5GB delta history. |
| **Team** | $6/user/month | Pro features + shared project sync between team members with shared AI chat context. |

### Rationale

- **Free** users are the community — bug reporters, contributors, word-of-mouth. Some will self-host.
- **Personal** is the impulse-buy tier. $1/month is below the "do I need to ask my boss?" threshold.
- **Pro** is the natural upsell when users hit the one-project limit.
- **Team** is where real revenue lives. A team of five is $360/year — 30x a Personal user. Companies don't blink at $6/user/month.

Every tier runs the same open-source editor. The only difference is how much relay capacity you get.

---

## Authentication

### Design constraint

Hone the editor has **zero concept of accounts**. It's open source, it runs locally, no login ever. Authentication exists only at the relay/services level — a lightweight "Hone Services" account, not an editor account.

### Auth method

**Email + magic link.** No passwords. Enter your email, get a link, click it, authenticated. The relay issues a device token stored in the OS keychain. This is what Cursor, Linear, and other modern dev tools do.

This gives you:
- An email address for receipts and communication
- A stable identity that survives device changes (lose your phone, sign in on the new one, your subscription and pairings are still there)
- A natural anchor for Stripe billing
- A foundation for Team invites later

### How it integrates with the open-source editor

The editor is **auth-agnostic**. It only knows about a relay configuration:

```
relay: {
  url: "https://sync.hone.codes",
  token: "device-token-abc123"
}
```

The editor doesn't know or care how the token was obtained. The relay exposes a **discovery endpoint** (`GET /auth/info`) that tells the editor how to authenticate:

- For `sync.hone.codes`: returns a URL → editor opens it in system browser → magic link flow → browser redirects to `hone://auth/callback?token=xyz` → editor stores token in keychain → sync starts.
- For a self-hosted relay: might return "use a static token" or a corporate SSO URL.
- For a relay with no auth: returns nothing.

### Why this matters

The open-source codebase contains **zero proprietary logic**. No Hone Services branding, no login UI, no email fields. Everything service-specific lives behind the relay URL. A third party could build their own relay with Google SSO and it would plug in identically.

### UX flow

The user discovers sync when they need it. In settings, there's a "Project Sync" section with a relay URL field (pre-filled with `sync.hone.codes`). Toggle it on, the auth flow kicks in. No sign-in screen on first launch, no nag banners.

Device pairing happens **implicitly through the shared account** — all devices signed into the same email can see each other's projects. The old manual device-code pairing becomes the self-hosted fallback for relays without the account system.

---

## AI Integration (Separate Concern)

AI is **BYOK** (Bring Your Own Key). Users provide their own Anthropic/OpenAI/Ollama keys, stored in OS keychain. Hone never resells API access.

The relay syncs AI chat history as part of the project state, but has no involvement in the AI calls themselves.

Future possibility: a "Hone Pro" tier that bundles sync + an AI orchestration layer (smarter context gathering, custom prompts, caching). But this is a later consideration — launch with BYOK only.

---

## Server Cost Profile

Because the relay is a thin, mostly-stateless mailbox:

- No persistent connections required
- Stores small deltas temporarily, not full project mirrors
- A single VPS can serve thousands of users
- Self-hosting is trivially easy (single binary or Docker container)

This makes the $12/year Personal tier viable even at small scale.

---

## Summary

| Component | Model |
|-----------|-------|
| Hone editor | Open source, free forever |
| Relay server | Open source, self-hostable |
| `sync.hone.codes` | Hosted relay, paid tiers |
| AI integration | BYOK, no cost to Hone |
| Auth | Email + magic link, services-level only |
| Revenue | Relay subscriptions (Personal / Pro / Team) |
