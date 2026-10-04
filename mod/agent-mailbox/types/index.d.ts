export type Peer = { name: string; profile: string; label: string; where: string }

export type Account = { email?: string; org?: string; plan?: string; kind?: string }

/** What the bridge's `sync` op reports about this session. */
export type View = {
  name: string
  profile: string
  account?: Account
  mailbox: { id: string; name: string; projects: string[] } | null
  inbox: string | null
  peers: Peer[]
  idle: number
  unread: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** `$.session.usage()`, trimmed to what the band draws. */
export type Usage = { percent?: number; tokens?: number; window: number; limits: Limit[]; cost?: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-mailbox': { view: View | null; usage: Usage | null; isHidden: boolean }
  }
}
