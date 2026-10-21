import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileText, MapPin } from "lucide-react";
import { getSignedEvidenceUrls } from "@/lib/registry.functions";
import { EVIDENCE_TYPE_LABEL, formatDate, type EvidenceRow } from "@/lib/domain";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function useEvidenceUrls(items: Pick<EvidenceRow, "file_url">[]) {
  const sign = useServerFn(getSignedEvidenceUrls);
  const urls = useMemo(() => items.map((i) => i.file_url).filter((u): u is string => !!u), [items]);
  const needsSigning = urls.some((u) => u.startsWith("storage://"));
  const { data } = useQuery({
    queryKey: ["evidence-urls", urls],
    queryFn: () => sign({ data: { urls } }),
    enabled: needsSigning && urls.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  return (raw: string | null | undefined) => {
    if (!raw) return null;
    if (!raw.startsWith("storage://")) return raw;
    return (data as Record<string, string | null> | undefined)?.[raw] ?? null;
  };
}

const REVIEW_TONE: Record<string, string> = {
  VALID: "bg-success/12 text-success",
  SUSPICIOUS: "bg-destructive/10 text-destructive",
  PENDING: "bg-muted text-muted-foreground",
};

export function EvidenceGallery({
  items,
  canReview = false,
  onReview,
  emptyLabel = "No field evidence uploaded yet.",
}: {
  items: EvidenceRow[];
  canReview?: boolean;
  onReview?: (id: string, status: "VALID" | "SUSPICIOUS", comment: string) => Promise<void> | void;
  emptyLabel?: string;
}) {
  const resolve = useEvidenceUrls(items);
  const [active, setActive] = useState<EvidenceRow | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (items.length === 0) {
    return (
      <div className="panel flex flex-col items-center justify-center gap-2 p-8 text-center">
        <FileText className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  const isImage = (item: EvidenceRow) =>
    /\.(png|jpe?g|webp|gif|avif)$/i.test(item.file_name) ||
    item.evidence_type === "FIELD_PHOTO" ||
    item.evidence_type === "DRONE_IMAGERY";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const url = resolve(item.file_url);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActive(item);
                setComment(item.reviewer_comment ?? "");
              }}
              className="panel overflow-hidden text-left transition-shadow hover:shadow-raised"
            >
              <div className="flex h-36 items-center justify-center overflow-hidden bg-secondary">
                {url && isImage(item) ? (
                  <img
                    src={url}
                    alt={item.file_name}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <FileText className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{item.file_name}</p>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase ${REVIEW_TONE[item.review_status] ?? REVIEW_TONE["PENDING"]}`}
                  >
                    {item.review_status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {EVIDENCE_TYPE_LABEL[item.evidence_type] ?? item.evidence_type} ·{" "}
                  {formatDate(item.capture_date)}
                </p>
                {item.latitude != null && item.longitude != null ? (
                  <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                    <MapPin className="size-3" /> {item.latitude.toFixed(4)},{" "}
                    {item.longitude.toFixed(4)}
                  </p>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-2xl">
          {active ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate">{active.file_name}</DialogTitle>
                <DialogDescription>
                  {active.evidence_code ?? active.id.slice(0, 8)} ·{" "}
                  {EVIDENCE_TYPE_LABEL[active.evidence_type] ?? active.evidence_type}
                </DialogDescription>
              </DialogHeader>
              {resolve(active.file_url) && isImage(active) ? (
                <img
                  src={resolve(active.file_url)!}
                  alt={active.file_name}
                  className="max-h-72 w-full rounded-lg object-cover"
                />
              ) : resolve(active.file_url) ? (
                <a
                  href={resolve(active.file_url)!}
                  target="_blank"
                  rel="noopener"
                  className="text-sm font-semibold text-primary underline"
                >
                  Open file
                </a>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <Meta label="Evidence ID" value={active.evidence_code ?? active.id.slice(0, 8)} />
                <Meta label="Uploaded" value={formatDate(active.created_at)} />
                <Meta label="Capture Date" value={formatDate(active.capture_date)} />
                <Meta
                  label="GPS"
                  value={
                    active.latitude != null && active.longitude != null
                      ? `${active.latitude.toFixed(5)}, ${active.longitude.toFixed(5)}`
                      : "Not available"
                  }
                />
                <Meta label="Uploaded By" value={active.uploaded_by_email ?? "—"} />
                <Meta label="Verification Status" value={active.review_status} />
              </dl>
              {canReview && onReview ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Verifier comment on this evidence item (optional)"
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await onReview(active.id, "VALID", comment);
                        setBusy(false);
                        setActive(null);
                      }}
                    >
                      <CheckCircle2 className="size-4" /> Mark Valid
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await onReview(active.id, "SUSPICIOUS", comment);
                        setBusy(false);
                        setActive(null);
                      }}
                    >
                      <AlertTriangle className="size-4" /> Mark Suspicious
                    </Button>
                  </div>
                </div>
              ) : active.reviewer_comment ? (
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  Verifier note: {active.reviewer_comment}
                </p>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
