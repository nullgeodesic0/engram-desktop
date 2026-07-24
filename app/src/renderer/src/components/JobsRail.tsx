export interface Job {
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
  artifactPath: string | null
}

export function JobsRail({ jobs, onOpenArtifact }: { jobs: Job[]; onOpenArtifact: (path: string) => void }) {
  if (jobs.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">Background jobs</div>
      {jobs.map((job) => (
        <div key={job.id} className="panel px-3 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
            <span
              aria-hidden="true"
              className={
                job.status === 'running'
                  ? 'text-[var(--color-ink-violet)] animate-pulse'
                  : job.status === 'done'
                    ? 'text-[var(--color-ink-violet)]'
                    : 'text-[var(--color-ink-danger)]'
              }
            >
              {job.status === 'running' ? '◐' : job.status === 'done' ? '●' : '✕'}
            </span>
            {job.label}
          </div>
          {job.status === 'done' && job.artifactPath && (
            <button
              onClick={() => onOpenArtifact(job.artifactPath!)}
              className="focus-ring text-xs text-[var(--color-ink-violet)] hover:underline"
            >
              Open →
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
