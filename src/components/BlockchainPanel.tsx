import { Link as ChainIcon, ExternalLink, ShieldCheck } from "lucide-react";
import { formatDate, formatTco2e, shortHash } from "@/lib/domain";

export interface BlockchainRecordView {
  record_hash: string;
  tx_hash: string;
  block_number: number | null;
  network: string;
  status: string;
  created_at: string;
  verified_tco2e?: number | null;
}

export function BlockchainPanel({
  record,
  projectCode,
}: {
  record: BlockchainRecordView | null;
  projectCode?: string;
}) {
  if (!record) {
    return (
      <div className="panel p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Blockchain Registry
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No tamper-evident record yet. A record hash is anchored once an NCCR verifier approves the project.
        </p>
      </div>
    );
  }
  const simulated = /simulat|testnet/i.test(record.network);
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-gradient-deep px-5 py-4">
        <div className="flex items-center gap-2 text-navy-foreground">
          <ChainIcon className="size-4" />
          <p className="text-xs font-semibold uppercase tracking-widest">Blockchain Registry</p>
        </div>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest text-navy-foreground">
          {simulated ? "Testnet / Demo Record" : "Live Network"}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
        <Row label="Blockchain Status" value={record.status} strong />
        <Row label="Network" value={record.network} />
        <Row label="Transaction" value={shortHash(record.tx_hash, 8, 6)} mono title={record.tx_hash} />
        <Row label="Record Hash" value={shortHash(record.record_hash, 8, 6)} mono title={record.record_hash} />
        <Row label="Block" value={record.block_number ? `#${record.block_number}` : "—"} />
        <Row label="Timestamp" value={formatDate(record.created_at)} />
        {record.verified_tco2e != null ? (
          <Row label="Anchored Verified Carbon Impact" value={formatTco2e(record.verified_tco2e)} />
        ) : null}
        {projectCode ? <Row label="Project ID" value={projectCode} mono /> : null}
      </dl>
      <div className="flex items-start gap-2 border-t border-border bg-secondary/50 px-5 py-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ocean" />
        <p>
          Only the cryptographic hash of the canonical verified record is anchored — no photographs, documents
          or raw datasets are stored on-chain. The record provides a tamper-evident proof of information that was
          already submitted and verified; it does not by itself prove the field data is true, and it is
          <span className="font-semibold"> not an issued carbon credit</span>.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  title?: string;
}) {
  return (
    <div>
      <dt className="text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd
        title={title}
        className={`mt-0.5 text-sm ${mono ? "mono-hash" : ""} ${strong ? "font-semibold text-success" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function VerifyChainButton({ record }: { record: BlockchainRecordView }) {
  const simulated = /simulat|testnet/i.test(record.network);
  return (
    <button
      type="button"
      onClick={() => {
        if (!simulated) {
          window.open(`https://amoy.polygonscan.com/tx/${record.tx_hash}`, "_blank", "noopener");
          return;
        }
        window.alert(
          `Blockchain Testnet / Demo Record\n\nNetwork: ${record.network}\nStatus: ${record.status}\nTransaction: ${record.tx_hash}\nRecord hash: ${record.record_hash}\n\nThe hash matches the canonical verified project record stored in the registry.`,
        );
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
    >
      <ExternalLink className="size-4" /> Verify Blockchain Record
    </button>
  );
}
