import {
  ArrowUp,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  CircleDot,
  Ellipsis,
  File,
  Folder,
  GitBranch,
  GitCompare,
  ListChecks,
  Menu,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  Plug,
  Plus,
  RotateCw,
  Send,
  Settings,
  Sparkles,
  Wrench,
  Terminal,
  Users,
  X,
  type LucideIcon
} from 'lucide-react'

export type IconName =
  | 'agents'
  | 'arrowUp'
  | 'book'
  | 'branch'
  | 'chat'
  | 'check'
  | 'chevronDown'
  | 'close'
  | 'dot'
  | 'ellipsis'
  | 'diff'
  | 'extensions'
  | 'file'
  | 'folder'
  | 'menu'
  | 'paperclip'
  | 'pencil'
  | 'pin'
  | 'plan'
  | 'plug'
  | 'plus'
  | 'refresh'
  | 'send'
  | 'settings'
  | 'sparkles'
  | 'terminal'
  | 'usage'
  | 'wrench'

const icons: Record<IconName, LucideIcon> = {
  agents: Users,
  arrowUp: ArrowUp,
  book: BookOpen,
  branch: GitBranch,
  chat: MessageSquare,
  check: Check,
  chevronDown: ChevronDown,
  close: X,
  dot: CircleDot,
  ellipsis: Ellipsis,
  diff: GitCompare,
  extensions: Boxes,
  file: File,
  folder: Folder,
  menu: Menu,
  paperclip: Paperclip,
  pencil: Pencil,
  pin: Pin,
  plan: ListChecks,
  plug: Plug,
  plus: Plus,
  refresh: RotateCw,
  send: Send,
  settings: Settings,
  sparkles: Sparkles,
  terminal: Terminal,
  usage: BarChart3,
  wrench: Wrench
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const Lucide = icons[name]
  return <Lucide size={size} strokeWidth={2} aria-hidden="true" />
}
