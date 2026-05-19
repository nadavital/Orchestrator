import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Boxes,
  Camera,
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
  Globe,
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
  ExternalLink,
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
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowUp'
  | 'book'
  | 'browser'
  | 'camera'
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
  | 'external'
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
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUp: ArrowUp,
  book: BookOpen,
  browser: Globe,
  camera: Camera,
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
  external: ExternalLink,
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
