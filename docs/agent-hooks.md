# Agent hooks

The hooks ship in the npm package, not the Chrome extension ZIP. Install the CLI
first, then let it merge the native configuration for each runtime.

```bash
npm install --global @ferdousbhai/slop-detector
slop-detector install-hooks
```

Rerun the installer after moving the package, replacing Node, or changing the
installation scope. Generated commands intentionally point to the exact CLI and
Node executable used during installation.

## Supported runtimes

| Agent | User destination | Project destination | Events |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.json` | `Stop`, `UserPromptSubmit` |
| Codex CLI | `~/.codex/hooks.json` and `~/.codex/config.toml` | `.codex/hooks.json` and `.codex/config.toml` | `Stop`, `UserPromptSubmit` |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` | `AfterAgent` |
| OMP | `$PI_CODING_AGENT_DIR/extensions/slop-detector.ts` or `~/.omp/agent/extensions/slop-detector.ts` | `.omp/extensions/slop-detector.ts` | `session_stop`, `before_agent_start` |
| Ghost | `$XDG_CONFIG_HOME/ghost/hooks.json` | not supported | `session_stop`, `before_prompt` |

User scope is the default. Project scope selects Claude, Codex, Gemini, and OMP
when `--agents` is omitted. Ghost is user-scoped because imported Ghost homes
are data, not trusted executable configuration.

```bash
slop-detector install-hooks --scope=user
slop-detector install-hooks --scope=project
slop-detector install-hooks --agents=claude,omp
slop-detector install-hooks --dry-run --format=json
```

Standard pi and OpenCode are not installed. Their public lifecycle APIs can
queue follow-up messages but cannot reliably veto the original final response.

## Final-output behavior

The agent sends its completed assistant message to Slop Detector over stdin.
Slop Detector runs the local rule engine and returns the runtime's native hook
JSON.

- A clean answer is accepted with `{}`.
- Warnings are reported without blocking.
- Errors return model-visible revision feedback.
- A failed revision stops after one retry. The hook never starts an unbounded
  revision loop.

Detection performs no model or network call. A blocking result asks the current
agent session to continue, so that runtime decides model selection, context,
prompt caching, and token accounting.

## Warning nudges

Warnings should influence later answers without rewriting the current one. The
Stop or `session_stop` hook therefore stores a compact advisory under:

```text
$XDG_STATE_HOME/slop-detector/session-nudges/
```

The fallback is `~/.local/state/slop-detector/session-nudges/`. Filenames are
SHA-256 hashes of session IDs. Values contain only rule IDs, counts, and static
rule guidance. They do not contain the assistant response or matched spans.

On the next user prompt:

- Claude and Codex return `UserPromptSubmit.hookSpecificOutput.additionalContext`;
- OMP returns a non-displayed custom message from `before_agent_start`; and
- Ghost returns `additionalContext` from `before_prompt`.

The state file is atomically claimed and consumed once. Entries older than
seven days are ignored, and stale files are pruned periodically. Advisory-state
failures always fail open.

Gemini currently has no installed next-user-prompt companion event, so its
warnings remain informational.

## Installation safety

Before writing, the installer preflights every requested JSON file, Codex
feature-table edit, and OMP ownership marker. This avoids partial installation
because a later configuration is malformed. A filesystem failure can still
interrupt the write phase. For each changed existing file, the installer creates
one backup next to the original:

```text
settings.json.slop-detector.bak
config.toml.slop-detector.bak
```

The installer removes and replaces only commands it owns. Other hook groups,
settings, comments outside edited Codex feature lines, and unrelated fields are
preserved. It refuses to replace an OMP extension without the generated-file
marker.

Hooks execute with the user's permissions. Claude, Codex, Gemini, and OMP
project hooks are executable project configuration; review untrusted
repositories before enabling them. Ghost deliberately reads hooks only from its
trusted user configuration.

Codex exposes hook trust in `/hooks`. New or changed non-managed commands may
need approval before Codex runs them.

## Internal CLI protocol

Installed hooks call the internal command below with a runtime-specific JSON
payload on stdin:

```bash
slop-detector hook <runner>
```

Stop runners are `claude`, `codex`, `gemini`, `ghost`, and `omp`. Prompt runners
are `claude-prompt`, `codex-prompt`, `ghost-prompt`, and `omp-prompt`. These names
are adapter internals rather than a public JavaScript API.

Hook input is capped at 1 MB. Invalid input returns exit code 2. OMP's generated
adapter also caps output at 2 MB and terminates a CLI subprocess after ten
seconds.

## Removing hooks

There is not yet an automatic uninstall command. Restore the one-time backup or
remove the Slop Detector command groups from the destination files. Remove the
generated OMP file only if it contains this marker:

```text
Generated by @ferdousbhai/slop-detector
```
