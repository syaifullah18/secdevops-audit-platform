import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", type = "text", ...props }, ref) => (
    <input ref={ref} type={type} className={`input ${className}`.trim()} {...props} />
  ),
);
Input.displayName = "Input";
