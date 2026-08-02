/** Serializable shapes for the public community feed. */
export interface PublicCommunityPost {
  id: string;
  title: string;
  body: string | null;
  media_url: string | null;
  media_type: "image" | "video";
  author_name: string;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
  project_id: string | null;
  created_at: string;
}
