export type IconName =
  | 'agents'
  | 'book'
  | 'chat'
  | 'check'
  | 'chevronDown'
  | 'close'
  | 'diff'
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
      <circle cx="8" cy="5.5" r="2.25" />
      <path d="M4.5 14a3.5 3.5 0 0 1 7 0" />
      <path d="M2.75 12.5a2.25 2.25 0 0 1 2-2.23" />
      <path d="M13.25 10.27a2.25 2.25 0 0 1 2 2.23" />
    </>
  ),
  book: (
    <>
      <path d="M3 3.25A2.25 2.25 0 0 1 5.25 1H14v12.5H5.25A2.25 2.25 0 0 0 3 15.75V3.25Z" />
      <path d="M3 3.25A2.25 2.25 0 0 0 .75 1H.5v12.5h.25A2.25 2.25 0 0 1 3 15.75" />
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
      <path d="M8 2v12" />
      <path d="M3 5h3" />
      <path d="M10 5h3" />
      <path d="M3 11h3" />
      <path d="M10 11h3" />
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
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.75v1.5" />
      <path d="M8 12.75v1.5" />
      <path d="M1.75 8h1.5" />
      <path d="M12.75 8h1.5" />
      <path d="m3.58 3.58 1.06 1.06" />
      <path d="m11.36 11.36 1.06 1.06" />
      <path d="m12.42 3.58-1.06 1.06" />
      <path d="m4.64 11.36-1.06 1.06" />
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
