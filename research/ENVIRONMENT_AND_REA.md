# Environment and REA Verification

Status date: 2026-10-22. Phase: 1.1 (environment verification). Every statement
below was checked by a command in this session unless marked otherwise.

## 1. Host environment

| Item | Verified value |
| --- | --- |
| Host | Ephemeral Claude Code cloud container, Linux x86_64 (kernel 6.18) |
| Persistence | None beyond the session unless pushed to a Git remote |
| Node.js / npm | v22.22.0 / 10.9.4 |
| Java | OpenJDK 21.0.12.1 (full JDK, `/usr/lib/jvm/java-21-openjdk-amd64`) |
| Browser | Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) |
| Claude Code CLI | 2.1.307 |
| Outbound network | Restricted by environment policy. `example.com:443` → CONNECT 403. GitHub git reads, npm registry and GitHub release downloads succeed. |
| GitHub repos accessible | `Ezemes/*` (9 repos). `Ezemes/Mold-Management` is **empty**. No repo mentions "Coast". |

## 2. REA installation

| Check | Result | Evidence |
| --- | --- | --- |
| Source | `github.com/morluto/rea`, commit `6f28b36` (2026-10-22), package `rea-agents@6.7.0` | `git log` in `/home/user/rea-src` |
| Install | `npm ci` succeeded; runtime `npm audit` 0 vulnerabilities | session log |
| Build | `npm run build:cached` 3/3 tasks succeeded | session log |
| CLI | `node /home/user/rea-src/scripts/rea.mjs --version` → `6.7.0` | session log |
| Ghidra | 12.1.4 at `/opt/ghidra_12.1.4_PUBLIC`, SHA-256 `ddac49f9…d4db` matches REA CI pin | `rea doctor`: 8/8 checks OK |
| Native analysis | `rea analyze <copy of /bin/true> --provider ghidra` succeeded | `evidence/rea/ghidra-analyze.txt` (`ev_d2a6690e…`) |
| Static JS analysis | `analyze-javascript-application` on a sample app succeeded | `ev_e68de586…` (session log) |
| Test suite | `npm test` was still running when this file was written: ~1,432 passed, 3 failed so far (`JavaScriptModuleLookupCli`, `packageSpecifierSuffixCli`). Not yet diagnosed. | scratchpad `test.log` |

## 3. Claude Code registration

| Check | Result |
| --- | --- |
| MCP registration | `rea setup --client claude_code --yes` wrote the `rea` server to `/root/.claude.json` (backup `/root/.claude.json.rea.backup`) with `GHIDRA_INSTALL_DIR` and `JAVA_HOME` |
| Health | `claude mcp list` → `rea: … mcp - √ Connected` |
| Skill | `reverse-engineer-anything` installed to `/root/.claude/skills/` and loaded in this session |
| **MCP tools in the active session** | **Available from 2026-10-22 (later turn).** The `mcp__rea__*` tools loaded after registration, including `capture_browser_scenario`, `inspect_web_page`, `capture_web_screenshot` and `analyze_web_bundle`. Earlier CLI checks remain valid. |

## 4. Capability matrix (verified in this container)

| Capability | REA command | Status here |
| --- | --- | --- |
| Native binary decompilation (ELF/PE/Mach-O) | `analyze`, `open_binary` family | **Works** (Ghidra) |
| Static JavaScript / Electron app analysis | `analyze-javascript-application` | **Works** |
| Archive / package inventory | `inspect_artifact`, `extract_artifact` | Available |
| .NET managed assemblies | `inspect-managed-artifact` | Available |
| HAR / SAZ / mitmproxy capture inspection | `inspect-web-network-capture` | Available (offline, no fetch) |
| Browser scenario capture (navigate, click, type, network events) | `capture-browser-scenario` | **Blocked by network policy.** Chromium launches and REA attaches over CDP; navigation fails with `ERR_TUNNEL_CONNECTION_FAILED` because the proxy denies the host. Evidence: `evidence/rea/scenario-out.txt`, `scenario2-out.txt`. |
| Page screenshot | `capture-web-screenshot` (CDP) | Same blocker as above |
| Passive page / session observation | `inspect-web-page`, `observe-web-session` | Same blocker; needs a user-driven browser for `observe-web-session` |
| Web bundle analysis | `analyze-web-bundle`, `export-web-scripts` | Same blocker |
| SQLite inspection | `inspect-sqlite-database` | Unavailable (needs Node 24.15+) |
| macOS native, Hopper, IDA, JADX, Kuna | various | Unavailable / not configured |

### Browser launch notes (for repeatability)

- Launch mode (`browser.mode: "launch"`) has no proxy option, so in this
  container use **connect mode**: start Chromium with
  `--remote-debugging-port=9222 --proxy-server=http://127.0.0.1:37873`, then
  pass `{"mode":"connect","cdp_endpoint":"http://127.0.0.1:9222","target_id":…}`.
- The proxy CA is already trusted in the NSS store (`ccr-agent-proxy`). TLS
  verification must not be disabled.
- Allowing a host: environment settings → Network access → add the reference
  application's domains under Allowed domains. See
  https://code.claude.com/docs/en/cloud-environments#network-access.

## 5. What REA can and cannot establish for this project

- A SaaS web application is analysed through **browser scenario capture**
  (observed UI, navigation, network calls and responses for the authenticated
  user) and **static analysis of shipped JavaScript bundles**. Server-side
  logic, database schema and other tenants' data are **not observable** and
  will be marked unverified.
- A desktop or on-premise installation (Electron, .NET, native) can be
  analysed statically from supplied files.
- Exported HAR files recorded by an authorized user can be analysed offline
  without any network allowance.

## 6. Reach attempt against COAST Systems (2026-10-22)

Requested: "fully reverse engineer COAST Systems using REA". Result: **no
analysis possible**; nothing was observed.

| Host | Result |
| --- | --- |
| coastsystems.net, www.coastsystems.net, app.coastsystems.net | Refused by egress proxy |
| coastsystems.com, www.coast-systems.com | Refused by egress proxy |
| www.moldmakingtechnology.com, www.g2.com, www.capterra.com | Refused by egress proxy; WebFetch also failed (`ENOTFOUND`) |

The official product domain and login URL are still **unconfirmed**; web
search returned no sign-in address for the mold platform.
