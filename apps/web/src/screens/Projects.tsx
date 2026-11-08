import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Finding, Project } from "@sdap/core";
import { api } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { ErrorBanner, Loading, PageHeader, Pill, btn, severityTone } from "../components/stitch.js";

/** Every audited repository, with its open confirmed findings at a glance. */
export function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.getProjects(), api.getFindings({ limit: 500 })])
      .then(([ps, page]) => {
        if (!mounted) return;
        setProjects(ps);
        setFindings(page.items);
      })
      .catch((e: unknown) => mounted && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!projects) return <Loading>Loading projects…</Loading>;

  return (
    <div className="flex flex-col gap-6" data-testid="projects-screen">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} ${projects.length === 1 ? "repository" : "repositories"} audited`}
      />
      {projects.length === 0 ? (
        <p className="text-sm text-on-surface-variant">No repositories yet.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {projects.map((p) => {
            const own = findings.filter((f) => f.projectId === p.id);
            const confirmed = own.filter((f) => f.verdict === "confirmed");
            const sev = (s: string) => confirmed.filter((f) => f.verifiedSeverity === s).length;
            const toValidate = own.filter((f) => f.verdict === "needs_validation").length;
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                data-testid={`project-card-${p.slug}`}
                className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 flex flex-col gap-3 hover:border-outline transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold font-headline truncate">{p.name}</h2>
                    <code className="block text-[11px] text-on-surface-variant font-mono truncate">
                      {p.repoUrl}
                    </code>
                  </div>
                  <Icon name="chevron_right" className="text-on-surface-variant" />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="call_split" className="text-sm" />
                    {p.defaultBranch}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="group" className="text-sm" />
                    {p.team}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="neutral">{confirmed.length} confirmed</Pill>
                  {(["critical", "high", "medium", "low"] as const).map(
                    (s) =>
                      sev(s) > 0 && (
                        <Pill key={s} tone={severityTone(s)}>
                          {sev(s)} {s}
                        </Pill>
                      ),
                  )}
                  {toValidate > 0 && <Pill tone="advisory">{toValidate} to validate</Pill>}
                </div>
                <span className={`${btn.secondary} self-start`}>View project</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
