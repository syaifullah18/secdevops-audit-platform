import * as React from "react";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={`textarea ${className}`.trim()} {...props} />
  ),
);
Textarea.displayName = "Textarea";
