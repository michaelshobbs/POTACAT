# iOS / Android (ECHOCAT) Handoffs — MOVED

All mobile-handoff briefings have moved to a single source of truth:

**`D:\Projects\potacat-meta\work\`**

Use the master index at `D:\Projects\potacat-meta\WORK.md` to find:

- Open mobile bugs and features → `potacat-meta/work/open/`
- In-progress items → `potacat-meta/work/in-progress/`
- Waiting on user reply → `potacat-meta/work/waiting-on-user/`
- Waiting on a decision from Casey → `potacat-meta/work/waiting-on-decision/`
- Closed (resolved, kept for record) → `potacat-meta/work/closed/`

## When you finish an item

1. `mv` it from `work/open/` (or `work/in-progress/`) to `work/closed/`.
2. Append a `## Resolution` section: commit(s), version released (or "merged, not yet released"), one-sentence summary of the fix, how it was tested.
3. Leave the file in `closed/` as a searchable record

The orchestrator session in `potacat-meta` maintains `WORK.md`. When you start a mobile coding session, the orchestrator will tell you which file to read.

The file naming convention has stayed the same (slug.md) so you can locate items by name across the consolidated directory.
