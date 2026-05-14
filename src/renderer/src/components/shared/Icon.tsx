import {
  ArrowUp,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  File,
  Folder,
  GitBranch,
  GitCompare,
  ListChecks,
  Menu,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Settings,
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

const icons: Record<IconName, LucideIcon> = {
  agents: Users,
  arrowUp: ArrowUp,
  book: BookOpen,
  branch: GitBranch,
  chat: MessageSquare,
  check: Check,
  chevronDown: ChevronDown,
  close: X,
  diff: GitCompare,
  extensions: Boxes,
  file: File,
  folder: Folder,
  menu: Menu,
  paperclip: Paperclip,
  plan: ListChecks,
  plus: Plus,
  send: Send,
  settings: Settings,
  terminal: Terminal,
  usage: BarChart3
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const Lucide = icons[name]
  return <Lucide size={size} strokeWidth={2} aria-hidden="true" />
}
