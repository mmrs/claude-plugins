import type { EngineInterface, Register, RenderInput } from 'claude-code'

const PANE = 'copilot-workers'
const TITLE = 'Copilot Team'
// Set in session.start from the plugin's options: the runs folder and the name of the person the lead reports to.
let LOG_DIR = ''
// Owned by the person (seats, budget, roster) and answered here; the lead only adds `request`.
let TEAM_FILE = ''
// Owned by the lead: jobs, verdicts on rounds, and what waits on the person.
let LEAD_FILE = ''
let OWNER = 'You'
// No output for this long without the end-of-run stats means the run died.
const STALE_MS = 10 * 60 * 1000
const MAX_JOBS = 4
let CREDIT_STEP = 500
let WARN_AT = 0.85
let PERIOD_BUDGET: number | undefined
const from = () => `[Copilot Team · ${OWNER}]`

let sent = 0
// What's folded in the pane, kept in the plugin's store so a restart opens it the same way.
let showHidden = false
let showChart = true
let showCredits = true
// Member cards opened with Details, by job and member.
const expanded = new Set<string>()
// Job cards folded down to their title row.
const collapsedJobs = new Set<string>()
const FOLDS = 'folds'
type Folds = { showHidden?: boolean; showChart?: boolean; showCredits?: boolean; expanded?: string[]; collapsedJobs?: string[] }
// The member whose Remove is waiting for a second press; a reload forgets it.
let removing: string | undefined
const DETAIL_STEPS = 10

type Status = 'running' | 'done' | 'failed' | 'stopped'

type Round = {
  name: string
  role: string
  model: string
  repo: string
  job: string
  member: string
  session: string
  status: Status
  step: string
  stepFailed: boolean
  command: string
  summary: string
  failedSteps: number
  recent: { failed: boolean; title: string; command: string }[]
  ageMs: number
  mtimeMs: number
  totalCredits: number
  totalSeconds: number
  credits: number
  seconds: number
  changes?: string
  transcript?: string
  brief?: { path: string; asked: string }
  verdict?: Verdict
}

type Member = { member: string; model: string; rounds: Round[]; latest: Round; credits: number; seconds: number }

type Job = { id: string; title: string; tasks?: string; hidden: boolean; done: number; total: number; members: Member[]; rounds: Round[]; credits: number }

type Team = {
  seats: number
  creditBudget: number
  budgetSince: number
  roster?: RosterEntry[]
  request?: { seats?: number; credits?: number; hire?: Hire; reason: string }
  // Credits of cleaned-up rounds in this budget period, so cleaning up doesn't lower the spend.
  cleanedCredits?: number
}

type RosterEntry = { member: string; model: string; title?: string; group?: string; icon?: string }

type Hire = RosterEntry

const describeRequest = (r: NonNullable<Team['request']>) => {
  const asks = [
    r.hire ? `hiring a ${r.hire.title ?? r.hire.member} on ${r.hire.model.replace('claude-', '')}${r.hire.group ? ` (${r.hire.group})` : ''}` : '',
    r.seats ? `${r.seats} more seat(s)` : '',
    r.credits ? `${r.credits} more credits` : '',
  ].filter(Boolean)
  return `Lead proposes ${asks.join(' and ')}: ${r.reason}`
}

type Verdict = { accepted: boolean; note: string }

type Lead = {
  jobs: Record<string, { title: string; tasks?: string; hidden?: boolean }>
  verdicts: Record<string, Verdict>
  waiting: { id: string; text: string }[]
}

const DEFAULT_TEAM: Team = { seats: 2, creditBudget: 1000, budgetSince: 0 }
const DEFAULT_LEAD: Lead = { jobs: {}, verdicts: {}, waiting: [] }

const ago = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
    : seconds >= 60
      ? `${Math.round(seconds / 60)}m`
      : `${seconds}s`

// Copilot prints "(1h 2m 3s)", "(4m 24s)" or "(45s)".
const parseSeconds = (text: string) =>
  [...text.matchAll(/(\d+)([hms])/g)].reduce(
    (sum, [, n, unit]) => sum + Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1),
    0,
  )

// A roster entry can set its own icon; otherwise it's guessed from the member's name and title.
const roleIcon = (entry: { member: string; title?: string; icon?: string }) => {
  if (entry.icon) return entry.icon
  const role = `${entry.member} ${entry.title ?? ''}`.toLowerCase()
  if (role.includes('review')) return '🔍'
  if (role.includes('qa') || role.includes('test')) return '🧪'
  if (role.includes('dev') || role.includes('engineer') || role.includes('implement')) return '💻'
  return '🤖'
}

// One pair of icons for every collapsible part: open shows ▾, closed shows ▸.
const chevron = (open: boolean) => (open ? '▼' : '▶')

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Logs started before the header line existed: role from the file name.
const legacyRole = (name: string) =>
  name.includes('review') ? 'review' : name.endsWith('run1') ? 'implement' : 'fix'

