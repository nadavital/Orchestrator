import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  CircleDot,
  Ellipsis,
  Eraser,
  File,
  Folder,
  GitBranch,
  GitCompare,
  Keyboard,
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
  | 'checkCircle'
  | 'chevronDown'
  | 'chevronRight'
  | 'clock'
  | 'copy'
  | 'close'
  | 'dot'
  | 'eraser'
  | 'ellipsis'
  | 'diff'
  | 'extensions'
  | 'file'
  | 'folder'
  | 'keyboard'
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
  | 'warning'

const icons: Record<IconName, LucideIcon> = {
  agents: Users,
  arrowUp: ArrowUp,
  book: BookOpen,
  branch: GitBranch,
  chat: MessageSquare,
  check: Check,
  checkCircle: CheckCircle2,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  clock: Clock3,
  copy: Copy,
  close: X,
  dot: CircleDot,
  eraser: Eraser,
  ellipsis: Ellipsis,
  diff: GitCompare,
  extensions: Boxes,
  file: File,
  folder: Folder,
  keyboard: Keyboard,
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
  wrench: Wrench,
  warning: AlertTriangle
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const Lucide = icons[name]
  return <Lucide size={size} strokeWidth={2} aria-hidden="true" />
}
