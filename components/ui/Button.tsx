import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const base =
  'inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-neutral-100 text-neutral-900 hover:bg-black hover:text-neutral-100',
  secondary:
    'bg-neutral-900 text-neutral-100 border border-neutral-700 hover:bg-neutral-800',
}

const disabledClasses =
  'cursor-not-allowed opacity-50 hover:bg-inherit hover:text-inherit'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(base, variants[variant], disabled && disabledClasses, className)}
      {...rest}
    />
  )
})
