---
name: commit-conventions
description: How to commit and publish changes in this repo — straight to master through the GitHub API with gh, no feature branches, and the house style for commit messages. Use whenever committing, pushing or shipping work here.
---

# Commit conventions

## Where commits go

- Commit straight to `master`. No feature branch, no PR, unless the user
  asks for one for a particular change.
- Every push to `master` that touches the app ships a signed release
  (`.github/workflows/release.yml`): the workflow bumps the patch version
  and commits `Release vX.Y.Z` back to master itself. Don't bump
  `package.json` by hand for an ordinary change; do it only for a minor
  or major version the user asks for.
- Pushes that only touch `**.md`, `test/**`, `.github/ISSUE_TEMPLATE/**`
  or `.claude/**` don't release.
- Before committing, run `npm test` and `npm run typecheck`. Both have to
  pass.

## Use gh, not git

Publish with `gh`, not `git commit` / `git push`. Write the commit
through the GitHub git-data API, on top of the current remote master:

1. `gh api repos/{owner}/{repo}/git/ref/heads/master` gives the head
   commit; `gh api repos/{owner}/{repo}/git/commits/<sha>` gives its tree.
2. For each changed file, `POST repos/{owner}/{repo}/git/blobs` with the
   content base64-encoded (`{"content": ..., "encoding": "base64"}`).
   Convert CRLF to LF first. The Windows checkout has CRLF
   (`core.autocrlf`) and the repo stores LF (`.gitattributes` has
   `text=auto`), and the API stores exactly what it's sent. Raw bytes
   would rewrite every line of the file in history. Leave binary files
   (png, ico) as they are.
   Check afterwards with `git fetch`, then compare
   `git hash-object <file>` with `git rev-parse origin/master:<file>`
   for each one. They should match.
3. `POST .../git/trees` with `base_tree` set to the head's tree and one
   entry per file (`path`, `mode: "100644"`, `type: "blob"`, `sha`). A
   deleted file is an entry with `"sha": null`.
4. `POST .../git/commits` with the message, the new tree and
   `parents: [<head sha>]`.
5. `PATCH .../git/refs/heads/master` with `{"sha": <new commit>}`, and
   no force. If master moved in the meantime this fails: start again
   from step 1.

Pass JSON bodies to `gh api --input <file>`, not `-f`, so big contents
and newlines survive. Make sure the files you send are based on the
current remote master. If the local branch is behind, compare first so
you don't overwrite someone else's change.

Afterwards, check the release workflow run with `gh run list` /
`gh run watch`. Read-only local git (`git status`, `git diff`,
`git log`) is fine for looking at changes.

## Messages

- Subject: a plain sentence in the imperative saying what changed for
  the person using the app, with an optional colon clause giving the
  how. Example: `Stop low-latency ink flickering: a pen-only ink layer,
  no prediction`. No `feat:`/`fix:` prefixes, no trailing full stop.
- Body: wrapped at about 72 columns. Say what was wrong or missing, then
  what the change does and why it's built that way, in the same plain
  prose as the code comments.
- End with the attribution trailer the session gives, e.g.
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
