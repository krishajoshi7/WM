export type UserRole = "generator" | "collector" | "recycler" | "admin";

export type ProfileStatus = "pending" | "approved" | "suspended";

export type BatchStatus =
  | "pending"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "recycled";

export type CustodyEventType =
  | "qr_generated"
  | "pickup_accepted"
  | "pickup_scanned"
  | "in_transit"
  | "delivered"
  | "recycled"
  | "rejected";

export type WasteType = "plastic" | "e-waste" | "metal" | "glass" | "organic";

export type Profile = {
  id: string;
  role: UserRole;
  company_name: string | null;
  phone: string | null;
  gst_number: string | null;
  status: ProfileStatus;
  created_at: string;
};

export type WasteBatch = {
  id: string;
  batch_code: string;
  generator_id: string;
  waste_type: WasteType;
  category: string;
  weight_kg: number;
  pickup_address: string;
  pickup_date: string;
  images: string[] | null;
  qr_token: string;
  status: BatchStatus;
  created_at: string;
  generator?: Pick<Profile, "company_name" | "phone"> | null;
};

export type CustodyEvent = {
  id: string;
  batch_id: string;
  actor_id: string;
  event_type: CustodyEventType;
  location_lat: number | null;
  location_lng: number | null;
  photo_url: string | null;
  weight_verified_kg: number | null;
  notes: string | null;
  created_at: string;
  actor?: Pick<Profile, "company_name" | "role"> | null;
};

export type PickupRequest = {
  id: string;
  batch_id: string;
  collector_id: string;
  status: "pending" | "accepted" | "rejected" | "completed";
  accepted_at: string | null;
  estimated_pickup: string | null;
  created_at: string;
};

export type RecyclingLog = {
  id: string;
  batch_id: string;
  recycler_id: string;
  material_type: string;
  quantity_kg: number;
  recycling_method: string;
  epr_credits_claimed: number;
  report_url: string | null;
  created_at: string;
};

export type WebhookDelivery = {
  id: string;
  delivery_type: "epr_recycled";
  batch_id: string;
  idempotency_key: string;
  endpoint_url: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "delivered" | "failed" | "abandoned";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  last_status_code: number | null;
  last_response_body: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminAuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type Metrics = {
  totalBatches: number;
  totalKg: number;
  recycledKg: number;
  pendingPickups: number;
  activeCollectors: number;
  pendingApprovals: number;
  byStatus: Record<BatchStatus, number>;
};
