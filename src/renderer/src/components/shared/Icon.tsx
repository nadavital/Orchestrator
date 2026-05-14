export type IconName =
  | 'agents'
  | 'arrowUp'
  | 'book'
  | 'branch'
  | 'chat'
  | 'check'
  | 'chevronDown'
  | 'close'
  | 'diff'
  | 'extensions'
  | 'file'
  | 'folder'
  | 'menu'
  | 'paperclip'
  | 'plan'
  | 'plus'
  | 'send'
  | 'settings'
  | 'terminal'
  | 'usage'

const paths: Record<IconName, JSX.Element> = {
  agents: (
    <>
      <circle cx="8" cy="4.25" r="1.75" />
      <circle cx="4" cy="11.25" r="1.75" />
      <circle cx="12" cy="11.25" r="1.75" />
      <path d="M7.15 5.8 4.85 9.7" />
      <path d="m8.85 5.8 2.3 3.9" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M8 13V3" />
      <path d="M4 7 8 3l4 4" />
    </>
  ),
  book: (
    <>
      <path d="M3 3.25A2.25 2.25 0 0 1 5.25 1H14v12.5H5.25A2.25 2.25 0 0 0 3 15.75V3.25Z" />
      <path d="M3 3.25A2.25 2.25 0 0 0 .75 1H.5v12.5h.25A2.25 2.25 0 0 1 3 15.75" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.5" cy="4" r="1.5" />
      <circle cx="11.5" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <path d="M4.5 5.5v1.25A3.25 3.25 0 0 0 7.75 10H8" />
      <path d="M11.5 5.5v1.25A3.25 3.25 0 0 1 8.25 10H8" />
    </>
  ),
  chat: (
    <>
      <path d="M2.75 2.5h10.5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5H8l-3.25 2.5v-2.5h-2A1.5 1.5 0 0 1 1.25 10.25V4a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M4.5 5.75h7" />
      <path d="M4.5 8.25h4.25" />
    </>
  ),
  check: <path d="M3 8.25 6.25 11.5 13 4.75" />,
  chevronDown: <path d="m4 6 4 4 4-4" />,
  close: (
    <>
      <path d="m4.5 4.5 7 7" />
      <path d="m11.5 4.5-7 7" />
    </>
  ),
  diff: (
    <>
      <path d="M8 2.5v11" />
      <path d="M3.5 5h2.75" />
      <path d="M9.75 5h2.75" />
      <path d="M3.5 11h2.75" />
      <path d="M9.75 11h2.75" />
    </>
  ),
  extensions: (
    <>
      <rect x="3" y="3" width="3.5" height="3.5" rx="0.75" />
      <rect x="9.5" y="3" width="3.5" height="3.5" rx="0.75" />
      <rect x="3" y="9.5" width="3.5" height="3.5" rx="0.75" />
      <rect x="9.5" y="9.5" width="3.5" height="3.5" rx="0.75" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.25h5.25L12 5v8.75H4V2.25Z" />
      <path d="M9.25 2.25V5H12" />
    </>
  ),
  folder: <path d="M1.75 4.25A1.75 1.75 0 0 1 3.5 2.5h3.05l1.25 1.75h4.7a1.75 1.75 0 0 1 1.75 1.75v5.5a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 11.5V4.25Z" />,
  menu: (
    <>
      <path d="M4 5h8" />
      <path d="M4 8h6" />
      <path d="M4 11h4" />
    </>
  ),
  paperclip: <path d="m5.25 8.5 4.9-4.9a2.25 2.25 0 1 1 3.18 3.18l-5.78 5.78a3.25 3.25 0 0 1-4.6-4.6l5.3-5.3" />,
  plan: (
    <>
      <rect x="2.5" y="2.25" width="11" height="11.5" rx="1.75" />
      <path d="M5 5.75h6" />
      <path d="M5 8.25h6" />
      <path d="M5 10.75h3.5" />
    </>
  ),
  plus: (
    <>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
    </>
  ),
  send: <path d="M3 13 13.5 8 3 3v4l5.5 1L3 9v4Z" />,
  settings: (
    <>
      <path d="M3 4.5h10" />
      <path d="M3 8h10" />
      <path d="M3 11.5h10" />
      <circle cx="6" cy="4.5" r="1.25" />
      <circle cx="10.5" cy="8" r="1.25" />
      <circle cx="7.5" cy="11.5" r="1.25" />
    </>
  ),
  terminal: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="m4.5 6 2 2-2 2" />
      <path d="M8.5 10h3" />
    </>
  ),
  usage: (
    <>
      <path d="M3.5 12.5h9" />
      <path d="M3.5 8h6.5" />
      <path d="M3.5 3.5h9" />
    </>
  )
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {paths[name]}
    </svg>
  )
}
