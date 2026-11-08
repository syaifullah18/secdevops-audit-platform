import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext.js";
import { topRole } from "../auth/session.js";
import { Icon } from "./Icon.js";
import { Pill } from "./stitch.js";

/** Avatar button with an account menu: identity, profile link and sign out. */
export function UserMenu() {
  const { user, signOut } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const role = topRole(user.roles);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-button"
        className="h-8 w-8 rounded-full bg-surface-container-high border border-outline-variant/60 flex items-center justify-center text-xs font-semibold text-on-surface hover:border-outline transition-colors"
      >
        {user.initials}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="user-menu"
          className="absolute right-0 mt-2 w-72 rounded-lg border border-outline-variant bg-surface-container-lowest shadow-xl p-2 z-50"
        >
          <div className="px-3 py-2.5 border-b border-outline-variant/50 mb-1">
            <div className="text-sm font-semibold truncate">{user.name}</div>
            <div className="text-[11px] text-on-surface-variant truncate">{user.subject}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {role && <Pill tone="neutral">{role}</Pill>}
              {user.demo && <Pill tone="advisory">Demo mode</Pill>}
            </div>
          </div>
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-surface-container transition-colors"
          >
            <Icon name="person" className="text-[18px] text-on-surface-variant" />
            Profile & access
          </Link>
          <button
            type="button"
            role="menuitem"
            data-testid="sign-out-button"
            onClick={() => {
              setOpen(false);
              signOut();
              navigate("/login", { replace: true });
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left hover:bg-surface-container transition-colors"
          >
            <Icon name="logout" className="text-[18px] text-on-surface-variant" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
