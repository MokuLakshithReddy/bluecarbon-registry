import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from "react-leaflet";
import { Link } from "@tanstack/react-router";
import { ECOSYSTEM_LABEL, formatNumber, formatTco2e, type Ecosystem } from "@/lib/domain";

export interface MapMarker {
  id: string;
  code: string;
  name: string;
  status: string;
  ecosystem: string;
  state: string | null;
  area: number | null;
  carbon: number | null;
  latitude: number;
  longitude: number;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#8a94a6",
  SUBMITTED: "#3b74c4",
  UNDER_REVIEW: "#d99b32",
  CORRECTION_REQUIRED: "#c47f1f",
  VERIFIED: "#2f9e6e",
  REJECTED: "#c2453c",
};

function ClickCapture({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onSelect(Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5)));
    },
  });
  return null;
}

export default function ProjectMap({
  markers = [],
  center = [15.5, 79.5],
  zoom = 5,
  height = 420,
  selectable = false,
  onSelect,
  linkTo = "public",
}: {
  markers?: MapMarker[];
  center?: [number, number];
  zoom?: number;
  height?: number;
  selectable?: boolean;
  onSelect?: (lat: number, lng: number) => void;
  linkTo?: "public" | "review" | "none";
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border" style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {selectable && onSelect ? <ClickCapture onSelect={onSelect} /> : null}
        {markers.map((marker) => (
          <CircleMarker
            key={marker.id}
            center={[marker.latitude, marker.longitude]}
            radius={9}
            pathOptions={{
              color: STATUS_COLOR[marker.status] ?? STATUS_COLOR["DRAFT"],
              fillColor: STATUS_COLOR[marker.status] ?? STATUS_COLOR["DRAFT"],
              fillOpacity: 0.65,
              weight: 2,
            }}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-[0.8rem]">{marker.name}</p>
                <p className="text-muted-foreground">{marker.code}</p>
                <p>
                  {ECOSYSTEM_LABEL[marker.ecosystem as Ecosystem] ?? marker.ecosystem}
                  {marker.state ? ` · ${marker.state}` : ""}
                </p>
                <p>Status: {marker.status.replace("_", " ")}</p>
                <p>Area: {formatNumber(marker.area, " ha")}</p>
                <p>Verified Carbon Impact: {formatTco2e(marker.carbon)}</p>
                {linkTo === "public" ? (
                  <Link
                    to="/verify/$code"
                    params={{ code: marker.code }}
                    className="mt-1 inline-block font-semibold text-primary underline"
                  >
                    View Project
                  </Link>
                ) : null}
                {linkTo === "review" ? (
                  <Link
                    to="/review/$id"
                    params={{ id: marker.id }}
                    className="mt-1 inline-block font-semibold text-primary underline"
                  >
                    View Project
                  </Link>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
