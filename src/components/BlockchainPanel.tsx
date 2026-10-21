import { useState } from "react";
import { Link as ChainIcon, ExternalLink, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { formatDate, formatTco2e, shortHash } from "@/lib/domain";
import { verifyOnChainTxFn } from "@/lib/registry.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export interface BlockchainRecordView {
  record_hash: string;
  tx_hash: string;
  block_number: number | null;
  network: string;
  status: string;
  created_at: string;
  verified_tco2e?: number | null;
  simulated?: boolean;
  explorer_url?: string | null;
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

  const isSimulated = record.simulated ?? /simulat|demo|testnet/i.test(record.network);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-gradient-deep px-5 py-4">
        <div className="flex items-center gap-2 text-navy-foreground">
          <ChainIcon className="size-4" />
          <p className="text-xs font-semibold uppercase tracking-widest">Blockchain Registry</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest ${
            isSimulated
              ? "bg-amber-500/20 text-amber-200 border border-amber-400/30"
              : "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30"
          }`}
        >
          {isSimulated ? "Simulated Demo Record" : "Live On-Chain Anchor"}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
        <Row
          label="Verification Status"
          value={record.status}
          strong={record.status === "CONFIRMED"}
        />
        <Row label="Network" value={record.network} />
        <Row label="Transaction Hash" value={shortHash(record.tx_hash, 10, 8)} mono title={record.tx_hash} />
        <Row label="Canonical Record Hash" value={shortHash(record.record_hash, 10, 8)} mono title={record.record_hash} />
        <Row label="Block Height" value={record.block_number ? `#${record.block_number.toLocaleString()}` : "Pending finality"} />
        <Row label="Anchored At" value={formatDate(record.created_at)} />
        {record.verified_tco2e != null ? (
          <Row label="Anchored Verified Impact" value={formatTco2e(record.verified_tco2e)} />
        ) : null}
        {projectCode ? <Row label="Project Code" value={projectCode} mono /> : null}
      </dl>

      <div className="border-t border-border bg-card/60 p-5">
        <VerifyChainButton record={record} />
      </div>

      <div className="flex items-start gap-2 border-t border-border bg-secondary/50 px-5 py-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ocean" />
        <p>
          Only the cryptographic SHA-256 digest of the canonical verified record is anchored — no photographs,
          identifying documents or raw datasets are stored on-chain. The anchor guarantees tamper-evidence of
          the verified submission record; it does not constitute an issued or tradable carbon credit.
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
        className={`mt-0.5 text-sm ${mono ? "mono-hash" : ""} ${
          strong ? "font-semibold text-success" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function VerifyChainButton({ record }: { record: BlockchainRecordView }) {
  const isSimulated = record.simulated ?? /simulat|demo|testnet/i.test(record.network);
  const verifyTx = useServerFn(verifyOnChainTxFn);
  const [verifying, setVerifying] = useState(false);
  const [report, setReport] = useState<{
    verified: boolean;
    confirmations?: number;
    receiptStatus?: string;
    network?: string;
  } | null>(null);

  const handleVerify = async () => {
    if (record.explorer_url && !isSimulated) {
      window.open(record.explorer_url, "_blank", "noopener");
      return;
    }

    setVerifying(true);
    try {
      const res = await verifyTx({
        data: {
          txHash: record.tx_hash,
          recordHash: record.record_hash,
        },
      });

      setReport({
        verified: res.isVerified,
        confirmations: res.confirmations,
        receiptStatus: res.receiptStatus,
        network: res.network,
      });

      if (res.isVerified) {
        toast.success(
          isSimulated
            ? "Record hash matches canonical demonstration ledger."
            : `Verified on-chain (${res.confirmations} confirmations).`,
        );
      } else {
        toast.error(res.error || "On-chain verification could not be confirmed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification query failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={verifying}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {verifying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {isSimulated ? "Inspect Simulation Proof" : "Verify On-Chain Finality"}
        </button>

        {record.explorer_url ? (
          <a
            href={record.explorer_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Open in Block Explorer <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>

      {report ? (
        <div
          className={`flex items-start gap-2 rounded-lg p-3 text-xs ${
            report.verified ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }`}
        >
          {report.verified ? (
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">
              {report.verified
                ? isSimulated
                  ? "Simulation digest match confirmed"
                  : `On-chain confirmation validated (${report.confirmations} blocks)`
                : "Record verification failed or pending finality"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Network: {report.network} · Receipt: {report.receiptStatus}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
