<div align="center">

# Steam Desktop Authenticator — Web · SDA

**Self-hosted Steam Guard Mobile authenticator manager that runs in your browser.**
Live Steam Guard codes, trade & market confirmations, and authenticator enroll / revoke — import a `.maFile` or create a brand-new authenticator. Cross-platform, no installer.

[![license](https://img.shields.io/badge/license-AGPL--3.0-1f8a70)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5eead4)](https://nodejs.org)
[![runtime](https://img.shields.io/badge/runtime-Node.js%20%2B%20Express-2dd4bf)](#tech-stack)
[![platform](https://img.shields.io/badge/platform-web%20%C2%B7%20any%20OS-99a3b2)](#quick-start)

![Steam Desktop Authenticator Web — screenshot](docs/screenshot.png)

</div>

> **TL;DR** — a web alternative to the classic Windows **Steam Desktop Authenticator (SDA)**.
> It generates Steam Guard 2FA codes, confirms trades/market listings, and can add or remove
> the Steam Guard **mobile authenticator** — all from a local web UI, on Windows, Linux or macOS.

**Keywords:** Steam Guard · Steam Desktop Authenticator · SDA · maFile · mobile authenticator ·
2FA · TOTP · Steam trade confirmations · shared_secret / identity_secret · self-hosted · Node.js.

---

## 🇷🇺 Описание

**SDA в браузере** — менеджер мобильного аутентификатора Steam Guard. Живые коды Steam Guard,
подтверждения трейдов и маркета, создание и снятие аутентификатора. Импортируйте `.maFile`
(в т.ч. зашифрованные SDA) или создайте новый аутентификатор прямо из веб-интерфейса.
Локальный сервер на Node.js, работает на любой ОС. Секреты не покидают сервер без явного запроса.

---

## Features

- **Live Steam Guard codes** — correct Steam TOTP (HMAC-SHA1, 30-second window, Steam's
  base-26 alphabet) with a countdown ring; time is synced to Steam's own clock.
- **Import `.maFile`** — drag & drop, file picker, or paste JSON (`Ctrl+V`). Encrypted SDA
  exports are supported too (PBKDF2-SHA1 + AES-256-CBC) — add the matching `manifest.json`
  to the same import and you'll be asked for the password.
- **Create a new authenticator** — log in with username/password, enter the email Steam Guard
  code, optionally attach a phone number (or stay phone-less with email confirmation). You get
  the **revocation code (R-code)** at the end. The login & password are saved into the `.maFile`.
- **Remove an authenticator** — unlink Steam Guard Mobile using the revocation code.
- **Trade & market confirmations** — list pending confirmations and accept/decline them one by
  one or in bulk.
- **Download the `.maFile`** — right-click an account (or the **⋮** menu) → *Скачать .maFile*.
- **Login & password at a glance** — shown next to the code, masked by default, with reveal/copy.
- **Search & scroll** — filter accounts by name or SteamID; the list scrolls on its own when you
  have many of them.
- **Per-account or global proxy** — HTTP / SOCKS via `undici` (`COXER_PROXY` / `STEAM_PROXY`).
- **Durable storage** — `.maFile`s live in `./maFiles` with collision-safe filenames, atomic
  writes, and BOM-tolerant parsing; deleting an account moves the file to `./maFiles/.trash`
  instead of erasing it, so nothing is lost across restarts.
- **Polished UI** — terminal-dark theme, animated background, fully responsive (desktop & mobile).
- **One-command deploy** — production [`deploy.sh`](deploy.sh) for Ubuntu (Node + nginx + systemd,
  optional HTTP Basic Auth / UFW / Let's Encrypt TLS).

---

## Quick start

```bash
npm install
npm start
```

Open **http://127.0.0.1:3000**

Requires **Node.js ≥ 18**.

---

## Configuration

All configuration is via environment variables:

| Variable          | Default        | Description                                              |
|-------------------|----------------|----------------------------------------------------------|
| `PORT`            | `3000`         | HTTP port                                                |
| `HOST`            | `127.0.0.1`    | Bind address (keep on localhost unless behind a proxy)   |
| `COXER_VAULT_DIR` | `./maFiles`    | Where `.maFile`s are stored                              |
| `COXER_PROXY`     | —              | Global proxy for Steam requests (`STEAM_PROXY` also works)|

---

## REST API

The browser never receives secrets in the account list — the server returns ready-made codes and
public fields only. The raw `.maFile` and credentials are served **only on explicit request**.

| Method & path                          | Purpose                                  |
|----------------------------------------|------------------------------------------|
| `GET  /api/accounts`                   | List accounts (public fields)            |
| `POST /api/accounts/import`            | Import one or more `.maFile`s            |
| `DELETE /api/accounts/:id`             | Remove account (file → `.trash`)         |
| `PATCH /api/accounts/:id`              | Set per-account proxy                    |
| `GET  /api/accounts/:id/code`          | Current Steam Guard code for one account |
| `GET  /api/codes`                      | Codes for all accounts + time sync       |
| `GET  /api/accounts/:id/credentials`   | Login & password (on demand)             |
| `GET  /api/accounts/:id/file`          | Download the raw `.maFile`               |
| `GET  /api/accounts/:id/actions`       | Pending trade/market confirmations       |
| `POST /api/accounts/:id/actions/resolve` | Accept/decline confirmation(s)         |
| `POST /api/accounts/:id/revoke`        | Remove the authenticator (R-code)        |
| `POST /api/enroll/start`               | Begin creating a new authenticator       |
| `GET  /api/enroll/:id`                 | Enrollment state (polling)               |
| `POST /api/enroll/:id/input`           | Submit a step value (email/SMS code…)    |
| `POST /api/enroll/:id/cancel`          | Cancel enrollment                        |

---

## Tech stack

Pure **Node.js (ESM) + Express** backend, **undici** for proxied Steam requests, and a dependency-free
**vanilla-JS** frontend. No database. Static assets are served straight from `public/`.

| File                 | Responsibility                                              |
|----------------------|-------------------------------------------------------------|
| `server.js`          | Express app & REST API                                      |
| `lib/guardcode.js`   | Steam Guard code generation (`buildCode`)                   |
| `lib/clock.js`       | Steam time sync (`serverClock`)                             |
| `lib/vault.js`       | Parse `.maFile` (`readVault`)                               |
| `lib/blobcrypt.js`   | Decrypt encrypted `.maFile` (PBKDF2 + AES-256-CBC)          |
| `lib/registry.js`    | Profile & `.maFile` storage                                 |
| `lib/actions.js`     | Trade/market confirmation hashing & operations             |
| `lib/signin.js`      | Mobile sign-in (RSA password + Begin/Poll)                  |
| `lib/enroll.js`      | Add authenticator (HasPhone → Add → Finalize)              |
| `lib/enrollflow.js`  | Interactive enrollment state machine                        |
| `lib/revoke.js`      | Remove authenticator by revocation code                     |
| `lib/tokenwire.js`   | Refresh access token from refresh token                     |
| `lib/rpc.js`         | Steam service message schemas & transport (`invokeService`) |
| `lib/wire.js`        | Minimal protobuf codec (`packMessage` / `unpackMessage`)    |
| `lib/netgate.js`     | Proxy dispatcher (HTTP/SOCKS via `undici`)                  |

---

## Deploy (Ubuntu, production)

A self-contained installer is included. From the project root on a fresh Ubuntu server:

```bash
# behind an IP, with HTTP Basic Auth (a password is generated and printed):
sudo bash deploy.sh

# with a domain + HTTPS (Let's Encrypt):
sudo DOMAIN=example.com SETUP_TLS=yes TLS_EMAIL=you@mail.com bash deploy.sh
```

It installs Node (NodeSource), sets up an **nginx** reverse proxy and a **systemd** service, and
(by default) puts **HTTP Basic Auth** in front of the site. Logs: `journalctl -u coxerhub -f`.

> ⚠️ Don't run the project from `/root` — the service user can't read it. Put it somewhere like
> `/opt/sda` or `/home/<user>/sda` and run `sudo bash deploy.sh` from there.

---

## Security

- A `.maFile` contains `shared_secret` and `identity_secret` — **full access to Steam Guard**.
  Treat it like a password.
- By default the server listens on **`127.0.0.1` only**. Do not expose it to the internet without
  **HTTPS and authentication** — the bundled `deploy.sh` adds HTTP Basic Auth for exactly this reason.
- Files in `./maFiles` are stored in plain text; keep the folder private (it's in `.gitignore`).
- The account list never ships secrets to the browser; downloading a `.maFile` or revealing the
  password are explicit, on-demand actions.

---

## License

[**AGPL-3.0**](LICENSE) — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

This is an independent project and is **not affiliated with, endorsed by, or connected to Valve or Steam**.
"Steam" is a trademark of Valve Corporation.
