import { expect, test } from 'claude-code/testing'

const RUNS = '/runs'
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)

const FILES: Record<string, string> = {
  [`${RUNS}/team.json`]: JSON.stringify({
    seats: 3,
    creditBudget: 1000,
    budgetSince: 0,
    roster: [
      { member: 'senior-dev', model: 'claude-opus-5.5', title: 'Snr. Developer' },
      { member: 'senior-dev-2', model: 'claude-opus-5.5', title: 'Snr. Developer' },
      { member: 'reviewer', model: 'claude-opus-5.5' },
    ],
  }),
  [`${RUNS}/lead.json`]: JSON.stringify({
    jobs: { 'T-1': { title: 'Demo job', tasks: `${RUNS}/tasks.md` } },
    verdicts: { 'copilot-fix-1': { accepted: true, note: 'looks good' } },
    waiting: [],
  }),
  [`${RUNS}/tasks.md`]: '- [x] first\n  - [X] nested\n* [ ] open\n',
  [`${RUNS}/copilot-fix-1.log`]: [
    '# role=fix model=claude-opus-5.5 repo=r job=T-1 member=senior-dev-2',
    '● Read the file',
    '  │ cat x',
    '  └ ok',
    '',
    'All done.',
    '',
    'AI Credits 120.5 (4m 10s)',
  ].join('\n'),
  [`${RUNS}/copilot-review-1.log`]: [
    '# role=review model=claude-opus-5.5 repo=r job=T-1 member=reviewer',
    'zsh: command not found: copilot',
    '# exit=127',
  ].join('\n'),
}

const PANE = {
  plugin: 'copilot-workers',
  component: 'Pane',
  requestId: 'copilot-workers',
  props: {
    title: 'Team',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

test('the pane shows the team, its budget and a job from the runs folder', { options: { ownerName: 'Ana', runsDir: RUNS } }, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'copilot-workers' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/ana\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.list', () => ({
    value: Object.keys(FILES).map(path => ({ name: path.slice(RUNS.length + 1), kind: 'file' as const, isLink: false, size: 1, mtimeMs: NOW - 60_000 })),
  }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /reports to Ana/ })).toBeDefined()
    // Two members share a title, so the second is numbered.
    expect(await ui.find({ type: 'Text', text: /Snr\. Developer 2/ })).toBeDefined()
    // Any markdown checklist counts: indented items and [X] included.
    expect(await ui.find({ type: 'Text', text: /2 of 3 tasks done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Lead accepted: looks good/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /121 credits/ })).toBeDefined()
    // A run that exits non-zero is Failed at once, with Copilot's last line as the reason.
    expect(await ui.find({ type: 'Text', text: /Failed: zsh: command not found: copilot/ })).toBeDefined()
    await ui.unmount()
  }
})
