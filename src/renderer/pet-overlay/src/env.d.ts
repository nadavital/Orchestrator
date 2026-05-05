/// <reference types="vite/client" />

import type { Session, ChatMessage } from '../../../types'

export type PetSessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'needsInput'; id: string }

export interface PetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  kind: string
  animFrames?: Partial<Record<string, number>>
}

export interface PetEntry extends PetManifest {
  spritesheetDataUrl: string
}

export interface PetLayout {
  mascotLeft: number
  mascotTop: number
  trayLeft: number
  trayTop: number
  placement: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
}

export interface PetConfig {
  pets: PetEntry[]
  selectedPetId: string
  isOpen: boolean
  sessions: Session[]
  initialLayout: PetLayout
}

declare global {
  interface Window {
    petApi: {
      onSessionEvent: (cb: (event: PetSessionEvent) => void) => () => void
      pet: {
        getConfig: () => Promise<PetConfig>
        selectPet: (id: string) => Promise<void>
        importPet: () => Promise<PetManifest | null>
        close: () => Promise<void>
        focusMain: (sessionId?: string) => Promise<void>
        dragStart: (clientX: number, clientY: number) => void
        dragMove: () => void
        dragEnd: () => void
        dragRelease: (vx: number, vy: number) => void
        setPointerInteractive: (v: boolean) => void
        setTrayCount: (count: number) => void
        setTrayHeight: (h: number) => void
        setTraySize: (size: { width: number; height: number }) => void
        setMascotSize: (size: { width: number; height: number }) => void
        onConfigUpdated: (cb: (update: { selectedPetId?: string }) => void) => () => void
        onLayout: (cb: (layout: PetLayout) => void) => () => void
      }
    }
  }
}
