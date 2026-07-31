import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import type { MapMarker } from "./ProjectMap";

const LazyProjectMap = lazy(() => import("./ProjectMap"));

function MapSkeleton({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-border bg-secondary text-xs text-muted-foreground"
      style={{ height }}
    >
      Loading coastal map…
    </div>
  );
}

export function MapPanel(props: {
  markers?: MapMarker[];
  center?: [number, number];
  zoom?: number;
  height?: number;
  selectable?: boolean;
  onSelect?: (lat: number, lng: number) => void;
  linkTo?: "public" | "review" | "none";
}) {
  const height = props.height ?? 420;
  return (
    <ClientOnly fallback={<MapSkeleton height={height} />}>
      <Suspense fallback={<MapSkeleton height={height} />}>
        <LazyProjectMap {...props} height={height} />
      </Suspense>
    </ClientOnly>
  );
}

export type { MapMarker };
