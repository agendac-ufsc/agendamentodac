---
name: Package firewall transitive updates
description: Recover pnpm workspace installs when the package firewall rejects a stale transitive dependency.
---

When a workspace install is blocked on a stale transitive package, identify its direct parent and update that parent to a compatible patched release. Do not bypass the package registry firewall.

**Why:** A stale transitive dependency blocked installation of this app; updating the direct parent restored the install with the patched transitive release.

**How to apply:** Check the dependency tree and current compatible releases, update the direct parent and lockfile, then reinstall through Corepack.
