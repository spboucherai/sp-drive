# CLAUDE.md — SP Drive

Self-hosted document storage for https://drive.spboucher.ai on the MacLustr cluster. The owner's full brief is in
`docs/brief.md`; decisions are in `docs/architecture.md`; what is really done is in `docs/progress.md`.

## Rules

- Real code only: every file, permission and event is persisted; no mock, no fake link, no inert button.
- After the first deployment the source of truth is the clone on the node (`mld status` → sp-drive); edit there, then
  `git push`. This laptop copy only served to create the app.
- Never touch SP Wallet or another service. Secrets stay out of the repository.
- Never log document content, link tokens or passwords. Public URLs are redacted in the request log.
- Every route that takes an identifier scopes it by owner; a foreign identifier answers 404.
- A directory named `icons` is ignored by the owner's global gitignore (`Icon?`): do not create one.

## Commands

```
pnpm install
pnpm typecheck          # shared, api, web, service worker
pnpm test               # vitest: real PostgreSQL (sp_drive_test), real clamd when ~/.cache/sp-drive-clamav has signatures
pnpm build              # dist/api.mjs, worker.mjs, cli.mjs, sheet-child.mjs, dist/web
scripts/dev-stack.sh    # API :8661 + web http://localhost:5183 ; scripts/dev-invite.sh <email> [--admin]
pnpm e2e                # Playwright against the dev stack
```

## Layout

`packages/shared` naming rules and limits · `services/api/src` API, worker, CLI, migrations · `apps/web/src` React app ·
`tests/e2e` Playwright · `infra` node configuration (clamd, mld manifest template) · `scripts` build, dev, backup, restore test.
