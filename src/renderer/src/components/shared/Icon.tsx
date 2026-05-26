import {
  AlertTriangle,
  ArrowDown,
  Archive,
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
  Code2,
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
  LocateFixed,
  Maximize2,
  Menu,
  Minimize2,
  Monitor,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil,
  Pin,
  Play,
  Plug,
  Plus,
  RotateCw,
  Search,
  ExternalLink,
  Send,
  Settings,
  Sparkles,
  Smartphone,
  Square,
  Wrench,
  Terminal,
  Trash2,
  Undo2,
  Users,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'

export type IconName =
  | 'agents'
  | 'archive'
  | 'arrowDown'
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
  | 'code'
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
  | 'locate'
  | 'maximize'
  | 'menu'
  | 'minimize'
  | 'monitor'
  | 'panelLeft'
  | 'panelRight'
  | 'paperclip'
  | 'pencil'
  | 'pin'
  | 'play'
  | 'plan'
  | 'plug'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'smartphone'
  | 'sparkles'
  | 'stop'
  | 'terminal'
  | 'trash'
  | 'undo'
  | 'usage'
  | 'wrench'
  | 'wrap'
  | 'zoomIn'
  | 'zoomOut'
  | 'warning'

const icons: Record<IconName, LucideIcon> = {
  agents: Users,
  archive: Archive,
  arrowDown: ArrowDown,
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
  code: Code2,
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
  locate: LocateFixed,
  maximize: Maximize2,
  menu: Menu,
  minimize: Minimize2,
  monitor: Monitor,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  paperclip: Paperclip,
  pencil: Pencil,
  pin: Pin,
  play: Play,
  plan: ListChecks,
  plug: Plug,
  plus: Plus,
  refresh: RotateCw,
  search: Search,
  send: Send,
  settings: Settings,
  smartphone: Smartphone,
  sparkles: Sparkles,
  stop: Square,
  terminal: Terminal,
  trash: Trash2,
  undo: Undo2,
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
