import { expect, mock, test } from 'claude-code/testing'

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
  [`${RUNS}/copilot-implement-2.log`]: '# role=implement model=m repo=r job=T-1 member=senior-dev\n● Build\n  └ ok\n\n## Report\nShipped it.\n# exit=0\n',
  [`${RUNS}/tasks.md`]: '- [x] first\n  - [X] nested\n* [ ] open\n',
  [`${RUNS}/copilot-fix-1.log`]: [
    '# role=fix model=claude-opus-5.5 repo=r job=T-1 member=senior-dev-2',
    '● Read the file',
    '  │ cat x',
    '  └ ok',
    '',
    '## Report',
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
    title: 'Copilot Team',
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
    // The report marker isn't the summary.
    expect(await ui.find({ type: 'Text', text: /Agent reported: Shipped it\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /121 credits/ })).toBeDefined()
    // A run that exits non-zero is Failed at once, with Copilot's last line as the reason.
    expect(await ui.find({ type: 'Text', text: /Failed: zsh: command not found: copilot/ })).toBeDefined()
    // A folded job card keeps only its title row.
    await ui.press({ key: 'T-1-fold' })
    expect(await ui.find({ type: 'Text', text: /Demo job/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 of 3 tasks done/ })).toBeUndefined()
    await ui.press({ key: 'T-1-fold' })
    await ui.unmount()
  }
})

test('an idle member can be removed after a second press', { options: { ownerName: 'Ana', runsDir: RUNS, creditStep: '250', creditBudget: '2000' } }, async ($, on) => {
  const written: Record<string, string> = {}
  const sentToLead: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'copilot-workers' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/ana\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.list', () => ({
    value: Object.keys(FILES).map(path => ({ name: path.slice(RUNS.length + 1), kind: 'file' as const, isLink: false, size: 1, mtimeMs: NOW - 60_000 })),
  }))
  on('fs.read', (_, e) => ({ value: written[e.path] ?? FILES[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    sentToLead.push(e.text)
    return { drop: 'captured by the test' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The reviewer has no run on the books, so it's idle; senior-dev-2 is too, but only the pressed one goes.
  await ui.press({ key: 'remove-reviewer' })
  expect(written[`${RUNS}/team.json`]).toBeUndefined()
  await ui.press({ key: 'remove-reviewer-yes' })

  const roster = JSON.parse(written[`${RUNS}/team.json`] ?? '{}').roster.map((entry: { member: string }) => entry.member)
  expect(roster).toEqual(['senior-dev', 'senior-dev-2'])
  // Remove only changes team.json; the lead reads it before acting, so no Claude turn is spent.
  expect(sentToLead).toEqual([])

  await ui.press({ key: 'hire' })
  expect(sentToLead.at(-1)).toBe('[Copilot Team · Ana] Propose a hire.')

  // While a request waits, Hire is hidden, and Decline clears it without a message.
  written[`${RUNS}/team.json`] = JSON.stringify({ ...JSON.parse(written[`${RUNS}/team.json`] ?? '{}'), request: { seats: 1, reason: 'busy' } })
  await ui.press({ key: 'credits-more' })
  written[`${RUNS}/team.json`] = JSON.stringify({ ...JSON.parse(written[`${RUNS}/team.json`] ?? '{}'), creditBudget: 1000 })
  expect(await ui.find({ key: 'request-decline' })).toBeDefined()
  expect(await ui.find({ key: 'hire' })).toBeUndefined()
  await ui.press({ key: 'request-decline' })
  expect(JSON.parse(written[`${RUNS}/team.json`] ?? '{}').request).toBeUndefined()
  expect(sentToLead).toHaveLength(1)

  // The 🪙 button adds the configured step, not a fixed one.
  await ui.press({ key: 'credits-more' })
  expect(JSON.parse(written[`${RUNS}/team.json`] ?? '{}').creditBudget).toBe(1250)

  // Reset starts a new period at the configured budget.
  await ui.press({ key: 'budget-reset' })
  const reset = JSON.parse(written[`${RUNS}/team.json`] ?? '{}')
  expect([reset.creditBudget, reset.budgetSince, reset.cleanedCredits]).toEqual([2000, NOW, 0])
  await ui.unmount()
})

test('runs copied within the same moment keep their run order', { options: { ownerName: 'Ana', runsDir: RUNS } }, async ($, on) => {
  // As a clone or `cp -r` leaves them: written in name order, so fix-3 is a few milliseconds older than implement-1.
  const files: Record<string, { text: string; mtimeMs: number }> = {
    [`${RUNS}/team.json`]: { text: JSON.stringify({ seats: 2, roster: [{ member: 'senior-dev', model: 'claude-opus-5.5' }] }), mtimeMs: NOW },
    [`${RUNS}/lead.json`]: {
      text: JSON.stringify({
        jobs: { 'T-2': { title: 'Ordering' } },
        verdicts: { 'copilot-implement-1': { accepted: false, note: 'first try' }, 'copilot-fix-3': { accepted: true, note: 'fixed' } },
        waiting: [],
      }),
      mtimeMs: NOW,
    },
    [`${RUNS}/copilot-fix-3.log`]: { text: '# role=fix model=m repo=r job=T-2 member=senior-dev\nAI Credits 1 (1s)\n# exit=0\n', mtimeMs: NOW - 60_000 },
    [`${RUNS}/copilot-implement-1.log`]: { text: '# role=implement model=m repo=r job=T-2 member=senior-dev\nAI Credits 1 (1s)\n# exit=0\n', mtimeMs: NOW - 59_997 },
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'copilot-workers' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/ana\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.list', () => ({
    value: Object.entries(files).map(([path, file]) => ({ name: path.slice(RUNS.length + 1), kind: 'file' as const, isLink: false, size: 1, mtimeMs: file.mtimeMs })),
  }))
  on('fs.read', (_, e) => ({ value: files[e.path]?.text ?? '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Lead accepted: fixed/ })).toBeDefined()
  await ui.unmount()
})

test('a job folded before a restart starts folded', { options: { ownerName: 'Ana', runsDir: RUNS } }, async ($, on) => {
  mock.store(on, { folds: { collapsedJobs: ['T-1'] } })
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
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Demo job/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 of 3 tasks done/ })).toBeUndefined()
  await ui.press({ key: 'T-1-fold' })
  expect(await ui.find({ type: 'Text', text: /2 of 3 tasks done/ })).toBeDefined()
  await ui.unmount()
})
