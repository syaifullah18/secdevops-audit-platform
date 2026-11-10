import { providerStartUrl } from "../api/auth.js";
import { btn } from "./stitch.js";

const LABEL: Record<string, string> = { google: "Google", github: "GitHub" };
// Google first, then GitHub, whatever order the server lists them in.
const ORDER = ["google", "github"];

function Mark({ provider }: { provider: string }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.15 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.76 12 4.76Z"
      />
    </svg>
  );
}

/** "Continue with Google / GitHub", shown above the email form on sign-in and sign-up. */
export function ProviderButtons({ providers, verb }: { providers: string[]; verb: string }) {
  const list = ORDER.filter((p) => providers.includes(p)).concat(
    providers.filter((p) => !ORDER.includes(p)),
  );
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {list.map((p) => (
        <a
          key={p}
          href={providerStartUrl(p)}
          className={`${btn.secondary} justify-center`}
          data-testid={`provider-${p}`}
        >
          <Mark provider={p} />
          {verb} with {LABEL[p] ?? p}
        </a>
      ))}
    </div>
  );
}

export function OrDivider({ label = "or use email" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
      <span className="h-px flex-1 bg-outline-variant/50" />
      {label}
      <span className="h-px flex-1 bg-outline-variant/50" />
    </div>
  );
}
