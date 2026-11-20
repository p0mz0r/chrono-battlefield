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

A parent map body is long: grep it for the ticket's terms (`gh issue view <map> --json body -q .body | grep -n -i '<term>'`) rather than reading it whole.

## Wayfinding operations

Use a GitHub issue as the map and child issues as tickets. Link child tickets as sub-issues when available; otherwise put `Part of #<map>` in the child body. Use issue dependencies for blockers when available, or a `Blocked by: #<n>` line. Assign an issue before starting work. On resolution, comment with the answer, close the issue, and add a context pointer to the map issue. A decision ticket has no PR of its own: its glossary changes go on the map's glossary PR, named in the map's Notes. A ticket that ships a PR closes once it merges, naming the PR in the comment.

- **Frontier**: list the map's open tickets with assignee and labels, then each one's blockers. A ticket is takeable when it is unassigned and every blocker is closed.

  ```sh
  gh api 'repos/p0mz0r/chrono-battlefield/issues/<map>/sub_issues?per_page=100' --jq '.[] | select(.state=="open") | "\(.number)\t\(.assignees|map(.login)|join(","))\t\(.labels|map(.name)|join(","))\t\(.title)"'
  gh api repos/p0mz0r/chrono-battlefield/issues/<n>/dependencies/blocked_by --jq '.[] | "\(.number) \(.state)"'
  ```

- **Edit the map**: other sessions edit it concurrently, so read the body right before changing it and write it straight back. The body comes back with CRLF line endings.

  ```sh
  gh issue view <map> --json body -q .body > map.md   # edit map.md
  gh issue edit <map> --body-file map.md
  ```