const parse = (name: string, text: string, mtimeMs: number, now: number, hasTranscript: boolean): Round => {
  const header = /^# (.*)$/.exec(text.split('\n', 1)[0] ?? '')?.[1] ?? ''
  const meta: Record<string, string> = Object.fromEntries(header.split(' ').map(pair => pair.split('=')))
  const steps = [...text.matchAll(/^([●✗]) (.+)$/gm)]
  const last = steps.at(-1)
  const afterLast = last ? text.slice((last.index ?? 0) + last[0].length) : ''
  const stats = /^AI Credits\s+([\d.]+)\s*\(([^)]*)\)/m.exec(text)
  const ageMs = now - mtimeMs
  // The lead appends "# exit=<code>" once Copilot returns, so a run that failed to start doesn't look like it's working.
  const exit = /^# exit=(\d+)\s*$/m.exec(text)
  // 130 and 143 are a run that was interrupted or killed on purpose, not one that broke.
  const stoppedOnPurpose = exit?.[1] === '130' || exit?.[1] === '143'
  const status: Status = stoppedOnPurpose
    ? 'stopped'
    : exit && exit[1] !== '0'
      ? 'failed'
      : stats || exit
        ? 'done'
        : ageMs < STALE_MS
          ? 'running'
          : 'stopped'
  const lastOutput = text
    .slice(0, exit?.index)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('# '))
    .at(-1)
  // The final answer sits between the last tool block and the export line.
  const answer = afterLast.split(/^\s+└.*$/m).at(-1)?.split(/^Session exported/m)[0] ?? ''
  const role = meta.role ?? legacyRole(name)

  return {
    name,
    role,
    model: meta.model ?? '?',
    repo: meta.repo ?? '?',
    job: meta.job ?? 'other',
    member: meta.member ?? (role === 'review' ? 'reviewer' : 'implementer'),
    session: /--resume=(\S+)/.exec(text)?.[1] ?? name,
    status,
    step: last?.[2] ?? 'starting',
    stepFailed: last?.[1] === '✗',
    command: /^\s+│ (.+)$/m.exec(afterLast)?.[1]?.trim() ?? '',
    summary:
      status === 'done'
        ? (answer.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#')) ?? '')
        : status === 'failed'
          ? (lastOutput ?? `exit code ${exit?.[1]}`)
          : '',
    failedSteps: steps.filter(step => step[1] === '✗').length,
    recent: steps.slice(-DETAIL_STEPS).map(step => {
      const after = text.slice((step.index ?? 0) + step[0].length)
      const next = /^[●✗] /m.exec(after)
      const block = next ? after.slice(0, next.index) : after
      return { failed: step[1] === '✗', title: step[2] ?? '', command: /^\s+│ (.+)$/m.exec(block)?.[1]?.trim() ?? '' }
    }),
    ageMs,
    mtimeMs,
    totalCredits: Number(stats?.[1] ?? 0),
    totalSeconds: parseSeconds(stats?.[2] ?? ''),
    credits: 0,
    seconds: 0,
    changes: /^Changes\s+(.+)$/m.exec(text)?.[1],
    transcript: hasTranscript ? `${LOG_DIR}/${name}.md` : undefined,
  }
}

// A clone or a copied folder writes every file within a few seconds, in name order, so file times that close
// say nothing about which run came first; the run number (copilot-<role>-<n>) does.
const SAME_WRITE_MS = 10_000
const runNumber = (name: string) => Number(/-(\d+)$/.exec(name)?.[1] ?? 0)
const oldestFirst = (a: Round, b: Round) =>
  Math.abs(a.mtimeMs - b.mtimeMs) < SAME_WRITE_MS && runNumber(a.name) !== runNumber(b.name)
    ? runNumber(a.name) - runNumber(b.name)
    : a.mtimeMs - b.mtimeMs

// A resumed Copilot session reports running totals, so a round's own share is the step from the round before.
const withDeltas = (rounds: Round[]) => {
  const previous = new Map<string, Round>()
  return [...rounds]
    .sort(oldestFirst)
    .map(round => {
      const before = previous.get(round.session)
      previous.set(round.session, round)
      return {
        ...round,
        credits: Math.max(0, round.totalCredits - (before?.totalCredits ?? 0)),
        seconds: Math.max(0, round.totalSeconds - (before?.totalSeconds ?? 0)),
      }
    })
}

const readJson = async <T,>($: EngineInterface, path: string, fallback: T): Promise<T> => {
  const text = await $.fs.read(path).catch(() => '')
  try {
    return { ...fallback, ...(text ? JSON.parse(text) : {}) }
  } catch {
    return fallback
  }
}

const loadTeam = ($: EngineInterface) => readJson($, TEAM_FILE, DEFAULT_TEAM)
const saveTeam = ($: EngineInterface, team: Team) => $.fs.write(TEAM_FILE, `${JSON.stringify(team, null, 2)}\n`)

const loadRounds = async ($: EngineInterface, lead: Lead): Promise<Round[]> => {
  const now = await $.clock.now()
  const entries = await $.fs.list(LOG_DIR).catch(() => [])
  const names = new Set(entries.map(entry => entry.name))
  const rounds = await Promise.all(
    entries
      .filter(entry => entry.name.startsWith('copilot-') && entry.name.endsWith('.log'))
      .map(async entry => {
        const name = entry.name.slice(0, -'.log'.length)
        const text = await $.fs.read(`${LOG_DIR}/${entry.name}`).catch(() => '')
        const round = parse(name, text, entry.mtimeMs, now, names.has(`${name}.md`))
        const briefName = [`${name}.brief.md`, `${name}.brief.txt`].find(candidate => names.has(candidate))
        if (!briefName) return round
        const briefText = await $.fs.read(`${LOG_DIR}/${briefName}`).catch(() => '')
        const asked = briefText.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 3).join(' ')
        return { ...round, brief: { path: `${LOG_DIR}/${briefName}`, asked } }
      }),
  )
  return withDeltas(rounds).map(round => ({ ...round, verdict: lead.verdicts[round.name] }))
}

