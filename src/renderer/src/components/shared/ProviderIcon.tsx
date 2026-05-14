import { PROVIDER_DEFS } from '../../types'

interface Props {
  providerId: string
  size?: number
  color?: string
}

export default function ProviderIcon({ providerId, size = 16, color }: Props): JSX.Element {
  const def = PROVIDER_DEFS[providerId] ?? PROVIDER_DEFS.claude
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
