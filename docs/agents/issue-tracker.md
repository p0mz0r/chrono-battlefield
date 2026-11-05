# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** Leave this off unless the repo later chooses to triage external PRs as requests.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `p0mz0r/chrono-battlefield`.

## When a skill says "fetch the relevant ticket"

Read it with `gh issue view <number> --json number,title,body,labels,comments`. The human view with `--comments` prints nothing on an issue with no comments.

## Wayfinding operations

Use a GitHub issue as the map and child issues as tickets. Link child tickets as sub-issues when available; otherwise put `Part of #<map>` in the child body. Use issue dependencies for blockers when available, or a `Blocked by: #<n>` line. Assign an issue before starting work, comment with the resolution, then close it and add a context pointer to the map issue.

