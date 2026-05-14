import { PROVIDER_DEFS } from '../../types'

interface Props {
  providerId: string
  size?: number
  color?: string
}

export default function ProviderIcon({ providerId, size = 16, color }: Props): JSX.Element {
  const def = PROVIDER_DEFS[providerId] ?? PROVIDER_DEFS.claude
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color ?? def.color,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${color ?? def.color} 14%, transparent)`,
        flexShrink: 0
      }}
    />
  )
}
