# WS2 contract requests

WS2 coded around each of these locally (marked `TODO(contract)`); none blocks the API. Proposals
are for the contract owner to apply in `packages/core`.

## 1. Per-project webhook secret

**What:** the card requires an HMAC secret per project, but `Project` has nowhere to reference one.

**Why:** today secrets come from the `WEBHOOK_SECRETS` env var (`{ "<projectIdOrSlug>": "<secret>" }`)
or an injected `webhookSecretResolver`. That cannot be rotated per project at runtime and does not
survive multiple API replicas without shared config.

**Proposal:** store a reference, never the secret itself (secrets live in the vault):

```ts
// project.ts, in Project
webhookSecretRef: z.string().min(1).nullable().default(null),
```

The API resolves the reference through its `webhookSecretResolver`.

## 2. Exception lifecycle and policy ownership

**What:** `PolicyRepo` can add and list exceptions but not revoke them, and `Policy` has no client.

**Why:**

- Re-opening an `accepted_risk` or `false_positive` finding leaves its exception in the store.
  The gate currently ignores exceptions created before a later "reopen" triage event, which costs
  one history lookup per excepted finding. A revoke removes the need for that workaround.
- Policies are not tenant-scoped, so `GET/PUT /policies/:id` can only decide visibility through
  the projects that reference the policy (a policy not yet attached to any project is readable by
  nobody except platform-wide scopes).

**Proposal:**

```ts
// store.ts, PolicyRepo
revokeException(id: string): Promise<void>;
get(id: string, scope: AccessScope): Promise<Policy | null>; // filtered by policy.clientId

// policy.ts, in Policy
clientId: Slug.nullable().default(null), // null = platform-wide, visible to every client
```

## 3. Event sequence allocation

**What:** `EventRepo.append` takes a caller-chosen `seq`; the API appends `run.queued` (seq 0) and
`run.cancelled` (max + 1) while the worker also appends.

**Why:** `(runId, seq)` is unique, so concurrent writers can collide.

**Proposal:** `EventRepo.appendNext(e: Omit<PlatformEvent, "seq">): Promise<PlatformEvent>` that
allocates `seq` atomically.

## 4. Store readiness probe

**What:** `/readyz` has no dedicated check; it runs a list with an empty scope.

**Proposal:** `Store.ping(): Promise<void>`.
