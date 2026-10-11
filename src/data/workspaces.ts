/** App workspaces: one application's components and repositories, Jira project, Octane workspace and pipelines. */
export interface Workspace {
  id: string
  note: string
  /** Whether the prototype has data for it. */
  ready: boolean
}

export const WORKSPACES: Workspace[] = [
  { id: 'ABCD', note: '5 components · last scanned 2 Oct 2026', ready: true },
  { id: '2PAY', note: 'Not set up in this prototype', ready: false },
  { id: '3LDG', note: 'Not set up in this prototype', ready: false },
]

export const workspace = (id: string | null | undefined) => WORKSPACES.find((w) => w.id === id)

/** An app named in the message, e.g. "analyse coverage for ABCD". */
export function workspaceInText(text: string) {
  return WORKSPACES.find((w) => new RegExp(`\\b${w.id}\\b`, 'i').test(text))?.id
}
