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
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="11.25" cy="6.25" r="1.55" />
      <path d="M2.75 13a3.35 3.35 0 0 1 6.5 0" />
      <path d="M9.75 12.35a2.6 2.6 0 0 1 3.9.65" />
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
      <circle cx="5" cy="4" r="1.6" />
      <circle cx="11" cy="12" r="1.6" />
      <path d="M5 5.6v1.9A3.5 3.5 0 0 0 8.5 11H9.4" />
      <path d="M5 7.25h4.1A2.9 2.9 0 0 1 12 10.15V10.4" />
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
      <path d="M8 2.75v10.5" />
      <path d="M3.5 5.25h2.75" />
      <path d="M3.5 10.75h2.75" />
      <path d="M10 5.25h2.5" />
      <path d="M11.25 4v2.5" />
      <path d="M10 10.75h2.5" />
    </>
  ),
  extensions: (
    <>
      <circle cx="5" cy="5" r="1.35" />
      <circle cx="11" cy="5" r="1.35" />
      <circle cx="5" cy="11" r="1.35" />
      <circle cx="11" cy="11" r="1.35" />
      <path d="M6.35 5h3.3" />
      <path d="M5 6.35v3.3" />
      <path d="M11 6.35v3.3" />
      <path d="M6.35 11h3.3" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.25h5.25L12 5v8.75H4V2.25Z" />
      <path d="M9.25 2.25V5H12" />
    </>
  ),
  folder: (
    <>
      <path d="M2.25 4.75c0-.85.68-1.5 1.5-1.5h2.5l1.35 1.6h4.65c.85 0 1.5.68 1.5 1.5v5.4c0 .85-.68 1.5-1.5 1.5h-8.5c-.85 0-1.5-.68-1.5-1.5v-7Z" />
      <path d="M2.25 6.25h11.5" />
    </>
  ),
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
      <rect x="3" y="2.5" width="10" height="11" rx="1.6" />
      <path d="m5 5.75.8.8 1.45-1.45" />
      <path d="M8.75 6h2.25" />
      <path d="m5 9.25.8.8 1.45-1.45" />
      <path d="M8.75 9.5h2.25" />
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
      <path d="M6.75 2.25h2.5l.35 1.25c.38.13.74.28 1.05.48l1.15-.62 1.75 1.75-.62 1.15c.2.33.37.68.48 1.05l1.25.35v2.5l-1.25.35c-.12.38-.28.73-.48 1.05l.62 1.15-1.75 1.75-1.15-.62c-.32.2-.67.36-1.05.48l-.35 1.25h-2.5l-.35-1.25a5.1 5.1 0 0 1-1.05-.48l-1.15.62-1.75-1.75.62-1.15a5.1 5.1 0 0 1-.48-1.05l-1.25-.35v-2.5l1.25-.35c.12-.38.28-.73.48-1.05l-.62-1.15 1.75-1.75 1.15.62c.32-.2.67-.36 1.05-.48l.35-1.25Z" />
      <circle cx="8" cy="8" r="2" />
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
      <path d="M3 13h10" />
      <path d="M4.5 10V7.5" />
      <path d="M8 10V3.75" />
      <path d="M11.5 10V5.75" />
      <path d="M3.75 10h8.5" />
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
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {paths[name]}
    </svg>
  )
}
