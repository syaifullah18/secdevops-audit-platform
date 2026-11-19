import { useState, type FormEvent } from "react";
import type { Project } from "@sdap/core";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.js";
import { Field, FormError, errMsg } from "./Field.js";
import { btn } from "./stitch.js";

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Repo name from a git URL: `https://host/org/api.git` and `git@host:org/api.git` give `api`. */
const nameFromUrl = (url: string): string => {
  const last = url.trim().replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
};

/** Registers a repository so audits can run against it. Needs the devops or admin role. */
export function AddProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (p: Project) => void;
  onCancel: () => void;
}) {
  const { user } = useApp();
  const ownClient = Array.isArray(user?.clientIds) ? user.clientIds[0] : undefined;
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [branch, setBranch] = useState("main");
  const [team, setTeam] = useState(slugify(user?.team ?? "") || "default");
  const [clientId, setClientId] = useState(ownClient ?? "default");
  const [touched, setTouched] = useState({ name: false, slug: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRepo = (v: string) => {
    setRepoUrl(v);
    const guess = nameFromUrl(v);
    if (!touched.name) setName(guess);
    if (!touched.slug) setSlug(slugify(guess));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(
        await api.createProject({
          name: name.trim(),
          slug,
          repoUrl: repoUrl.trim(),
          defaultBranch: branch.trim() || "main",
          team,
          clientId,
        }),
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Add project"
      data-testid="add-project-form"
      className="rounded-lg border border-outline-variant/60 bg-surface-container-lowest shadow-sm p-5 grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <div className="md:col-span-2">
        <Field
          id="repo-url"
          label="Repository URL"
          required
          placeholder="https://github.com/org/repo.git"
          value={repoUrl}
          onChange={(e) => onRepo(e.target.value)}
          hint="The worker clones this address, so it must be reachable from where it runs."
          data-testid="repo-url-input"
        />
      </div>
      <Field
        id="project-name"
        label="Name"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setTouched((t) => ({ ...t, name: true }));
        }}
        data-testid="project-name-input"
      />
      <Field
        id="project-slug"
        label="Slug"
        required
        pattern="[a-z0-9][a-z0-9\-]*"
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value);
          setTouched((t) => ({ ...t, slug: true }));
        }}
        hint="Lowercase letters, numbers and dashes. Unique across the platform."
        data-testid="project-slug-input"
      />
      <Field
        id="project-branch"
        label="Default branch"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
      />
      <Field
        id="project-team"
        label="Team"
        required
        pattern="[a-z0-9][a-z0-9\-]*"
        value={team}
        onChange={(e) => setTeam(e.target.value)}
      />
      <Field
        id="project-client"
        label="Client"
        required
        pattern="[a-z0-9][a-z0-9\-]*"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        hint="Projects are isolated per client."
      />
      <div className="md:col-span-2 flex flex-col gap-3">
        <FormError message={error} />
        <div className="flex gap-2">
          <button
            type="submit"
            className={btn.primary}
            disabled={busy || !repoUrl || !name || !slug}
            data-testid="create-project-button"
          >
            {busy ? "Adding…" : "Add project"}
          </button>
          <button type="button" className={btn.secondary} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
