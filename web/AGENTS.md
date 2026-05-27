# Web AGENTS

Scope: browser-facing static pages, shared browser JavaScript, CSS, HTML templates, and web components under `web/`.

Before editing browser UI, read:
- `ctx/docs/code/browser/icons.md`
- `ctx/docs/code/browser/application-shell.md`
- `ctx/docs/code/browser/page-runtime.md`
- `ctx/docs/code/browser/web-ui.md`
- `ctx/docs/code/browser/browser-diagnostics.md`
- `ctx/docs/code/browser/web-components.md`
- `ctx/docs/code/browser/web-platform.md`
- `ctx/docs/code/quality/testing-plan.md`
- `ctx/docs/code/source-map.md`

For ownership questions, also read:
- `ctx/docs/architecture/application/application-shell.md`
- `ctx/docs/architecture/application/page-runtime.md`
- `ctx/docs/architecture/application/navigation.md`

Routing:
- Shell layout, header, footer, status controls, profile/identity entry points: read `ctx/docs/code/browser/application-shell.md`, `ctx/docs/architecture/application/application-shell.md`, `ctx/docs/code/browser/web-ui.md`
- Page controllers or page content rendering: read `ctx/docs/code/browser/page-runtime.md`, `ctx/docs/architecture/application/page-runtime.md`, `ctx/docs/code/browser/web-ui.md`
- Campaign Directory UI: read `ctx/docs/code/browser/web-ui.md`, `ctx/docs/code/browser/page-runtime.md`, `ctx/docs/code/quality/testing-plan.md`
- Diagnostics, error indicators, device/storage status: read `ctx/docs/code/browser/browser-diagnostics.md`, `ctx/docs/code/browser/application-shell.md`, `ctx/docs/code/browser/web-ui.md`
- Web components: read `ctx/docs/code/browser/web-components.md`, `ctx/docs/code/browser/application-shell.md`, `ctx/docs/code/browser/web-ui.md`
- When adding or changing icons: read `ctx/docs/code/browser/icons.md`, read `ctx/docs/code/browser/web-ui.md`, read `ctx/docs/code/browser/application-shell.md` when icons are used in shell controls, use selected local `SVG` files under `web/assets/icon/`
- Tests: read `ctx/docs/code/quality/testing-plan.md` and the corresponding browser/code doc for the changed feature

Hard rules:
- Icons must follow `ctx/docs/code/browser/icons.md`.
- Use `web/assets/icon/` for browser icon assets.
- Do not add an icon file without matching runtime usage.
- The shell is compact chrome, not a page card.
- Mobile header uses at most two visual rows.
- Mobile footer must not be overlapped.
- `Errors 0` and device/storage status are permanent but compact.
- `Edit identity` belongs to shell/profile, not Campaign Directory actions.
- Compact visible UI may use `Campaigns` instead of `Campaign Directory`.
- No `Primary Flow` or `Secondary Flow` in default UI.
- No raw ISO timestamps in normal campaign cards.
- Page controllers render only inside the shell content area.
- Domain actions stay in page content, not shell.