const loadJobs = async ($: EngineInterface, rounds: Round[], lead: Lead): Promise<Job[]> => {
  const ids = [...new Set(rounds.map(round => round.job))]
  const jobs = await Promise.all(
    ids.map(async id => {
      const jobRounds = rounds.filter(round => round.job === id)
      // A relative path is read from the runs folder, so a runs folder can be moved or shipped as a demo.
      const listed = lead.jobs[id]?.tasks
      const tasks = listed && !listed.startsWith('/') ? `${LOG_DIR}/${listed}` : listed
      const text = tasks ? await $.fs.read(tasks).catch(() => '') : ''
      const memberNames = [...new Set(jobRounds.map(round => round.member))]
      const members = memberNames.map(member => {
        const own = jobRounds.filter(round => round.member === member)
        const latest = own.at(-1)!
        return {
          member,
          model: latest.model,
          rounds: own,
          latest,
          credits: own.reduce((sum, round) => sum + round.credits, 0),
          seconds: own.reduce((sum, round) => sum + round.seconds, 0),
        }
      })
      return {
        id,
        hidden: Boolean(lead.jobs[id]?.hidden),
        title: lead.jobs[id]?.title ?? '',
        tasks,
        done: (text.match(/^\s*[-*+] \[[xX]\]/gm) ?? []).length,
        total: (text.match(/^\s*[-*+] \[[ xX]\]/gm) ?? []).length,
        members,
        rounds: jobRounds,
        credits: members.reduce((sum, member) => sum + member.credits, 0),
      }
    }),
  )
  // Newest job first: rounds are oldest first, so a job's last round is its newest.
  return jobs.sort((a, b) => oldestFirst(b.rounds.at(-1)!, a.rounds.at(-1)!))
}

const loadAll = async ($: EngineInterface) => {
  const [team, lead] = await Promise.all([loadTeam($), readJson($, LEAD_FILE, DEFAULT_LEAD)])
  const rounds = await loadRounds($, lead)
  const jobs = await loadJobs($, rounds, lead)
  return { team, lead, rounds, jobs }
}

const insights = (rounds: Round[], team: Team) => {
  const finished = rounds.filter(round => round.status === 'done')
  const judged = finished.filter(round => round.verdict)
  const accepted = judged.filter(round => round.verdict?.accepted).length
  const spent = Math.round(
    (team.cleanedCredits ?? 0) + rounds.filter(r => r.mtimeMs >= team.budgetSince).reduce((sum, r) => sum + r.credits, 0),
  )
  const avgCredits = finished.length ? finished.reduce((sum, r) => sum + r.credits, 0) / finished.length : 0
  const avgSeconds = finished.length ? finished.reduce((sum, r) => sum + r.seconds, 0) / finished.length : 0
  const left = team.creditBudget - spent
  return {
    spent,
    left,
    roundsLeft: avgCredits > 0 ? Math.floor(Math.max(0, left) / avgCredits) : undefined,
    avgCredits: Math.round(avgCredits),
    avgSeconds: Math.round(avgSeconds),
    accepted,
    judged: judged.length,
    blocked: rounds.reduce((sum, r) => sum + r.failedSteps, 0),
  }
}

type ChartMember = { member: string; title: string; icon: string; model: string; working: boolean; job?: string }
type ChartLine = { prefix: string; group?: string; member?: ChartMember }

// Two members with the same title, like a second Snr. Developer, get a number so they can be told apart.
const rosterTitles = (team: Team) => {
  const seen = new Map<string, number>()
  return new Map(
    (team.roster ?? []).map(entry => {
      const base = entry.title ?? titleCase(entry.member.replace(/-/g, ' '))
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return [entry.member, n > 1 ? `${base} ${n}` : base] as const
    }),
  )
}

const memberTitle = (titles: Map<string, string>, member: string) =>
  titles.get(member) ?? titleCase(member.replace(/-/g, ' '))

const branch = (isLast: boolean) => (isLast ? '└─ ' : '├─ ')
const stem = (isLast: boolean) => (isLast ? '   ' : '│  ')

