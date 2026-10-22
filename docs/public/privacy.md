# Privacy and support boundaries

The server binds only to IPv4 loopback. Do not expose it through a reverse proxy or tunnel. Local processes can access the local observational API; loopback is not a multi-user authentication boundary. Managed messaging has separate scoped credentials stored in private local files.

The connection indicator describes the local observation connection, not agent progress. The viewer shows the last recorded event time separately from the last snapshot check time (in its tooltip). Missing timestamps remain unknown; old records alone do not prove that an agent has stopped. A known source-read error remains visible across reconnection until a new readable snapshot replaces it.

Default startup selects no transcript, enables no catalog, starts no model, and exports nothing. The demo is a browser fixture and does not fetch session content. An explicit source selection authorizes reading that transcript and the matching child records evidenced by its current turn. Normalized graph events omit raw command arguments, tool outputs, and reasoning. Paths and labels can still contain personal or project information; inspect screenshots before sharing them.

The optional catalog reads parent headers, timestamps, and title metadata. Titles can be sensitive. It limits candidates and skips ambiguous/duplicate entries. Catalog permission is not permission to read all conversation bodies. A selected session is opened for its graph.

Message bodies and worker results are a separate, explicit local feature. Native hooks attach only supported plaintext events with matching scope. Native encrypted messages stay unavailable. Observer-managed messages are saved before execution; a queued receipt is not provider acceptance or successful completion. Known credential forms are redacted, but redaction is not a guarantee that arbitrary sensitive text is removed. Keep stores and backups private. Acknowledged manual-mailbox bodies expire after seven days; managed conversation history and retry receipts remain until the owner removes the store. Stop the server before removing persistent stores.

Exports require an explicit export configuration. They carry normalized metadata, not raw message bodies. Tests of adapters do not prove a destination received anything. Verify the intended destination and read back records separately. The demo does not activate exporters.

| Capability | Release-candidate scope |
| --- | --- |
| macOS Apple Silicon local server | First supported validation target |
| Linux / Intel macOS / Windows | No binary release or live support claim in this candidate |
| Codex Desktop transcript, children, tool and skill events | Available; source formats are version-dependent |
| Native Codex message plaintext | May be unavailable; cannot decrypt |
| Observer-managed Codex workers | Read-only worker mode; explicit setup and provider login required |
| Claude Code capture/runtime adapters | Experimental; live authenticated worker verification remains TODO |
| Langfuse / OTLP / LangSmith export adapters | Optional metadata adapters; destination verification is separate |
| English interface | Documentation available; interface translation remains TODO |

This release is an observer, not a skill evaluator, an audit log with completeness guarantees, or a general-purpose autonomous coding team. Missing events remain unknown.
