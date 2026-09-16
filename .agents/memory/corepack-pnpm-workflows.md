---
name: Corepack for pnpm workflows
description: Project-pinned pnpm can loop through recursive self-install when managed workflows invoke the global pnpm wrapper.
---

Managed artifact workflows should invoke the project package manager through Corepack when `package.json` pins a pnpm version. The global wrapper may recursively attempt to install that same version and exhaust process/thread resources before the app opens its port.

**Why:** The project uses a pinned pnpm version, while the environment's global pnpm wrapper can fail to resolve it and repeatedly spawn `pnpm add pnpm@...`.

**How to apply:** Prefer `corepack pnpm ...` in artifact development commands when this startup pattern appears. Restore dependencies with `corepack pnpm install --frozen-lockfile`, then restart managed workflows one at a time.