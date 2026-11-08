import * as React from "react";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "destructive" | "warning" | "success" | "advisory";
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className = "", variant = "default", ...props }, ref) => {
    const variantClass = `alert-${variant}`;
    const classes = ["alert", variantClass, className].filter(Boolean).join(" ");

    return <div ref={ref} role="alert" className={classes} {...props} />;
  },
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className = "", ...props }, ref) => (
  <h5 ref={ref} className={`alert-title ${className}`.trim()} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className = "", ...props }, ref) => (
  <div ref={ref} className={`alert-description ${className}`.trim()} {...props} />
));
AlertDescription.displayName = "AlertDescription";
