import * as React from "react";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "confirmed"
  | "needs_validation"
  | "advisory";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const variantClass = `badge-${variant}`;
    const classes = ["badge", variantClass, className].filter(Boolean).join(" ");

    return <div ref={ref} className={classes} {...props} />;
  },
);
Badge.displayName = "Badge";
