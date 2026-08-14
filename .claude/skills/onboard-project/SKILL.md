---
name: onboard-project
description: Give a NanoClaw agent its own agent group wired to a project directory on this machine — detect the stack, mount the repo, install the toolchain it needs, and verify. Triggers on "onboard a project", "let the agent work on <repo>", "create a group for this project", "mount my repo", "add a project to nanoclaw".
---

# Onboard a Project

Turn a directory on this machine into a NanoClaw agent group: the repo mounted into that group's containers, the project's toolchain installed in a derived image, and the group reachable.

Do the steps in order — each one depends on the previous. Report what you did after every step; several are approval-gated or slow.

## 1. Read the project

Ask for the path if it wasn't given. Then look, don't assume:

```bash
P=<path>
ls -a "$P"
cat "$P/package.json" 2>/dev/null | head -40
ls "$P"/AGENTS.md "$P"/CLAUDE.md "$P"/.claude "$P"/*.lock "$P"/*lock.* 2>/dev/null
```

What matters:

- `packageManager` in `package.json` — this decides the package manager, not the lockfile alone
- a `src-tauri/` or `Cargo.toml` → needs a Rust toolchain, **read §3 first**
- an Expo app (`expo` in dependencies) → `eas-cli` if they build on EAS; a local Android/iOS build needs an SDK that does not belong in this container
- `AGENTS.md` / `CLAUDE.md` — these are read automatically once mounted (groups set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`), so **do not copy them** anywhere
- `.claude/skills/` and `.claude/settings.json` in the repo — project-scope, they come along with the mount for free

Tell the user what you found and what you plan to install before installing anything.

## 2. What is already in the image

Do not install what is already there. The base agent image ships:

`node 22` · `bun` · `pnpm` · `yarn 1.x` · `chromium` · `git` · `curl` · `unzip` · `claude-code` · `agent-browser`

Playwright works out of the box — the image sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Do not add a browser.

Confirm against the actual image rather than this list:

```bash
IMG=$(grep -o 'nanoclaw-agent[^ "]*' <<< "$(docker images --format '{{.Repository}}:{{.Tag}}')" | grep ':latest' | head -1)
docker run --rm --entrypoint sh "$IMG" -c 'for t in cargo rustc gh python3 yarn; do printf "%-10s %s\n" "$t" "$(command -v $t || echo AUSENTE)"; done'
```

## 3. Check whether the toolchain can even be installed

**Do this before promising a native toolchain.** On a hardened image, C/C++/Rust toolchains cannot be installed at all:

```bash
docker run --rm --user root --entrypoint sh "$IMG" -c \
  'apt-get update -qq && apt-get install -y --no-install-recommends libc6-dev 2>&1 | tail -5'
```

If that fails with `libc6-dev : Depends: libc6 (= X) but X+eN is to be installed`, the image's system libraries are vendor rebuilds (suffix `+eN`) with no matching apt source, so every Debian `-dev` package is unsatisfiable. No `libc6-dev` means no linker, which means no `cargo`, and `rustup` does not help — it ships the Rust toolchain, not the C one.

Say so plainly and give the user the choice:

- **Skip the native part.** The agent still edits the code, runs git, and runs everything that is pure JS/TS. Native builds stay on the host.
- **Build an unhardened image** for this group only (`bash container/build.sh <tag>` with `NANOCLAW_HARDENED_IMAGE=false`), then point the group at it. Costs one more image to maintain and drops the hardened provenance for that group.

Do not pick for them.

## 4. Allowlist

The mount must sit under an allowed root:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json
```

If the project's parent is missing, run `/manage-mounts` — do not hand-edit the file. Note that `blockedPatterns` is checked **once, against the mount root, and does not descend**: a `.env` inside the mounted repo is readable by the agent regardless. Say this out loud; offer OneCLI for anything that actually matters.

## 5. Create the group and mount the repo

```bash
ncl groups create --folder <slug> --name "<Display Name>"
ncl groups config add-mount --id <group-id> --host <abs-path> --container <slug>
```

The repo lands at `/workspace/extra/<slug>`. Add `--ro` for read-only.

`add-mount` is `hostOnly` — an agent inside a container can never run it, by design. If an agent asked for this onboarding, this is the step the human has to run.

## 6. Packages

**One flag per package.** `--apt "a,b,c"` stores the comma string as a single package name and produces `apt-get install a,b,c`, which fails.

```bash
for p in <pkg> <pkg>; do ncl groups config add-package --id <group-id> --apt "$p"; done
ncl groups config add-package --id <group-id> --npm "<pkg>"
```

Stack → package, only what the project actually needs:

| Found | Install |
|---|---|
| `packageManager: yarn@4.x` | npm `@yarnpkg/cli-dist@<version>` — **not** `yarn@4.x`, which does not exist on npm (the `yarn` package stops at 1.22) |
| `packageManager: pnpm@x` / `bun@x` | nothing — both are in the image |
| Expo + EAS builds | npm `eas-cli` |
| Tauri / Cargo (only if §3 passed) | apt `cargo rustc build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libsoup-3.0-dev patchelf file` |
| GitHub CLI workflows | apt `gh` |

Then build the derived image:

```bash
ncl groups restart --id <group-id> --rebuild
```

## 7. Verify — do not skip

Read the config back and prove the tools exist in the built image:

```bash
ncl groups config get --id <group-id> --json
docker run --rm --entrypoint sh nanoclaw-agent-<slug-of-install>:<group-id> -c '<tool> --version'
```

Report the actual versions you saw. A group whose image build failed still has a stale `image_tag` and looks fine in the config.

## 8. Make the group reachable

A fresh group is wired to nothing. Ask which the user wants:

- **Its own DM/channel** — run `/manage-channels`
- **Reached only through an existing agent** (the coordinator pattern) — add it as a destination of that agent:

  ```bash
  ncl destinations add --agent-group-id <coordinator-group-id> \
    --local-name <slug> --target-type agent --target-id <new-group-id>
  ```

  `--local-name` is how the coordinator addresses it: `send_message({ to: "<slug>", ... })`. Lowercase, dash-separated, unique per agent.

Destinations are one-directional. If the project agent should be able to answer back, add the reverse row too.

## Undo

```bash
ncl groups config remove-mount --id <group-id> --host <abs-path> --container <slug>
ncl groups delete --id <group-id>
docker rmi nanoclaw-agent-<slug-of-install>:<group-id>
```

The allowlist entry is separate — remove it with `/manage-mounts` if it was added only for this project.