// The roster in team.json is who is on the team; without one, whoever has worked. Members sharing a
// `group` sit under one heading. Seats cap how many work at once, so spare seats show as open.
const orgChart = (rounds: Round[], team: Team): ChartLine[] => {
  const latest = new Map<string, Round>()
  for (const round of [...rounds].sort(oldestFirst)) latest.set(round.member, round)
  const roster: RosterEntry[] =
    team.roster ?? [...latest.entries()].map(([member, round]) => ({ member, model: round.model }))
  const titles = rosterTitles(team)
  const toMember = ({ member, model, title, icon }: RosterEntry): ChartMember => {
    const active = rounds.find(round => round.member === member && round.status === 'running')
    return { member, title: titles.get(member) ?? title ?? titleCase(member.replace(/-/g, ' ')), icon: roleIcon({ member, title, icon }), model, working: Boolean(active), job: active?.job }
  }
  const nodes: { group?: string; members: typeof roster }[] = []
  for (const entry of roster) {
    const last = nodes.at(-1)
    if (entry.group && last?.group === entry.group) last.members.push(entry)
    else nodes.push({ group: entry.group, members: [entry] })
  }
  const openSeats = Math.max(0, team.seats - roster.length)
  const all: ({ group?: string; members: typeof roster } | undefined)[] = [...nodes, ...Array.from({ length: openSeats }, () => undefined)]
  return all.flatMap((node, i) => {
    const isLast = i === all.length - 1
    if (!node) return [{ prefix: `   ${branch(isLast)}` }]
    if (!node.group) return [{ prefix: `   ${branch(isLast)}`, member: toMember(node.members[0]!) }]
    return [
      { prefix: `   ${branch(isLast)}`, group: node.group },
      ...node.members.map((entry, j) => ({
        prefix: `   ${stem(isLast)}${branch(j === node.members.length - 1)}`,
        member: toMember(entry),
      })),
    ]
  })
}

// Every control on a member goes to the lead (the Claude session), who instructs the workers.
const ASKS: Record<Status, { label: string; ask: (m: Member) => string }[]> = {
  running: [{ label: '⏹ Stop', ask: m => `Stop ${m.latest.name}; what did it finish?` }],
  done: [{ label: '🧾 Verdict', ask: m => `Verdict on ${m.latest.name}?` }],
  failed: [{ label: '🔍 Why?', ask: m => `${m.latest.name} failed. Why?` }],
  stopped: [
    {
      label: '🔁 Restart',
      ask: m => `${m.latest.name} stopped early. Why? Restart if it makes sense.`,
    },
  ],
}

const teamSnapshot = async ($: EngineInterface) => {
  const { team, lead, rounds, jobs } = await loadAll($)
  const stats = insights(rounds, team)
  const titles = rosterTitles(team)
  const running = rounds.filter(r => r.status === 'running').length
  const waiting = [
    ...(team.request ? [describeRequest(team.request)] : []),
    ...lead.waiting.map(item => `Waiting on you: ${item.text}`),
  ]
  const jobLines = jobs.filter(job => !job.hidden).slice(0, MAX_JOBS).flatMap(job => [
    `${job.id}${job.title ? ` · ${job.title}` : ''}${job.total ? ` · ${job.done}/${job.total} tasks` : ''} · ${Math.round(job.credits)} credits`,
    ...job.members.map(m => {
      const detail = m.latest.status === 'running' ? m.latest.step : (m.latest.verdict?.note ?? m.latest.summary)
      const title = memberTitle(titles, m.member)
      const runs = `${m.rounds.length} run${m.rounds.length === 1 ? '' : 's'}`
      return `  • ${title} ${m.latest.status} · ${runs} · ${Math.round(m.credits)} credits${detail ? ` — ${detail.slice(0, 90)}` : ''}`
    }),
  ])
  return [
    `Copilot Team: ${running}/${team.seats} working · credits ${stats.spent}/${team.creditBudget}`,
    ...waiting,
    ...jobLines,
  ].join('\n')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    OWNER = String(options.ownerName ?? '').trim() || 'You'
    CREDIT_STEP = Number(options.creditStep) > 0 ? Number(options.creditStep) : 500
    WARN_AT = Number(options.warnAtPercent) > 0 ? Number(options.warnAtPercent) / 100 : 0.85
    PERIOD_BUDGET = Number(options.creditBudget) > 0 ? Number(options.creditBudget) : undefined
    const home = (await $.process.run(['printenv', 'HOME']).catch(() => undefined))?.stdout.trim() ?? ''
    LOG_DIR = String(options.runsDir ?? '').trim().replace(/^~(?=\/|$)/, home) || `${home}/.claude/copilot-runs`
    TEAM_FILE = `${LOG_DIR}/team.json`
    LEAD_FILE = `${LOG_DIR}/lead.json`
    const folds = ((await $.store.get(FOLDS).catch(() => undefined)) ?? {}) as Folds
    showHidden = folds.showHidden ?? showHidden
    showChart = folds.showChart ?? showChart
    showCredits = folds.showCredits ?? showCredits
    folds.expanded?.forEach(id => expanded.add(id))
    folds.collapsedJobs?.forEach(id => collapsedJobs.add(id))
    await $.command.register({ name: 'copilot-workers', description: 'Show the Copilot Team pane: the Copilot workers Claude leads' })
    void $.ui.open({ id: PANE, title: TITLE })
    let shown = ''
    $.clock.every(3000, () => {
      $.ui.invalidate('ui.render')
      void loadAll($).then(({ team, lead, rounds }) => {
        const running = rounds.filter(r => r.status === 'running').length
        const asks = (team.request ? 1 : 0) + lead.waiting.length
        const line = [running > 0 ? `${running}/${team.seats} working` : '', asks > 0 ? `${asks} waiting on you` : '']
          .filter(Boolean)
          .join(' · ')
        if (line !== shown) {
          shown = line
          $.ui.status(line ? `team: ${line}` : undefined)
        }
      })
    })

    return next(e)
  })

  on('command.run', { command: 'copilot-workers' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: await teamSnapshot($) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawTeam($, e, e.props.bodyColumns))
  // Where plugin drawing reaches, the output row becomes the live team view; elsewhere (the phone
  // over Remote Control) the snapshot text shows instead.
  on('ui.render', { component: 'CommandOutput', props: { command: 'copilot-workers' } }, ($, e) =>
    drawTeam($, e, e.viewport?.columns),
  )
}

