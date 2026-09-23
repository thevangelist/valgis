import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:   "bg-primary text-primary-foreground border-transparent hover:bg-cyan-300 active:bg-cyan-500",
        secondary: "bg-secondary text-secondary-foreground border-transparent hover:bg-accent",
        outline:   "bg-transparent text-foreground border-border hover:bg-secondary",
        ghost:     "bg-transparent text-muted-foreground border-transparent hover:bg-secondary hover:text-foreground",
      },
      size: {
        sm:   "h-7 px-2 text-xs",
        md:   "h-8 px-3",
        lg:   "h-11 px-5",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0",
      },
      active: {
        true: "bg-accent text-foreground border-accent",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, active, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size, active, className }))} {...props} />
  )
)
Button.displayName = "Button"

export { Button, buttonVariants }
