import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const VIEW = {
  name: 'Kavya',
  id: 'kavya',
  profile: 'Work',
  account: { email: 'me@acme.com', org: 'Acme' },
  mailbox: { id: 'billing', name: 'billing', projects: ['/proj'] },
  inbox: '/home/u/.claude-mailboxes/mailboxes/billing/inbox/kavya',
  peers: [{ name: 'Meera', profile: 'Personal', label: 'migrations', where: 'proj' }],
  idle: 1,
  unread: 0,
}

type TestView = Omit<typeof VIEW, 'mailbox' | 'inbox'> & { mailbox: typeof VIEW.mailbox | null; inbox: string | null }
type World = { ops: string[]; inbox: string[]; view: TestView; submitted: string[]; toasts: string[] }

// The world beneath the mod: env, the runtime file, the bridge process, usage.
function world(on: On, w: World) {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  on('fs.read', async () => ({ value: JSON.stringify({ node: '/bin/node', bridge: '/b/bridge.js' }) }))
  on('fs.list', async () => ({ value: w.inbox.map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('session.cwd', async () => ({ value: '/proj' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: { tokens: 420_000, window: 1_000_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 26 },
        { kind: 'seven_day', percentUsed: 92 },
      ],
      cost: { usd: 1.5 },
    },
  }))
  on('process.run', async (_$, e) => {
    const op = e.argv[3] ?? ''
    w.ops.push(op)
    let value: unknown = w.view
    if (op === 'take') {
      value = w.inbox.length ? [{ from: { name: 'Meera', profile: 'Personal' }, text: 'Schema merged, go ahead.', sentAt: 't' }] : []
      w.inbox = []
    } else if (op === 'send') value = 'Delivered to Meera (Personal).'
    return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, value }), stderr: '' } } as never
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // Claude Code's own drawing of the band, when the mod hands it back: nothing.
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.register', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return clock
}

const fresh = (): World => ({ ops: [], inbox: [], view: VIEW, submitted: [], toasts: [] })

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: undefined, view: undefined } } as const

test('the band shows name, mailbox, peers, account, context and limits on every surface', async ($, on) => {
  const w = fresh()
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-mailbox', surface, ...BAND } as never)
    const text = (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('')
    expect(text).toContain('✉ Kavya')
    expect(text).toContain('billing')
    expect(text).toContain('Meera (Personal)')
    expect(text).toContain('Work')
    expect(text).toContain('me@acme.com (Acme)')
    expect(text).toContain('42%')
    expect(text).toContain('of 1M')
    expect(text).toContain('5h 26%')
    expect(text).toContain('7d 92%')
    expect(text).toContain('$1.50')
    const seven = (await ui.findAll({ type: 'Text' })).find((t) => t.text?.includes('7d'))
    expect(seven?.props.color).toBe('red')
    await ui.unmount()
  }
})

test('a project without a mailbox says how to join one, and /mailbox hide hides the band', async ($, on) => {
  const w = fresh()
  w.view = { ...VIEW, mailbox: null, inbox: null, peers: [] }
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ plugin: 'agent-mailbox', surface: 'terminal', ...BAND } as never)
  expect((await ui.findAll({ type: 'Text' })).map((t) => t.text).join('')).toContain('no mailbox · /mailbox init')
  await ui.unmount()
  await $.command.run({ command: 'mailbox', args: 'hide' } as never)
  ui = await $.ui.mount({ plugin: 'agent-mailbox', surface: 'terminal', ...BAND } as never)
  expect((await ui.findAll({ type: 'Text' })).map((t) => t.text).join('')).not.toContain('Kavya')
  await ui.unmount()
})

test('new mail is taken and announced once the session has had a prompt, not before', async ($, on) => {
  const w = fresh()
  const clock = world(on, w)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  w.inbox = ['1.json']
  await clock.advance(3500)
  // An unprompted (possibly pre-warmed spare) session doesn't take or deliver mail.
  expect(w.ops).not.toContain('take')
  expect(w.submitted.length).toBe(0)
  await $.tool.call({ tool: 'mcp__agent-mailbox__list_peers' } as never)
  await clock.advance(3500)
  expect(w.ops).toContain('take')
  expect(w.toasts[0]).toBe('✉ Meera (Personal): Schema merged, go ahead.')
  // The wake itself ($.prompt.submit) only enters once a session is idle,
  // which the test kit's session never is; the end-to-end run covers it.
})

test('tools answer through the bridge', async ($, on) => {
  const w = fresh()
  world(on, w)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const peers = await $.tool.call({ tool: 'mcp__agent-mailbox__list_peers' } as never)
  expect(String((peers as { result?: unknown }).result)).toContain('You are Kavya (profile Work) in mailbox "billing".')
  expect(String((peers as { result?: unknown }).result)).toContain('- Meera · profile Personal · proj · migrations')
  const sent = await $.tool.call({ tool: 'mcp__agent-mailbox__send_message', to: 'Meera', message: 'hi' } as never)
  expect((sent as { result?: unknown }).result).toBe('Delivered to Meera (Personal).')
})
