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
  Expand,
  File,
  Folder,
  GitBranch,
  GitCompare,
  Globe,
  Keyboard,
  ListChecks,
  Menu,
  Minimize2,
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
  WrapText,
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
  | 'expand'
  | 'diff'
  | 'extensions'
  | 'external'
  | 'file'
  | 'folder'
  | 'keyboard'
  | 'menu'
  | 'minimize'
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
  | 'wrap'
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
  expand: Expand,
  diff: GitCompare,
  extensions: Boxes,
  external: ExternalLink,
  file: File,
  folder: Folder,
  keyboard: Keyboard,
  menu: Menu,
  minimize: Minimize2,
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
  wrap: WrapText,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  warning: AlertTriangle
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const Lucide = icons[name]
  return <Lucide size={size} strokeWidth={2} aria-hidden="true" />
}
