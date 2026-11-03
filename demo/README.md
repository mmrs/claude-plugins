# Demo runs folder

A made-up team and three jobs for trying the Copilot Team pane without Copilot. Copy it somewhere first, because the pane's buttons write to `team.json` and `lead.json`:

```bash
cp -r demo/runs ~/copilot-team-demo
```

Then set the plugin's `runsDir` option to `~/copilot-team-demo` and open the pane with `/copilot-workers`. Set `runsDir` back to empty for your real runs.

What it shows: API-12 went through a run the lead sent back, a review and an accepted fix; API-15 has a finished run the lead hasn't reviewed yet, plus a question for you; WEB-7's run failed because Copilot wasn't signed in. One seat is open.
