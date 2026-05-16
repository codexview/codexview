import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  FileEdit,
  Globe,
  MessageSquare,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';

export const ICONS = {
  tool: Wrench,
  exec: Terminal,
  patch: FileEdit,
  search: Search,
  web: Globe,
  message: MessageSquare,
  reasoning: Sparkles,
  ok: CircleCheck,
  fail: CircleX,
  stop: CircleSlash,
  warn: AlertCircle,
  expand: ChevronDown,
  collapse: ChevronRight,
} as const;

export type IconKey = keyof typeof ICONS;
