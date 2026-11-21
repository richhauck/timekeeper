import { SearchIcon } from './Icons'

interface Props {
  value: string
  onChange(v: string): void
  placeholder: string
  height?: number
  style?: React.CSSProperties
}

export function SearchInput({ value, onChange, placeholder, height = 40, style }: Props) {
  return (
    <div className="search" style={style}>
      <SearchIcon />
      <input type="search" className="input" aria-label={placeholder} placeholder={placeholder} value={value} style={{ height }} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
