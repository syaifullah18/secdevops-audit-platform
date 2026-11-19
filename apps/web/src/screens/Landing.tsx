import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authApi, type AuthConfig } from "../api/auth.js";
import { Icon } from "../components/Icon.js";
import { btn } from "../components/stitch.js";
import { ThemeToggle } from "../components/ui/ThemeToggle.js";
import { useApp } from "../context/AppContext.js";

const REPO = "https://github.com/syaifullah18/secdevops-audit-platform";

const FEATURES = [
  {
    icon: "manage_search",
    title: "Audits of your real repositories",
    body: "Each run clones your repository at a pinned commit and works through reconnaissance, hunting and validation with the security-audit skill. Every step is recorded, and a killed run resumes where it stopped.",
  },
  {
    icon: "rule",
    title: "A verdict that can say “not yet”",
    body: "Findings are confirmed, rejected, or held as needs validation. The ones nobody has proven stay in a review queue for a person to decide, instead of being reported as facts.",
  },
  {
    icon: "gpp_good",
    title: "Policy that gates a release",
    body: "Write rules for which confirmed findings block a release. Waivers carry a reason and an expiry, and an expired waiver counts as open again.",
  },
  {
    icon: "apartment",
    title: "Scoped to the people who own it",
    body: "Access is by client and role. Sign-ups see nothing until an admin grants it, and every account action is written to an audit log you can export.",
  },
] as const;

const STEPS = [
  ["Add a repository", "Paste its URL. Name and slug are filled in for you."],
  [
    "Run an audit",
    "Pick the scope. Progress streams live, and the tokens and cost of each run are recorded.",
  ],
  ["Triage and gate", "Review what needs validation, grant waivers, and check release readiness."],
] as const;

const FAQ = [
  [
    "Where does my data live?",
    "In your own PostgreSQL database. You run the platform yourself; nothing is sent to us. Audit runs call the model provider you configure, and only that one.",
  ],
  [
    "Is it free?",
    "Yes. The platform is open source. You pay only for the model usage your audits consume, and the cost of each run is shown on it.",
  ],
  [
    "How do I trust a finding?",
    "A finding is confirmed only after a validation pass. Anything unproven is marked needs validation and waits in the review queue for a person.",
  ],
  [
    "Can I use it from CI?",
    "Yes. Create an API token in your account and call the API or the CLI. Tokens can be limited to fewer roles than their owner.",
  ],
  [
    "Is any of this a replacement for a pentest?",
    "No. It finds and tracks likely issues in source code. It does not test a running system, and a clean audit is not proof of safety.",
  ],
] as const;

const Section = ({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="py-14 border-t border-outline-variant/40">
    <div className="mx-auto max-w-5xl px-4">
      <h2 className="text-2xl font-bold font-headline tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-2xl text-on-surface-variant">{lead}</p>}
      <div className="mt-8">{children}</div>
    </div>
  </section>
);

const PROVIDER_LABEL = { google: "Google", github: "GitHub" } as const;

