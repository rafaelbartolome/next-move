"use client";

import { useEffect, useMemo, useState } from "preact/hooks";
import { Link, useMutation, useQuery } from "@spacefast/zero/client";
import { Badge, Button, EmptyState, Input, Spinner } from "@spacefast/zero/kit";
import { FITS, OPENING_STATUSES, STATUSES, STATUS_LABELS, WORKPLACE_LABELS, type Status } from "../shared/contract";
import { JobDetail } from "../client/JobDetail";
import type { Job, Workspace } from "../client/types";
import { Chip, CompanyMark, FitBadge, NewBadge, PageHeading, Select, formatDate, isNew, needsRecheck, trackSalary } from "../client/ui";

type View = "active" | "shortlisted" | "applied" | "interviewing" | "offer" | "closed_out" | "not_interested";
const SORTS = ["fit", "found", "verified", "company", "activity"] as const;
type Sort = (typeof SORTS)[number];

const VIEWS: { id: View; label: string; matches: (status: Status) => boolean }[] = [
  { id: "active", label: "In play", matches: (s) => !["rejected", "withdrawn", "not_interested"].includes(s) },
  { id: "shortlisted", label: "Shortlisted", matches: (s) => s === "shortlisted" },
  { id: "applied", label: "Applied", matches: (s) => s === "applied" },
  { id: "interviewing", label: "Interviewing", matches: (s) => s === "interviewing" },
  { id: "offer", label: "Offers", matches: (s) => s === "offer" },
  { id: "closed_out", label: "Closed out", matches: (s) => s === "rejected" || s === "withdrawn" },
  { id: "not_interested", label: "Not interested", matches: (s) => s === "not_interested" },
];

const FILTERS_KEY = "nextmove.filters.v1";
const FIT_FILTERS = ["all", ...FITS] as const;
const AVAILABILITY_FILTERS = ["all", ...OPENING_STATUSES] as const;

type Filters = { view: View; search: string; trackKey: string; fit: string; availability: string; sort: Sort };

const DEFAULT_FILTERS: Filters = { view: "active", search: "", trackKey: "all", fit: "all", availability: "all", sort: "fit" };

/**
 * Filters live in localStorage so a reload keeps the view, search, role, match,
 * availability and sort the user was looking at. Stored values are checked against
 * the current options, so an old or hand-edited value can't hide every row.
 */
