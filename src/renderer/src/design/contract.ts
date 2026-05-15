import type { DesignSystemContract } from '../types'

export const designSystemContract: DesignSystemContract = {
  version: 1,
  motionTokens: [
    '--motion-duration-edge',
    '--motion-duration-row',
    '--motion-duration-control',
    '--motion-duration-overlay',
    '--motion-duration-panel',
    '--motion-ease-standard',
    '--motion-ease-control',
    '--motion-ease-emphasized'
  ],
  requiredPrimitives: [
    'Button',
    'IconButton',
    'SurfaceRow',
    'StatusBadge',
    'Badge',
    'PopoverSurface',
    'DisclosureSection',
    'ScrollEdgeButton',
    'MotionPanel',
    'MotionView'
  ],
  codexParitySurfaces: [
    'pet-avatar',
    'notification-badge',
    'notification-tray',
    'notification-row',
    'permission-banner',
    'review-banner',
    'reduced-motion'
  ],
  reducedMotionSelectors: [
    '.motion-row',
    '.motion-overlay-surface',
    '.motion-popover-surface',
    '.motion-view-animated',
    '.motion-button',
    '.motion-icon-button',
    '.motion-badge-button',
    '.motion-panel'
  ]
}
