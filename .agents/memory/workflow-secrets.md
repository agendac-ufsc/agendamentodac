---
name: Workflow secrets
description: Environment-specific behavior when project secrets are added after services start
---

Project secrets may be present in the workspace while already-running managed workflows still use the environment they started with. Restart the affected workflows after adding or changing secrets.

**Why:** The Agendamento DAC services initially reported missing Redis, Google, and Blob credentials even though the secrets existed; restarting the workflows loaded them and restored the data sync.

**How to apply:** After a secret configuration change, restart each dependent managed service before diagnosing the application logic.