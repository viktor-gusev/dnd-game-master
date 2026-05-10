# DND Game Master

## Overview

DND Game Master is an AI co-Dungeon Master platform for tabletop RPG sessions.
The human Game Master remains in control.

## Current Scope

The current implementation is an initial Node.js web server.
It provides a minimal landing page and static public files.

Product goals such as authentication, sessions, AI assistance, and gameplay features are not implemented yet.

## Runtime

The application uses `@flancer32/teq-web` for web transport and request pipeline infrastructure.
The root component is `Dnd_Gm_App`.

Static files are served from `web/`.
The default port is `3000`.
Use `--port <number>` or `-p <number>` to select a different port.

## Installation

```sh
npm install
```

## Start

```sh
npm start
```

To use a custom port:

```sh
npm start -- --port 3000
```

## Static Files

- `web/index.html`
- `web/robots.txt`
- `web/sitemap.xml`

## Tests

```sh
npm run test:unit
npm run test:integration
npm test
```

## Project Structure

- `bin/` bootstrap entrypoint
- `src/` DI-managed application components
- `web/` public static assets
- `test/unit/` module-level tests
- `test/integration/` runtime tests
- `ctx/docs/` project documentation and constraints
