# claude-plugins

Plugins for [Claude Code](https://claude.com/claude-code), installable from this repository as the `mmrs` marketplace.

| Plugin | What it does |
| --- | --- |
| [copilot-workers](plugins/copilot-workers) | A Copilot Team pane: Claude leads a team of GitHub Copilot CLI agents, and the pane shows who's working, what each run did and cost, and the decisions waiting on you. Ships the `lead-copilot` skill that teaches Claude to run the team. |

Install a plugin at the prompt of a terminal session:

```
/plugin install <plugin> --marketplace mmrs/claude-plugins
```

In the desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `mmrs/claude-plugins`, then **Add plugin**. Each plugin's README has its requirements and options.

## Licence

MIT
