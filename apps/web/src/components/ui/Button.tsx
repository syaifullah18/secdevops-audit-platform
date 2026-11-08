import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    const variantClass = `btn-${variant}`;
    const sizeClass = size === "default" ? "" : `btn-${size}`;
    const classes = ["btn", variantClass, sizeClass, className].filter(Boolean).join(" ");

    return <button ref={ref} className={classes} {...props} />;
  },
);
Button.displayName = "Button";
