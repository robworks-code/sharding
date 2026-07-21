---
description: Send feedback about the sharding plugin (a bug, an idea, or a drift-check that went wrong) straight to the maintainer's support queue as a ticket. Attaches lightweight context - plugin version, OS, and a short summary of what sharding did this session. Confirms before sending.
argument-hint: "[your feedback]"
allowed-tools: ["Read", "Write", "Bash", "AskUserQuestion"]
disable-model-invocation: true
---

# /sharding:feedback

Turn a quick note about this plugin into a real ticket in the maintainer's support
system (`support.robworks.info`). Use it to report a bug, suggest an idea, or flag a
drift check or phase gate that behaved wrong.

This sends data to an external service, so it **always confirms with you before
sending** and never transmits anything beyond the fields shown in the preview.

## Intake endpoint (fixed)

- **URL:** `https://support.robworks.info/api/feedback`
- **Workspace key:** `wpk_ec93bd65530ac508eec7673cbef1dfbe`  <!-- public intake key; safe in a public repo (published trust boundary) -->
- **source:** `sharding-plugin`

The endpoint is a public intake (no auth token) protected server-side by rate-limiting,
a honeypot, and a source allow-list - so nothing secret ships here.

## Step 1 - Gather the feedback

- If `$ARGUMENTS` is non-empty, that is the feedback body.
- If it is empty, ask the user (one `AskUserQuestion`, or a plain prompt) what they want
  to send. Do not invent feedback.

Then derive:
- **issueType** - pick exactly one of `bug`, `feature`, `question`, `other` from the text
  (a defect -> `bug`, a suggestion -> `feature`, a "how do I" -> `question`, else `other`).
- **subject** - a short (<= 80 char) handle summarizing the body. Default to the first line.

## Step 2 - Assemble lightweight context

Collect only these, nothing more (no contract contents, no shard code, no file paths, no secrets):

```bash
# plugin version
grep -m1 '"version"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
# os
uname -sr
# timestamp (UTC ISO-8601)
date -u +%Y-%m-%dT%H:%M:%SZ
```

- **session_summary** - one short line on what sharding did this session if relevant
  (e.g. "ran shard-check on 2 shards; 1 drift finding on gateway's consumed slice"), else
  omit. Keep it to a sentence; never paste contract, surface, or conversation content.

Email is **optional and off by default** - the ticket is anonymous. Only include an
`email` field if the user explicitly asks to be reachable for a reply, using the address
they give you.

## Step 3 - Write the request body (correct escaping is your job)

Use the **Write** tool to create the JSON body at
`<scratchpad>/sharding-feedback.json` (use the session scratchpad dir). Building it with
Write - not a shell heredoc - avoids any dependency on `jq`/`python` and guarantees the
user's text is escaped correctly. Shape:

```json
{
  "workspaceKey": "wpk_ec93bd65530ac508eec7673cbef1dfbe",
  "source": "sharding-plugin",
  "issueType": "bug",
  "subject": "<subject>",
  "body": "<the full feedback text>",
  "context": {
    "plugin_version": "0.0.5",
    "os": "Darwin 25.5.0",
    "submitted_at": "2026-07-21T18:30:00Z",
    "session_summary": "<optional>"
  }
}
```

Include `email` as a top-level string only if Step 2 decided to. Omit `context` keys you
have no value for rather than sending empty strings.

## Step 4 - Confirm, then send

Print the exact payload (as a fenced `json` block) so the user sees precisely what will
leave the machine. Then ask one `AskUserQuestion` single-select: `Send` / `Edit first` /
`Cancel`.

- **Cancel** - stop; send nothing.
- **Edit first** - take the correction, rewrite the body file, re-print, ask again.
- **Send** - POST it:

```bash
curl -sS -X POST "https://support.robworks.info/api/feedback" \
  -H "Content-Type: application/json" \
  --data @"<scratchpad>/sharding-feedback.json" \
  -w '\nHTTP %{http_code}\n'
```

## Step 5 - Report the result

- **201 / `ok:true`** - print a one-line success with the returned `ticket.url` (the
  maintainer's view). Then delete the temp body file.
- **429 `rate_limited`** - tell the user to try again shortly (respect `Retry-After`).
- **4xx / network failure / no response** - the submission did NOT land. Print the endpoint
  URL and the full payload back to the user so nothing is lost and they can retry or send it
  another way. Never claim success on a non-2xx response.

## Output style
- Plain hyphens (`-`) only. No em-dashes or en-dashes.
- Be concise. Never echo an email address or any secret into the summary.
