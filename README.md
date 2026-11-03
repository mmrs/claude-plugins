# copilot-workers

A Team pane for Claude Code. Claude acts as the lead of a small team of [GitHub Copilot CLI](https://github.com/github/copilot-cli) agents: it writes each agent a brief, runs it in the background, reviews what comes back and reports to you. The pane shows that team as it works, so you can see who's busy, what each agent is doing right now, what it cost, and step in without reading log files.

What you get in the pane:

- **Header:** who you are to the lead, how many agents are working against your seat limit, and how many decisions are waiting on you.
- **Credits:** spend against your budget with a meter, roughly how many more agent runs the rest buys, what a run costs on average, and buttons for seats, budget and a new budget period.
- **Needs your decision:** requests from the lead (a hire, more seats or credits) and questions it's waiting on, with Approve/Decline or Go ahead/Not yet.
- **Members:** everyone on the roster with their model and whether they're working, plus open seats you can ask the lead to fill.
- **Jobs:** one card per ticket or task, with task progress counted from the job's checklist (any markdown file with `- [ ]` / `- [x]` items, such as an OpenSpec `tasks.md`; jobs without one simply show no bar), and per member the current step and command, the lead's verdict on its last run, and its runs, credits and time on the job. **▸ Steps** opens what the lead asked and the agent's last steps; **Open brief** and **Open transcript** open the files. Each finished run carries the lead's verdict (accepted or sent back) or, before review, the agent's own summary.
- **Message the lead:** a box that sends your message straight into the Claude session.

Every button sends a message to the Claude session (prefixed `[Team pane · <you>]`); the agents never take orders from the pane directly. On the phone over Remote Control, `/copilot-workers` prints a text snapshot instead.

## Requirements

Claude Code 2.1.309 or later. Older versions refuse the pane's text sizes and weights and draw nothing. The pane is tested on the terminal and desktop surfaces; on the phone over Remote Control, `/copilot-workers` prints a text snapshot.

The pane only shows what the lead writes (see below), so it's empty until you have the [GitHub Copilot CLI](https://github.com/github/copilot-cli) installed and tell Claude to run agents this way.

## Install

At the prompt of a terminal session:

```
/plugin install copilot-workers --marketplace mmrs/copilot-workers
```

Or from a shell:

```bash
claude plugin install copilot-workers --marketplace mmrs/copilot-workers
```

Answer `y` to add the marketplace and pick the user scope. The install then asks for the plugin's options: your name (`ownerName`), which the pane shows as who the lead reports to, and `runsDir` if your runs don't live in `~/.claude/copilot-runs`. Open the pane with `/copilot-workers`.

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `mmrs/copilot-workers`, then **Add plugin**.

## How Claude feeds it

The pane only reads files, so it works with any lead that writes them. Tell Claude about this layout (a memory or `CLAUDE.md` entry works well):

- **Run logs:** each Copilot run writes its output to `<runsDir>/copilot-<name>.log`. The first line is a header the pane parses:

  ```
  # role=fix model=claude-sonnet-5.5 repo=my-repo job=TICKET-1 member=mid-dev
  ```

  Pass `--share <runsDir>/copilot-<name>.md` to get a transcript, and save the brief as `<runsDir>/copilot-<name>.brief.md`. When Copilot returns, append its exit code to the log:

  ```bash
  copilot -p "$(cat brief.md)" … >> "$LOG" 2>&1; echo "# exit=$?" >> "$LOG"
  ```

  A non-zero code marks the run **Failed** right away, with Copilot's last line as the reason (`command not found: copilot`, a sign-in or quota error). Without that line the pane can't tell a failed start from a slow one: a run counts as done when Copilot prints its `AI Credits` summary, and as stopped after ten minutes without output.

- **`team.json`** is yours: `seats`, `creditBudget`, `budgetSince` and a `roster` of `{ member, model, title?, group?, icon? }`. Without an `icon`, the pane picks one from the member's name and title: 💻 developers, 🔍 reviewers, 🧪 QA or testers, 🤖 anyone else. The lead may add a `request` (`{ seats?, credits?, hire?, reason }`) for you to approve in the pane.

- **`lead.json`** is the lead's: `jobs` (`{ "<id>": { title, tasks?, hidden? } }`, where the optional `tasks` is the path to any markdown checklist), `verdicts` on finished rounds (`{ "<log name>": { accepted, note } }`) and `waiting`, the questions it needs you to answer (`[{ id, text }]`).

## Development

Run the test with `claude plugin test copilot-workers`. It mounts the pane on the terminal and desktop surfaces against a fake runs folder and checks the header, the numbered titles, the checklist count, the lead's verdict and the credit totals.

## Licence

MIT