export function LandingScreen() {
  const { user } = useApp();
  // What this instance really offers: sign-up may be closed, and providers are opt-in.
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let live = true;
    authApi
      .config()
      .then((c) => live && setCfg(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const canSignUp = cfg?.native === true && cfg.signupMode === "open";
  const providers = (cfg?.providers ?? []).map((p) => PROVIDER_LABEL[p]);
  const trust = [
    ...(providers.length ? [`Sign in with ${providers.join(" or ")}`] : []),
    "Your data stays in your database",
  ].join(" · ");
  return (
    <div className="sdap-shell min-h-screen" data-testid="landing-screen">
      <header className="sticky top-0 z-10 border-b border-outline-variant/40 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:gap-4">
          <Link
            to="/welcome"
            className="flex shrink-0 items-center gap-2 font-bold font-headline"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <Icon name="security" filled className="text-lg" />
            </span>
            <span className="hidden sm:inline">SecDevOps Audit</span>
          </Link>
          <nav className="ml-4 hidden gap-5 text-sm text-on-surface-variant sm:flex">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#self-host">Self-host</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={REPO}
              className={`${btn.secondary} !hidden whitespace-nowrap sm:!inline-flex`}
              rel="noreferrer"
            >
              GitHub
            </a>
            {user ? (
              <Link
                to="/"
                className={`${btn.primary} whitespace-nowrap`}
                data-testid="landing-dashboard"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className={`${btn.secondary} whitespace-nowrap`}
                  data-testid="landing-login"
                >
                  Log in
                </Link>
                {canSignUp && (
                  <Link
                    to="/signup"
                    className={`${btn.primary} whitespace-nowrap`}
                    data-testid="landing-signup"
                  >
                    <span className="sm:hidden">Sign up</span>
                    <span className="hidden sm:inline">Create account</span>
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-5xl px-4 pt-16 pb-14 text-center">
          <p className="mx-auto mb-4 w-fit rounded-full border border-outline-variant/60 px-3 py-1 text-xs text-on-surface-variant">
            Open source · self-hosted
          </p>
          <h1 className="font-headline text-4xl font-bold tracking-tight sm:text-5xl">
            Know which security findings are real.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-on-surface-variant">
            An open-source platform that audits your repositories, proves each finding before it
            counts, and tracks it to closure, with a policy that can block a release.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to={user ? "/" : canSignUp ? "/signup" : "/login"}
              className={`${btn.primary} !px-5 !py-2.5 !text-sm`}
              data-testid="landing-cta"
            >
              {user ? "Open dashboard" : canSignUp ? "Create an account" : "Log in"}
            </Link>
            <a href="#how" className={`${btn.secondary} !px-5 !py-2.5 !text-sm`}>
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-on-surface-variant">{trust}</p>
        </div>

        <div className="mx-auto max-w-4xl px-4 pb-16">
          <div className="overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-2xl shadow-black/40">
            <div className="flex items-center gap-1.5 border-b border-outline-variant/60 bg-surface-container px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
              <span className="ml-3 truncate text-xs text-on-surface-variant">
                secdevops.ipungsyaifullah.my.id
              </span>
            </div>
            <img
              src="/demo.gif"
              alt="Walkthrough of the dashboard, release gate status, a compliance export, and the admin user list"
              width={1513}
              height={723}
              className="block h-auto w-full"
            />
          </div>
        </div>

        <Section
          id="features"
          title="Built to be believed"
          lead="The point is not more findings. It is knowing which ones to act on."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest p-5"
              >
                <Icon name={f.icon} className="text-2xl" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-on-surface-variant">{f.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="how" title="How it works">
          <ol className="grid list-none gap-4 sm:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li
                key={title}
                className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest p-5"
              >
                <span className="text-xs font-semibold text-on-surface-variant">Step {i + 1}</span>
                <h3 className="mt-1 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-on-surface-variant">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="self-host"
          title="Self-host in a few minutes"
          lead="You run it, so the findings, accounts and history are yours."
        >
          <pre className="overflow-x-auto rounded-lg border border-outline-variant/60 bg-zinc-950 p-4 text-sm text-zinc-100">
            {`git clone ${REPO}.git
cd secdevops-audit-platform
cp .env.example .env
docker compose up --build -d`}
          </pre>
          <ul className="mt-4 list-disc pl-5 text-sm text-on-surface-variant">
            <li>One PostgreSQL database holds everything.</li>
            <li>No third-party scripts or fonts are loaded in the app.</li>
            <li>
              Prometheus metrics and JSON logs are there when you want them; Grafana is optional.
            </li>
          </ul>
        </Section>

        <Section id="faq" title="Questions">
          <div className="divide-y divide-outline-variant/40 rounded-lg border border-outline-variant/60 bg-surface-container-lowest">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-4">
                <summary className="cursor-pointer list-none font-medium">{q}</summary>
                <p className="mt-2 text-sm text-on-surface-variant">{a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="border-t border-outline-variant/40 py-16 text-center">
          <h2 className="font-headline text-2xl font-bold tracking-tight">
            Audit your first repository today
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to={user ? "/" : canSignUp ? "/signup" : "/login"}
              className={`${btn.primary} !px-5 !py-2.5 !text-sm`}
            >
              {user ? "Open dashboard" : canSignUp ? "Create an account" : "Log in"}
            </Link>
            {!user && canSignUp && (
              <Link to="/login" className={`${btn.secondary} !px-5 !py-2.5 !text-sm`}>
                Log in
              </Link>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-outline-variant/40 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 text-xs text-on-surface-variant">
          <span>SecDevOps Audit Platform · open source</span>
          <a href={REPO} rel="noreferrer">
            Source on GitHub
          </a>
          <a href={`${REPO}/issues`} rel="noreferrer">
            Report an issue
          </a>
          <div className="ml-auto w-44">
            <ThemeToggle testId="landing-theme-toggle" />
          </div>
        </div>
      </footer>
    </div>
  );
}