const STATUS_UI: Record<Status, { label: string; color: string }> = {
  running: { label: 'Working', color: 'warning' },
  done: { label: 'Done', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  stopped: { label: 'Stopped', color: 'error' },
}

const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// "claude-sonnet-5.5" -> "Sonnet 5.5"
const modelName = (model: string) =>
  model.replace(/^claude-/, '').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase())

// macOS has `open`, most Linux desktops `xdg-open`.
const openFile = ($: EngineInterface, path: string) =>
  void $.process.run(['open', path]).catch(() => $.process.run(['xdg-open', path]))

const drawTeam = async ($: EngineInterface, e: RenderInput<'Pane' | 'CommandOutput'>, columns?: number) => {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button } = elements
  const Input = 'Input' in elements ? elements.Input : undefined
  const [{ team, lead, rounds, jobs }, now] = await Promise.all([loadAll($), $.clock.now()])
  const stats = insights(rounds, team)
  const width = Math.max(20, (columns ?? 60) - 4)
  // A wider pane lays members, cards and jobs out side by side instead of one long column.
  const columnsFor = (minWidth: number, max: number) => Math.max(1, Math.min(max, Math.floor(width / minWidth)))
  const share = (n: number) => `${Math.floor(100 / n) - (n > 1 ? 1 : 0)}%`
  const memberCols = columnsFor(46, 3)
  const jobCols = columnsFor(70, 2)
  const tell = (text: string) => void $.prompt.submit({ text: `${from()} ${text}` })
  const redraw = () => $.ui.invalidate('ui.render')
  const change = (fn: (team: Team) => Team) => void loadTeam($).then(current => saveTeam($, fn(current))).then(redraw)
  // An answered item leaves the list at once, so a second press can't send the answer twice.
  const answer = (item: Lead['waiting'][number], reply: string) => {
    tell(`${reply}: ${item.text}`)
    void readJson($, LEAD_FILE, DEFAULT_LEAD)
      .then(current => $.fs.write(LEAD_FILE, `${JSON.stringify({ ...current, waiting: current.waiting.filter(w => w.id !== item.id) }, null, 2)}\n`))
      .then(redraw)
  }
  const titles = rosterTitles(team)
  const inRoster = new Set((team.roster ?? []).map(entry => entry.member))
  // Remove and Decline only change team.json, which the lead reads before it acts, so they cost no Claude turn.
  const remove = (member: string) => {
    removing = undefined
    change(t => ({ ...t, roster: (t.roster ?? []).filter(entry => entry.member !== member) }))
  }
  const titleOf = (member: string) => memberTitle(titles, member)
  const iconOf = (member: string) => roleIcon(team.roster?.find(entry => entry.member === member) ?? { member })
  // A hidden job keeps its history on disk; it only leaves the default view.
  const setHidden = (id: string, hidden: boolean) =>
    void readJson($, LEAD_FILE, DEFAULT_LEAD)
      .then(current =>
        $.fs.write(
          LEAD_FILE,
          `${JSON.stringify({ ...current, jobs: { ...current.jobs, [id]: { ...(current.jobs[id] ?? { title: '' }), hidden } } }, null, 2)}\n`,
        ),
      )
      .then(redraw)
  // Moves the job's logs and transcripts to archive/<job>/ (recoverable) and forgets its verdicts.
  const cleanUp = async (job: Job) => {
    const dest = `${LOG_DIR}/archive/${job.id.replace(/[^A-Za-z0-9._-]/g, '_')}`
    const files = (await $.fs.list(LOG_DIR).catch(() => []))
      .map(entry => entry.name)
      .filter(name => job.rounds.some(round => name === `${round.name}.log` || name === `${round.name}.md`))
      .map(name => `${LOG_DIR}/${name}`)
    const ok = (argv: string[]) => $.process.run(argv).then(result => result.exitCode === 0, () => false)
    if (!(await ok(['mkdir', '-p', dest])) || (files.length > 0 && !(await ok(['mv', ...files, dest])))) {
      $.ui.toast(`Couldn't move the logs to ${dest}; the job and its verdicts are kept.`)
      return
    }
    const lead = await readJson($, LEAD_FILE, DEFAULT_LEAD)
    const { [job.id]: _removed, ...jobs } = lead.jobs
    const verdicts = Object.fromEntries(
      Object.entries(lead.verdicts).filter(([name]) => !job.rounds.some(round => round.name === name)),
    )
    await $.fs.write(LEAD_FILE, `${JSON.stringify({ ...lead, jobs, verdicts }, null, 2)}\n`)
    const counted = job.rounds.filter(r => r.mtimeMs >= team.budgetSince).reduce((sum, r) => sum + r.credits, 0)
    change(t => ({ ...t, cleanedCredits: (t.cleanedCredits ?? 0) + counted }))
  }
  const toggle = (set: () => void) => () => {
    set()
    const folds: Folds = { showHidden, showChart, showCredits, expanded: [...expanded], collapsedJobs: [...collapsedJobs] }
    void $.store.set(FOLDS, folds).catch(() => undefined)
    redraw()
  }

  const shownJobs = jobs.filter(job => showHidden || !job.hidden)
  const hiddenCount = jobs.filter(job => job.hidden).length
  const running = rounds.filter(r => r.status === 'running').length
  const request = team.request
  const attention = (request ? 1 : 0) + lead.waiting.length
  const topCols = attention > 0 ? columnsFor(60, 2) : 1
  const chart = orgChart(rounds, team)
  const overBudget = stats.spent > team.creditBudget
  const budgetShare = team.creditBudget > 0 ? stats.spent / team.creditBudget : 0

  // Percentage widths, not a row of characters: the bar fills its container on every surface and at any width.
  const meter = (key: string, share: number, color: string) => {
    const pct = Math.round(Math.min(1, Math.max(0, share)) * 100)
    return (
      <Box key={key} flexGrow={1} minWidth={0} flexDirection="row" overflow="hidden">
        {pct > 0 && (
          <Box key={`${key}-done`} width={0} minWidth={0} flexGrow={pct} backgroundColor={color} overflow="hidden">
            <Text> </Text>
          </Box>
        )}
        {pct < 100 && (
          <Box key={`${key}-rest`} width={0} minWidth={0} flexGrow={100 - pct} backgroundColor="subtle" overflow="hidden">
            <Text> </Text>
          </Box>
        )}
      </Box>
    )
  }

  // paddingRight puts heading arrows in line with the arrows inside the bordered boxes below.
  const heading = (key: string, label: string, right?: unknown) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" paddingRight={1}>
      <Text size="footnote" weight="semibold" color="subtle">
        {label.toUpperCase()}
      </Text>
      {right as never}
    </Box>
  )
  const split = (key: string, left: unknown, right: unknown) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Box flexShrink={1} minWidth={0}>
        {left as never}
      </Box>
      <Box flexShrink={0}>{right as never}</Box>
    </Box>
  )
  const link = (key: string, label: string, onPress: () => void) => (
    <Button key={key} plain dimColor onPress={onPress}>
      {label}
    </Button>
  )
  // A lone show/hide arrow is easy to miss dimmed, so it keeps full colour.
  const arrow = (key: string, open: boolean, onPress: () => void) => (
    <Button key={key} plain onPress={onPress}>
      {chevron(open)}
    </Button>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Box key="header" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
          <Text color="subtle">{`Claude leads · reports to ${OWNER}`}</Text>
          <Text>
            <Text color={running > 0 ? 'warning' : 'subtle'}>●</Text>
            <Text> {running}</Text>
            <Text color="subtle"> of {team.seats} working</Text>
            {attention > 0 && <Text color="warning">{`  ·  ${attention} need${attention === 1 ? 's' : ''} you`}</Text>}
          </Text>
        </Box>
      </Box>

      <Box key="top" flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
      <Box key="budget" width={share(topCols)} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        {showCredits ? (
          <Box key="credits-head" width="100%" flexDirection="row" columnGap={2}>
            <Box flexGrow={1} minWidth={0}>
              <Text>
                <Text color="subtle">Copilot credits used  </Text>
                <Text bold color={overBudget ? 'error' : undefined}>
                  {fmt(stats.spent)}
                </Text>
                <Text color="subtle"> of {fmt(team.creditBudget)}</Text>
              </Text>
            </Box>
            <Box flexShrink={0} flexDirection="row" gap={2}>
              {link('credits-more', `🪙 +${CREDIT_STEP}`, () => change(t => ({ ...t, creditBudget: t.creditBudget + CREDIT_STEP })))}
              {link('budget-reset', '🔄 Reset', () => change(t => ({ ...t, creditBudget: PERIOD_BUDGET ?? t.creditBudget, budgetSince: now, cleanedCredits: 0 })))}
              {arrow('credits-hide', true, toggle(() => (showCredits = false)))}
            </Box>
          </Box>
        ) : (
          <Box key="credits-collapsed" width="100%" flexDirection="row" alignItems="center" columnGap={2}>
            {meter('budget-meter-collapsed', budgetShare, overBudget ? 'error' : budgetShare > WARN_AT ? 'warning' : 'success')}
            <Box flexShrink={0}>{arrow('credits-show', false, toggle(() => (showCredits = true)))}</Box>
          </Box>
        )}
        {showCredits && meter('budget-meter', budgetShare, overBudget ? 'error' : budgetShare > WARN_AT ? 'warning' : 'success')}
        {showCredits && (
        <Text size="footnote" color="subtle">
          {[
            stats.roundsLeft !== undefined ? `budget left for ≈${stats.roundsLeft} more run${stats.roundsLeft === 1 ? '' : 's'}` : '',
            stats.avgCredits ? `a run costs ${fmt(stats.avgCredits)} credits and takes ${duration(stats.avgSeconds)} on average` : '',
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        )}
      </Box>

      {attention > 0 && (
        <Box key="waiting" width={share(topCols)} flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
          <Text weight="semibold" color="warning">
            Needs your decision
          </Text>
          {request && (
            <Box key="request" flexDirection="column">
              <Text>{describeRequest(request)}</Text>
              <Box flexDirection="row" gap={1}>
                <Button
                  key="request-approve"
                  variant="primary"
                  onPress={() => {
                    change(t => ({
                      ...t,
                      seats: t.seats + (request.seats ?? 0),
                      creditBudget: t.creditBudget + (request.credits ?? 0),
                      roster: request.hire ? [...(t.roster ?? []), request.hire] : t.roster,
                      request: undefined,
                    }))
                    tell(`Approved: ${request.reason}`)
                  }}
                >
                  ✓ Approve
                </Button>
                <Button
                  key="request-decline"
                  variant="secondary"
                  onPress={() => change(t => ({ ...t, request: undefined }))}
                >
                  ✕ Decline
                </Button>
              </Box>
            </Box>
          )}
          {lead.waiting.map(item => (
            <Box key={`waiting-${item.id}`} flexDirection="column">
              <Text>{item.text}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key={`waiting-${item.id}-yes`} variant="primary" onPress={() => answer(item, 'Go ahead')}>
                  ✓ Go ahead
                </Button>
                <Button key={`waiting-${item.id}-no`} variant="secondary" onPress={() => answer(item, 'Not yet')}>
                  ⏸ Not yet
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      </Box>

      <Box key="org" flexDirection="column">
        {heading(
          'org-heading',
          'Members',
          <Box flexDirection="row" columnGap={2}>
            {!request && link('hire', '➕ Hire', () => tell('Propose a hire.'))}
            {arrow('toggle-chart', showChart, toggle(() => (showChart = !showChart)))}
          </Box>,
        )}
        {showChart && (
          <Box key="org-grid" flexDirection="row" flexWrap="wrap" columnGap={2}>
          {chart.map((line, i) =>
            line.member ? (
              <Box key={`chart-${i}`} width={share(memberCols)}>
                {split(
                  `chart-${i}-row`,
                  <Text wrap="truncate-end">
                    <Text>{`${line.member.icon} `}</Text>
                    <Text bold>{line.member.title}</Text>
                    <Text color="subtle">{`  ${modelName(line.member.model)}`}</Text>
                  </Text>,
                  line.member.working ? (
                    <Text color="warning">{`On ${line.member.job ?? 'a job'}`}</Text>
                  ) : !inRoster.has(line.member.member) ? (
                    <Text color="subtle">Idle</Text>
                  ) : removing === line.member.member ? (
                    <Box flexDirection="row" columnGap={2}>
                      {link(`remove-${line.member.member}-yes`, '✓ Remove', () => remove(line.member!.member))}
                      {link(`remove-${line.member.member}-no`, '↩ Keep', toggle(() => (removing = undefined)))}
                    </Box>
                  ) : (
                    <Box flexDirection="row" columnGap={2}>
                      <Text color="subtle">Idle</Text>
                      {link(`remove-${line.member.member}`, '✕ Remove', toggle(() => (removing = line.member!.member)))}
                    </Box>
                  ),
                )}
              </Box>
            ) : line.group ? (
              <Box key={`chart-${i}`} width="100%">
                <Text weight="semibold">{line.group}</Text>
              </Box>
            ) : (
              <Box key={`chart-${i}`} width={share(memberCols)}>
                <Text color="subtle">🪑 Open seat</Text>
              </Box>
            ),
          )}
          </Box>
        )}
      </Box>

      <Box key="jobs" flexDirection="column" gap={1}>
        {heading(
          'jobs-heading',
          'Jobs',
          hiddenCount > 0 ? (
            <Box flexDirection="row" columnGap={2}>
              <Text color="subtle">{`${hiddenCount} hidden`}</Text>
              {arrow('toggle-hidden', showHidden, toggle(() => (showHidden = !showHidden)))}
            </Box>
          ) : undefined,
        )}
        {shownJobs.length === 0 && <Text color="subtle">No work yet.</Text>}
        <Box key="job-grid" flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
        {shownJobs.slice(0, showHidden ? jobs.length : MAX_JOBS).map(job => (
          <Box
            key={`job-${job.id}`}
            width={share(jobCols)}
            flexDirection="column"
            borderStyle="round"
            borderColor={job.rounds.some(r => r.status === 'running') ? 'warning' : 'subtle'}
            paddingX={1}
          >
            {split(
              `${job.id}-head`,
              <Text wrap="truncate-end">
                <Text bold>
                  {job.id}
                </Text>
                {job.title && <Text>{`  ${job.title}`}</Text>}
              </Text>,
              <Box flexDirection="row" columnGap={2}>
                <Text color="subtle">{`${fmt(job.credits)} credits`}</Text>
                {arrow(`${job.id}-fold`, !collapsedJobs.has(job.id), toggle(() => (collapsedJobs.delete(job.id) || collapsedJobs.add(job.id))))}
              </Box>,
            )}
            {!collapsedJobs.has(job.id) && (
            <Box key={`${job.id}-body`} flexDirection="column">
            {job.total > 0 && meter(`${job.id}-meter`, job.done / job.total, job.done === job.total ? 'success' : 'suggestion')}
            <Text size="footnote" color="subtle">
              {[job.total > 0 ? `${job.done} of ${job.total} tasks done` : '', `${job.rounds.length} agent run${job.rounds.length === 1 ? '' : 's'}`, job.hidden ? 'hidden' : '']
                .filter(Boolean)
                .join('  ·  ')}
            </Text>

            {job.members.map(m => {
              const id = `${job.id}/${m.member}`
              const status = STATUS_UI[m.latest.status]
              const note = m.latest.verdict?.note ?? m.latest.summary
              return (
                <Box key={`${job.id}-${m.member}`} flexDirection="column" marginTop={1}>
                  {split(
                    `${id}-head`,
                    <Text wrap="truncate-end">
                      <Text>{`${iconOf(m.member)} `}</Text>
                      <Text bold>{titleOf(m.member)}</Text>
                      <Text color="subtle">{`  ${modelName(m.model)}`}</Text>
                    </Text>,
                    <Text size="footnote">
                      <Text color={status.color}>{status.label}</Text>
                      <Text color="subtle">{` · ${ago(m.latest.ageMs)}`}</Text>
                    </Text>,
                  )}
                  {m.latest.status === 'running' ? (
                    <Box key={`${id}-now`} flexDirection="column" paddingLeft={2}>
                      <Text wrap="truncate-end" color={m.latest.stepFailed ? 'error' : undefined}>{m.latest.step}</Text>
                      {m.latest.command && (
                        <Text wrap="truncate-end" mono size="footnote" color="subtle">
                          {`$ ${m.latest.command}`}
                        </Text>
                      )}
                    </Box>
                  ) : (
                    note && (
                      <Box key={`${id}-note`} paddingLeft={2}>
                        <Text size="footnote" color={m.latest.verdict ? (m.latest.verdict.accepted ? 'success' : 'warning') : m.latest.status === 'failed' ? 'error' : 'subtle'}>
                          {`${m.latest.verdict ? (m.latest.verdict.accepted ? 'Lead accepted: ' : 'Lead sent back: ') : m.latest.status === 'failed' ? 'Failed: ' : 'Agent reported: '}${note}`}
                        </Text>
                      </Box>
                    )
                  )}
                  <Box flexDirection="row" gap={2} paddingLeft={2}>
                    <Text size="footnote" color="subtle">
                      {`${m.rounds.length} run${m.rounds.length === 1 ? '' : 's'} on this job · ${fmt(m.credits)} credits · ${duration(m.seconds)} of work`}
                    </Text>
                  </Box>
                  {expanded.has(id) && (
                    <Box key={`${id}-details`} flexDirection="column" paddingLeft={2} marginTop={1}>
                      {m.latest.brief && (
                        <Box key={`${id}-asked`} flexDirection="column" marginBottom={1}>
                          <Text size="footnote" weight="semibold" color="subtle">
                            WHAT THE LEAD ASKED
                          </Text>
                          <Text size="footnote">{m.latest.brief.asked}</Text>
                        </Box>
                      )}
                      <Text size="footnote" weight="semibold" color="subtle">
                        {`ITS LAST ${m.latest.recent.length} STEPS`}
                      </Text>
                      {m.latest.recent.map((step, i) => (
                        <Box key={`${id}-step-${i}`} flexDirection="column">
                          <Text wrap="truncate-end" size="footnote" color={step.failed ? 'error' : undefined}>
                            {`${step.failed ? '✗' : '·'} ${step.title}`}
                          </Text>
                          {step.command && (
                            <Text wrap="truncate-end" mono size="caption" color="subtle">
                              {`  $ ${step.command}`}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Box>
                  )}
                  <Box flexDirection="row" columnGap={2} rowGap={0} paddingLeft={2} flexWrap="wrap">
                    {link(`${id}-details-toggle`, `${chevron(expanded.has(id))} Steps`, toggle(() => (expanded.delete(id) || expanded.add(id))))}
                    {ASKS[m.latest.status].map(({ label, ask }) => link(`${id}-${label}`, label, () => tell(ask(m))))}
                    {m.latest.brief && link(`${id}-brief`, '📝 Brief', () => openFile($, m.latest.brief!.path))}
                    {m.latest.transcript && link(`${id}-transcript`, '📜 Transcript', () => openFile($, m.latest.transcript!))}
                  </Box>
                </Box>
              )
            })}

            <Box flexDirection="row" columnGap={2} rowGap={0} flexWrap="wrap" marginTop={1}>
              {job.tasks && link(`tasks-${job.id}`, '✅ Tasks', () => openFile($, job.tasks!))}
              {link(`hide-${job.id}`, job.hidden ? '👀 Show' : '🙈 Hide', () => setHidden(job.id, !job.hidden))}
              {job.hidden && link(`clean-${job.id}`, '📦 Archive', () => void cleanUp(job))}
            </Box>
            </Box>
            )}
          </Box>
        ))}
        </Box>
      </Box>

      {Input && (
        <Box key="lead-message-box" width="100%" flexDirection="column" alignItems="stretch">
          <Input
            key={`lead-message-${sent}`}
            placeholder="Message the lead…"
            submitLabel="➤ Send"
            onSubmit={value => {
              if (!value.trim()) return
              tell(value.trim())
              // A new key draws a fresh, empty field, so a second Enter can't resend.
              sent += 1
              redraw()
            }}
          />
        </Box>
      )}

      {stats.judged > 0 && (
        <Box key="insights" flexDirection="column">
          <Text size="caption" color="subtle">
            {`The lead accepted ${stats.accepted} of ${stats.judged} reviewed runs as they were`}
          </Text>
          {stats.blocked > 0 && (
            <Text size="caption" color="subtle">
              {`${stats.blocked} agent commands blocked by the run's safety rules (e.g. git commit)`}
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}
