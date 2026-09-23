import type { HTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider leading-4",
  {
    variants: {
      variant: {
        primary: "border-primary/40 bg-primary/15 text-primary",
        muted:   "border-border bg-secondary text-muted-foreground",
      },
    },
    defaultVariants: { variant: "muted" },
  }
)

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
