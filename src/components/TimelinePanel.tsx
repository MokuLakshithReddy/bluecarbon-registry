import { formatDate } from "@/lib/domain";

export interface TimelineEvent {
  label: string;
  detail?: string | null;
  created_at: string;
  actor_email?: string | null;
}

export function TimelinePanel({ events, title = "Project Status Timeline" }: { events: TimelineEvent[]; title?: string }) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No timeline events recorded yet.</p>
      ) : (
        <ol className="mt-4 space-y-0">
          {events.map((event, index) => (
            <li key={`${event.label}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">
              <div className="flex flex-col items-center">
                <span className="mt-1 size-2.5 rounded-full bg-teal ring-4 ring-teal/15" />
                {index < events.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-sm font-semibold text-foreground">{event.label}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(event.created_at)}
                  {event.actor_email ? ` · ${event.actor_email}` : ""}
                </p>
                {event.detail ? <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