function restoreFilters(): Filters {
  if (typeof localStorage === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const saved = JSON.parse(raw) as Partial<Filters> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_FILTERS;
    return {
      view: VIEWS.some((v) => v.id === saved.view) ? (saved.view as View) : DEFAULT_FILTERS.view,
      search: typeof saved.search === "string" ? saved.search : DEFAULT_FILTERS.search,
      trackKey: typeof saved.trackKey === "string" ? saved.trackKey : DEFAULT_FILTERS.trackKey,
      fit: (FIT_FILTERS as readonly string[]).includes(saved.fit ?? "") ? (saved.fit as string) : DEFAULT_FILTERS.fit,
      availability: (AVAILABILITY_FILTERS as readonly string[]).includes(saved.availability ?? "")
        ? (saved.availability as string)
        : DEFAULT_FILTERS.availability,
      sort: (SORTS as readonly string[]).includes(saved.sort ?? "") ? (saved.sort as Sort) : DEFAULT_FILTERS.sort,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(filters: Filters): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Private mode or a full store: the filters still work for this visit.
  }
}

const FIT_RANK = { strong: 0, good: 1, stretch: 2 } as const;

function sortJobs(jobs: Job[], sort: Sort): Job[] {
  const copy = [...jobs];
  const byFound = (a: Job, b: Job) => b.firstFound.localeCompare(a.firstFound);
  switch (sort) {
    case "found":
      return copy.sort(byFound);
    case "verified":
      return copy.sort((a, b) => b.lastVerified.localeCompare(a.lastVerified));
    case "company":
      return copy.sort((a, b) => a.company.name.localeCompare(b.company.name));
    case "activity":
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    default:
      return copy.sort((a, b) => FIT_RANK[a.fit] - FIT_RANK[b.fit] || byFound(a, b));
  }
}

function Stat({ label, value, hint, highlight }: { label: string; value: number; hint: string; highlight?: boolean }) {
  return (
    <div class={highlight ? "rounded-xl border border-[#cfe3b4] bg-[#eef5e3] p-4 dark:border-[#3b5b45] dark:bg-[#1e3127]" : "rounded-xl border border-line bg-surface p-4"}>
      <p class="text-sm text-ink-muted">{label}</p>
      <p class="mt-2 text-3xl font-semibold tabular-nums text-ink">{value}</p>
      <p class="mt-1 text-xs text-ink-muted">{hint}</p>
    </div>
  );
}

/**
 * A click anywhere on a row opens it, except on the row's own controls, or when the click
 * ended a text selection. Mouse convenience only: the title button is still the way in for
 * keyboards and screen readers, so the row doesn't need a role of its own.
 */
function opensRow(event: MouseEvent): boolean {
  if ((event.target as Element).closest("a, button, select, input, textarea, label")) return false;
  return !window.getSelection()?.toString();
}

function JobRow({ job, today, trackTitle, onOpen }: { job: Job; today: string; trackTitle: string; onOpen: () => void }) {
  const setStatus = useMutation<[jobId: string, status: Status], void>("setStatus");
  return (
    <li
      class="group grid cursor-pointer gap-3 border-b border-line px-4 py-4 transition-colors last:border-b-0 hover:bg-accent/5 dark:hover:bg-accent/15 sm:px-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_7.5rem_auto] lg:items-center lg:gap-5"
      onClick={(event) => opensRow(event) && onOpen()}
    >
      <div class="flex min-w-0 gap-3">
        <CompanyMark name={job.company.name} website={job.company.website} icon={job.company.icon} />
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span class="font-medium">{job.company.name}</span>
            {isNew(job, today) ? <NewBadge /> : null}
            <span aria-hidden="true">·</span>
            <span>{trackTitle}</span>
          </p>
          <button type="button" class="mt-0.5 text-left font-semibold text-ink group-hover:text-accent hover:underline dark:group-hover:text-[#d8efa4]" onClick={onOpen}>
            {job.title}
          </button>
          <p class="mt-1 text-xs text-ink-muted">
            {job.location} · {WORKPLACE_LABELS[job.workplace] ?? job.workplace}
          </p>
          <p class="mt-1 flex flex-wrap gap-x-2 text-xs">
            <span class="text-ink-muted">Found {formatDate(job.firstFound)}</span>
            {job.openingStatus === "closed" ? <span class="font-medium text-danger">Listing closed</span> : null}
            {job.openingStatus === "unknown" ? <span class="font-medium text-warning">Availability unclear</span> : null}
            {needsRecheck(job, today) ? <span class="font-medium text-warning">Needs recheck</span> : null}
          </p>
        </div>
      </div>
      <div class="text-sm lg:pl-0">
        <p class="font-medium text-ink">{job.salary}</p>
        {job.caveats[0] ? <p class="mt-0.5 line-clamp-2 text-xs text-ink-muted">{job.caveats[0]}</p> : null}
      </div>
      <div>
        <FitBadge fit={job.fit} />
      </div>
      <div class="flex items-center gap-2">
        <Select
          aria-label={`Your progress for ${job.title} at ${job.company.name}`}
          value={job.status}
          onChange={(event) => void setStatus(job.id, (event.currentTarget as HTMLSelectElement).value as Status)}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        {job.status !== "not_interested" ? (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Not interested in ${job.title} at ${job.company.name}`}
            title="Not interested"
            icon="trash-2"
            onClick={() => void setStatus(job.id, "not_interested")}
          />
        ) : null}
        <a
          href={job.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the ${job.company.name} posting`}
          title="Open the employer posting"
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-canvas"
        >
          ↗
        </a>
      </div>
    </li>
  );
}

export default function OpportunitiesPage() {
  const data = useQuery<Workspace | null>("workspace");
  const [filters, setFilters] = useState<Filters>(restoreFilters);
  const { view, search, trackKey, fit, availability, sort } = filters;
  const [openId, setOpenId] = useState<string | null>(null);

  const jobs = data?.jobs ?? [];
  const tracks = data?.tracks ?? [];
  const trackTitles = useMemo(() => new Map(tracks.map((t) => [t.key, t.title])), [tracks]);

  const updateFilters = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // A saved role can disappear when roles are edited. Fall back to "all roles" rather than
  // showing an empty list behind a filter that no longer exists.
  useEffect(() => {
    if (trackKey === "all" || tracks.length === 0) return;
    if (!tracks.some((track) => track.key === trackKey)) setFilters((current) => ({ ...current, trackKey: "all" }));
  }, [trackKey, tracks]);

  const visible = useMemo(() => {
    const viewDef = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
    const needle = search.trim().toLowerCase();
    return sortJobs(
      jobs.filter((job) => {
        if (!viewDef.matches(job.status)) return false;
        if (trackKey !== "all" && job.trackKey !== trackKey) return false;
        if (fit !== "all" && job.fit !== fit) return false;
        if (availability !== "all" && job.openingStatus !== availability) return false;
        if (!needle) return true;
        return [job.title, job.company.name, job.location, job.company.industry, ...job.tags].join(" ").toLowerCase().includes(needle);
      }),
      sort,
    );
  }, [jobs, view, search, trackKey, fit, availability, sort]);

  if (data === undefined) {
    return (
      <div class="flex justify-center py-24">
        <Spinner label="Loading your opportunities" />
      </div>
    );
  }
  if (data === null) return null;

  const count = (status: Status) => jobs.filter((job) => job.status === status).length;
  const openJob = jobs.find((job) => job.id === openId) ?? null;
  const filtersActive = search || trackKey !== "all" || fit !== "all" || availability !== "all";

  return (
    <>
      <PageHeading eyebrow="The next chapter" title="A good place to land." intro="Your shortlist, your progress, your next move." />

      {data.profile ? (
        <div class="mb-6 flex flex-wrap gap-2">
          <Chip>{data.profile.location}</Chip>
          {tracks
            .filter((t) => t.active)
            .map((t) => (
              <Chip key={t.id}>
                {t.title} · {trackSalary(t)}
              </Chip>
            ))}
        </div>
      ) : null}

      <section aria-label="Application overview" class="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On your radar" value={count("shortlisted")} hint="Worth a closer look" highlight />
        <Stat label="Applied" value={count("applied")} hint="The first step is taken" />
        <Stat label="Interviewing" value={count("interviewing")} hint="Conversations in motion" />
        <Stat label="Offers" value={count("offer")} hint="Something to think about" />
      </section>

      {jobs.length === 0 ? (
        <div class="rounded-xl border border-line bg-surface p-8">
          <EmptyState
            icon="search"
            title="No openings yet"
            description={
              data.profile
                ? "Ask your agent to run a search. Copy the update prompt from Your agent."
                : "Start by giving your agent the onboarding prompt. It asks for your CV and the roles you want, then runs the first search."
            }
            action={
              <Link to="/agent" class="inline-flex rounded-lg bg-[#182e2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#244e3d] dark:bg-[#d8efa4] dark:text-[#182e2a] dark:hover:bg-[#c5e48a]">
                {data.profile ? "Get the update prompt" : "Get started"}
              </Link>
            }
          />
        </div>
      ) : (
        <section aria-labelledby="openings-heading">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="openings-heading" class="mr-2 text-xl font-semibold">
              Opportunities
            </h2>
            <Badge tone="neutral">{visible.length}</Badge>
          </div>

          <div role="tablist" aria-label="Pipeline" class="mb-4 flex gap-1 overflow-x-auto border-b border-line">
            {VIEWS.map((v) => {
              const n = jobs.filter((job) => v.matches(job.status)).length;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  class={
                    view === v.id
                      ? "-mb-px shrink-0 border-b-2 border-[#182e2a] px-3 py-2 text-sm font-semibold text-ink dark:border-[#d8efa4]"
                      : "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-ink-muted hover:text-ink"
                  }
                  onClick={() => updateFilters({ view: v.id })}
                >
                  {v.label} <span class="tabular-nums text-ink-muted">{n}</span>
                </button>
              );
            })}
          </div>

          <div class="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <Input
              type="search"
              placeholder="Search roles, companies, skills…"
              aria-label="Search roles, companies and skills"
              value={search}
              onInput={(event) => updateFilters({ search: (event.currentTarget as HTMLInputElement).value })}
            />
            <Select aria-label="Role" value={trackKey} onChange={(e) => updateFilters({ trackKey: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="all">All roles</option>
              {tracks.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))}
            </Select>
            <Select aria-label="Match" value={fit} onChange={(e) => updateFilters({ fit: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="all">All matches</option>
              <option value="strong">Strong match</option>
              <option value="good">Good match</option>
              <option value="stretch">Stretch</option>
            </Select>
            <Select aria-label="Listing availability" value={availability} onChange={(e) => updateFilters({ availability: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="all">Any availability</option>
              <option value="open">Open listings</option>
              <option value="unknown">Unconfirmed</option>
              <option value="closed">Closed listings</option>
            </Select>
            <Select aria-label="Sort" value={sort} onChange={(e) => updateFilters({ sort: (e.currentTarget as HTMLSelectElement).value as Sort })}>
              <option value="fit">Best match first</option>
              <option value="found">Newest found first</option>
              <option value="verified">Recently verified</option>
              <option value="company">Company A–Z</option>
              <option value="activity">Recent activity</option>
            </Select>
          </div>

          <div class="overflow-hidden rounded-xl border border-line bg-surface">
            {visible.length ? (
              <ul>
                {visible.map((job) => (
                  <JobRow key={job.id} job={job} today={data.today} trackTitle={trackTitles.get(job.trackKey) ?? job.trackKey} onOpen={() => setOpenId(job.id)} />
                ))}
              </ul>
            ) : (
              <div class="p-8">
                <EmptyState
                  icon="search"
                  title="Nothing here"
                  description={filtersActive ? "No openings match these filters." : "No openings in this part of your pipeline yet."}
                  action={
                    filtersActive ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          updateFilters({ search: "", trackKey: "all", fit: "all", availability: "all" });
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
          <p class="mt-3 text-xs text-ink-muted">Open a role for the company brief, fit notes and your private notes. Agents never see your notes.</p>
        </section>
      )}

      <JobDetail job={openJob} track={tracks.find((t) => t.key === openJob?.trackKey)} today={data.today} logs={data.logs} onClose={() => setOpenId(null)} />
    </>
  );
}
