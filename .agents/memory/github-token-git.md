---
name: GitHub token via Git
description: GitHub API access can work while Git's extraheader authentication fails in this environment.
---

Use a temporary `GIT_ASKPASS` helper that reads `GITHUB_TOKEN` from the environment when Git rejects an `http.extraheader` request even though the same token is accepted by the GitHub API.

**Why:** The environment accepted the token through GitHub's API but returned `invalid credentials` for Git's Authorization extraheader path.

**How to apply:** Keep the helper temporary, never put the token in the remote URL, Git config, command output, or chat.