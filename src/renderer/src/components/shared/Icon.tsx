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
  Monitor,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  Plug,
  Plus,
  RotateCw,
  Search,
  ExternalLink,
  Send,
  Settings,
  Sparkles,
  Smartphone,
  Wrench,
  Terminal,
  Users,
  X,
  ZoomIn,
  ZoomOut,
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
  | 'monitor'
  | 'paperclip'
  | 'pencil'
  | 'pin'
  | 'plan'
  | 'plug'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'smartphone'
  | 'sparkles'
  | 'terminal'
  | 'usage'
  | 'wrench'
  | 'zoomIn'
  | 'zoomOut'
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
  monitor: Monitor,
  paperclip: Paperclip,
  pencil: Pencil,
  pin: Pin,
  plan: ListChecks,
  plug: Plug,
  plus: Plus,
  refresh: RotateCw,
  search: Search,
  send: Send,
  settings: Settings,
  smartphone: Smartphone,
  sparkles: Sparkles,
  terminal: Terminal,
  usage: BarChart3,
  wrench: Wrench,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  warning: AlertTriangle
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const Lucide = icons[name]
  return <Lucide size={size} strokeWidth={2} aria-hidden="true" />
}
