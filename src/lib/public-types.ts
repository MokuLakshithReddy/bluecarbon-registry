/** Serializable shapes returned by the public (no-login) verification endpoints. */
export interface PublicEvidence {
  id: string;
  file_name: string;
  file_url: string | null;
  evidence_type: string;
  capture_date: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PublicTimelineEvent {
  label: string;
  detail: string | null;
  created_at: string;
}

export interface PublicBlockchainRecord {
  record_hash: string;
  tx_hash: string;
  block_number: number | null;
  network: string;
  status: string;
  created_at: string;
}

export interface PublicProjectDetail {
  id: string;
  project_code: string;
  name: string;
  organization: string | null;
  description: string | null;
  ecosystem: string;
  state: string | null;
  district: string | null;
  coastal_area: string | null;
  latitude: number | null;
  longitude: number | null;
  area_hectares: number | null;
  restoration_start: string | null;
  restoration_end: string | null;
  restoration_method: string | null;
  species: string | null;
  estimated_carbon: number | null;
  verified_carbon: number | null;
  status: string;
  verified_at: string | null;
  verifier_name: string | null;
  created_at: string;
  submitted_at: string | null;
}

export interface PublicProjectPayload {
  project: PublicProjectDetail;
  blockchain: PublicBlockchainRecord | null;
  timeline: PublicTimelineEvent[];
  evidence: PublicEvidence[];
}

export interface PublicProjectSummary {
  project_code: string;
  name: string;
  organization: string | null;
  ecosystem: string;
  state: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  area_hectares: number | null;
  verified_carbon: number | null;
  verified_at: string | null;
  status: string;
}
