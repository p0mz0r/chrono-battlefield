# Coding standards

Read at review. Each rule is a judgement call; typecheck, lint and tests run in the pre-commit hook and CI. A finding that is a fixed syntax pattern becomes a rule in `.oxlintrc.json` instead of a line here.

## Domain vocabulary

Names, captions, feed lines and comments use the terms in `GLOSSARY.md`, avoiding its _Avoid_ words. A new on-stream concept or race rule gets its glossary entry in the same change.

## Headless race

All race rules live in `src/race/race.ts`: plain data stepped by `tickRace`, no rendering, replayable from the race seed. `view.ts`, `camera.ts` and `main.ts` only read race state. A fact two of them derive the same way (such as "the big event playing now") is one exported helper in `race.ts`.

## Shortcuts

A deliberate shortcut with a known limit carries a `ponytail:` comment naming the limit and when to upgrade it.

## Style

Match the surrounding code: terse, dense lines; one-line comments that say why; doc comments on exported types and functions. A test names the behaviour in domain words and asserts against a value worked out independently of the code.
