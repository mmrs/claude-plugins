# Demo runs folder

A made-up team and three jobs for trying the Copilot Team pane without Copilot. From the repository root, copy it somewhere first, because the pane's buttons write to `team.json` and `lead.json`:

```bash
cp -r plugins/copilot-workers/demo/runs ~/copilot-team-demo
```

Then set the plugin's `runsDir` option to `~/copilot-team-demo` and open the pane with `/copilot-workers`. Set `runsDir` back to empty for your real runs.

What it shows: on API-12, the user asked for a review of the first run, the lead sent that run back with the review's two findings, and the developer fixed them in the same Copilot session, which the lead accepted. API-15 has a finished run the lead hasn't reviewed yet, plus a question for you. WEB-7's run failed because Copilot wasn't signed in. One seat is open. Each brief and agent report follows the format the `lead-copilot` skill asks for, so they double as examples.
