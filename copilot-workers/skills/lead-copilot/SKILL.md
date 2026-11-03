---
name: lead-copilot
description: Lead the team of GitHub Copilot CLI agents that the Copilot Team pane (the copilot-workers plugin) shows. Use when the user asks for the team, Copilot or an agent to implement, fix, review or test something; when deciding whether to hand coding work to an agent or do it yourself; and whenever a message starting "[Copilot Team ·" arrives, which is the user pressing a button in the pane.
---

# Leading the Copilot team

You're the lead. The user is above you and the Copilot agents report to you. The user never talks to the agents: you write each agent's brief, run it, review what comes back and report. The Copilot Team pane only reads the files described here, so keeping them current is how the user sees the work.

Everything lives in the runs folder: the plugin's `runsDir` option, `~/.claude/copilot-runs` when it's empty.

## Catching up

A new session, or one that didn't start the runs, knows nothing about them yet. Before acting on the team, read `team.json`, `lead.json` and the newest logs in the runs folder (`ls -t <runsDir>/copilot-*.log | head`). A log is the run's whole story: the header line says who and what, the `●` lines are its steps, and the end says whether it finished (`AI Credits`), failed (`# exit=` non-zero) or is still going. Check with `pgrep -fl -- "-n <run>"` whether a run without an exit line is still alive. Don't start a member who's already on a live run.

## Team or yourself

- **The team** implements something the user has named (a ticket or a task) in a repo with a build and test loop, when it's more than a handful of edits.
- **You** do anything a few edits settle, fixes from the user's review of the team's work (the context is already in your conversation, and a brief would cost more than the fix), tooling, config, docs and tickets, and anything that needs the user's decisions along the way.
- **When it's unclear**, ask "team or me?" in one line before starting.
- **The user's word wins.** "Use the team" or "do it yourself" overrides all of the above.

Never pick work for the team yourself. A ticket sitting in a backlog isn't approved; confirm the exact ticket or task first, and don't read a vague go-ahead as a yes to a proposal the user never answered. Start a reviewer or tester only when the user asks: they usually look at the implementation first.

## Starting a run

1. **Pick the member** from `roster` in `team.json` and use its model. Never run more agents at once than `seats`, and never spend past `creditBudget` (counted from `budgetSince`). Say in the brief why this member got the task.
2. **Write the brief.** Pin the design down instead of leaving it to the agent: where the code goes (look up how the codebase already handles the same kind of thing: package, naming, log and message formats, API shape), what drives each decision, what's out of scope, and how to verify. Name the run `copilot-<role>-<n>`, with `<n>` counting up across all runs (not per role) and save the brief as `<runsDir>/copilot-<role>-<n>.brief.md` before launching. Save every follow-up prompt the same way.
3. **Launch it in the background**, header first and exit code last:

   ```bash
   RUNS=~/.claude/copilot-runs NAME=copilot-fix-3
   echo "# role=fix model=claude-sonnet-5.5 repo=my-repo job=TICKET-1 member=mid-dev" > "$RUNS/$NAME.log"
   copilot -n "$NAME" --model claude-sonnet-5.5 -p "$(cat "$RUNS/$NAME.brief.md")" --allow-all-tools \
     --deny-tool 'shell(git commit)' --deny-tool 'shell(git push)' --deny-tool 'shell(git add)' \
     --deny-tool 'shell(git reset)' --deny-tool 'shell(git checkout)' --deny-tool 'shell(git worktree)' \
     --deny-tool 'shell(gh:*)' --share "$RUNS/$NAME.md" >> "$RUNS/$NAME.log" 2>&1
   echo "# exit=$?" >> "$RUNS/$NAME.log"
   ```

   `role` is `implement`, `fix`, `review` or `test`. Deny every git command that changes state and all of `gh`: agents never commit, push or open PRs. A reviewer also gets `--deny-tool write`. Without the `# exit=` line the pane can't tell a run that failed to start from a slow one.
4. **Register the job** in `lead.json` if it's new: `jobs["TICKET-1"] = { "title": "…", "tasks": "<absolute path to a markdown checklist>" }`. `tasks` is optional; any file with `- [ ]` / `- [x]` items works, such as an OpenSpec `tasks.md`.

For a follow-up round on the same agent, resume its session (`copilot --resume=<session id>`) into a new log with the next run number, so the pane counts each round's credits on their own.

## When a run ends

- **Exit code non-zero:** the pane shows it as Failed with Copilot's last line. Read the end of the log, tell the user the cause, and relaunch only if they say so.
- **Done:** read the diff and run the build yourself; don't take the agent's summary as proof. Check the change against the user's own instructions (their CLAUDE.md and any rules they've given). Then write `verdicts["copilot-fix-3"] = { "accepted": true|false, "note": "one line" }` in `lead.json`. When you send it back, resume the same session with the corrections.
- Commit, push, open PRs, and post to tickets or wikis only with the user's OK for that step.

## Asking the user

- Questions you need answered go in `lead.json` as `waiting: [{ "id": "…", "text": "…" }]`; remove an item once it's answered.
- More seats, credits or a new member go in `team.json` as `request: { "seats"?: n, "credits"?: n, "hire"?: { "member", "model", "title"? }, "reason": "…" }`. Change nothing else in `team.json`: it's the user's.

## Messages from the pane

Every button sends a short message starting `[Copilot Team · <name>]`. Read them as:

- `Status of <run>?`: read that run's log and say in a few lines how it's going.
- `Stop <run>; what did it finish?`: stop it with `pkill -f -- "-n <run>"` (the run may belong to another session), append `# exit=130` to its log, then report what was done.
- `Verdict on <run>?`: review the round (diff, build), give your verdict and record it in `lead.json`.
- `<run> stopped early. Why? Restart if it makes sense.`: no output for ten minutes and no exit line.
- `<run> failed. Why?`: as under "Exit code non-zero" above.
- `Open seat: propose a hire.`: write one `request.hire` in `team.json`, with the role and model the current jobs need and why in `reason`.
- `Approved: …` / `Declined: …`: the pane has already applied it to `team.json`; on Declined, work within the current team.
- `Removed <title> (<member>) from the team.`: the pane has already taken them off the roster. Give them no new runs; their past runs stay on their jobs.
- `Go ahead: …` / `Not yet: …`: the answer to one of your `waiting` items.

Anything else is the user typing in the message box.
