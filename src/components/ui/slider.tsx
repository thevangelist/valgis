import * as React from "react"
import { cn } from "@/lib/utils"

type SliderProps = {
  min?: number
  max?: number
  value?: number[]
  defaultValue?: number[]
  onValueChange?: (value: number[]) => void
  className?: string
  disabled?: boolean
  trackGradient?: string
}

function Slider({ min = 0, max = 100, value, defaultValue, onValueChange, className, disabled, trackGradient }: SliderProps) {
  const controlled = value !== undefined
  const [internal, setInternal] = React.useState(defaultValue?.[0] ?? min)
  const current = controlled ? (value?.[0] ?? min) : internal

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (!controlled) setInternal(v)
    onValueChange?.([v])
  }

  const pct = ((current - min) / (max - min)) * 100

  return (
    <div className={cn("relative flex w-full touch-none items-center", className)}>
      {trackGradient ? (
        <div className="relative w-full h-1.5 rounded-full overflow-visible" style={{ background: trackGradient }}/>
      ) : (
        <div className="relative w-full h-1.5 rounded-full bg-gray-600 overflow-visible">
          <div
            className="absolute h-full rounded-full bg-blue-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={current}
        disabled={disabled}
        onChange={handleChange}
        className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        style={{ WebkitAppearance: 'none' }}
      />
      <div
        className="absolute w-3 h-3 rounded-full bg-white border border-gray-400 shadow pointer-events-none"
        style={{ left: `calc(${pct}% - 6px)` }}
      />
    </div>
  )
}

export { Slider }
