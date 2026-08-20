# Kazumi Stremio Add-on Fork

This checkout preserves the history of `Predidit/Kazumi` and adds an isolated
Stremio-compatible add-on under `stremio-addon/`.

## Repository layout

- `upstream`: `https://github.com/Predidit/Kazumi.git`
- development branch: `feature/stremio-addon-bridge`
- add-on source: `stremio-addon/`
- add-on packaging workflow: `.github/workflows/stremio-addon.yml`

The add-on is intentionally isolated from the Flutter application. Upstream
Kazumi updates can therefore be merged without making the add-on responsible
for building or changing the original clients.

## Syncing upstream

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch feature/stremio-addon-bridge
git rebase main
```

The personal GitHub fork remote should be named `origin`. It is not configured
until GitHub authentication and the remote fork are available.
