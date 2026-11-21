import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest
  }
}

export const TimerIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M9 2h6" />
  </svg>
)
export const ReportsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 20V11M12 20V5M19 20v-6M3 20h18" />
  </svg>
)
export const ProjectsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)
export const SettingsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
)
export const SearchIcon = (p: P) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)
export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
)
export const ChevronDown = (p: P) => (
  <svg {...base({ size: 14, strokeWidth: 2, ...p })}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)
export const ChevronLeft = (p: P) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
)
export const ChevronRight = (p: P) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)
export const DownloadIcon = (p: P) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
)
export const CloseIcon = (p: P) => (
  <svg {...base({ size: 14, strokeWidth: 2, ...p })}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const PencilIcon = (p: P) => (
  <svg {...base({ size: 12, strokeWidth: 2.2, ...p })}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
)
export const InfoIcon = (p: P) => (
  <svg {...base({ strokeWidth: 2, ...p })}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)
export const GripIcon = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true" style={{ color: 'var(--faint)' }}>
    {[3, 7, 11].map((y) => (
      <g key={y}>
        <circle cx="3" cy={y} r="1.3" />
        <circle cx="7" cy={y} r="1.3" />
      </g>
    ))}
  </svg>
)
export const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 1l11 6-11 6z" fill="currentColor" />
  </svg>
)
export const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect width="14" height="14" rx="2" fill="currentColor" />
  </svg>
)
export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
    <rect width="28" height="28" rx="8" fill="#2457C5" />
    <circle cx="14" cy="15" r="7" fill="none" stroke="#FFFFFF" strokeWidth="2" />
    <path d="M14 11v4l2.5 2M11 5h6" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
