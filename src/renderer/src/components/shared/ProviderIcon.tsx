import { PROVIDER_DEFS } from '../../types'
import antigravityIconUrl from '../../assets/antigravity.svg?url'

interface Props {
  providerId: string
  size?: number
  color?: string
}

export default function ProviderIcon({ providerId, size = 16, color }: Props): JSX.Element {
  const def = PROVIDER_DEFS[providerId] ?? PROVIDER_DEFS.claude
  if (providerId === 'antigravity') {
    return (
      <img
        aria-hidden="true"
        src={antigravityIconUrl}
        width={size}
        height={Math.max(1, Math.round(size * 15 / 16))}
        style={{
          width: size,
          height: Math.max(1, Math.round(size * 15 / 16)),
          flexShrink: 0,
          objectFit: 'contain'
        }}
      />
    )
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ?? def.color}
      style={{
        flexShrink: 0
      }}
    >
      <path
        d={def.icon}
        fillRule={def.iconFillRule as 'evenodd' | undefined}
        clipRule={def.iconFillRule as 'evenodd' | undefined}
      />
    </svg>
  )
}
