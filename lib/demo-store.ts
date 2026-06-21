import type { BatchStatus, CustodyEvent, Metrics, PickupRequest, Profile, RecyclingLog, WasteBatch } from "@/lib/types";
import { getDefaultCategoryCode } from "@/lib/waste-categories";

const now = new Date().toISOString();

type DemoStore = {
  batches: WasteBatch[];
  events: CustodyEvent[];
  pickups: PickupRequest[];
  recyclingLogs: RecyclingLog[];
  profiles: Profile[];
};

const globalStore = globalThis as typeof globalThis & {
  __sustainableEcgDemoStore?: DemoStore;
};

// Local dev and smoke tests use in-memory data. globalThis keeps separate
// Next route module instances pointed at the same shared store.
const initialBatches: WasteBatch[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    batch_code: "WM-2026-00125",
    generator_id: "11111111-1111-4111-8111-111111111111",
    waste_type: "plastic",
    category: getDefaultCategoryCode("plastic"),
    weight_kg: 240,
    pickup_address: "Plot 42, Peenya Industrial Area, Bengaluru, Karnataka",
    pickup_date: "2026-05-15",
    images: [],
    qr_token: "",
    status: "pending",
    created_at: now,
    generator: {
      company_name: "Aarav Packaging Pvt Ltd",
      phone: "+91 98765 43210"
    }
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    batch_code: "WM-2026-00124",
    generator_id: "11111111-1111-4111-8111-111111111111",
    waste_type: "e-waste",
    category: "EW-ITEW",
    weight_kg: 86,
    pickup_address: "Okhla Phase II, New Delhi",
    pickup_date: "2026-05-13",
    images: [],
    qr_token: "",
    status: "in_transit",
    created_at: now,
    generator: {
      company_name: "Aarav Packaging Pvt Ltd",
      phone: "+91 98765 43210"
    }
  }
];

const initialEvents: CustodyEvent[] = [
  {
    id: "evt-1",
    batch_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    actor_id: "11111111-1111-4111-8111-111111111111",
    event_type: "qr_generated",
    location_lat: null,
    location_lng: null,
    photo_url: null,
    weight_verified_kg: null,
    notes: "QR generated at batch creation.",
    created_at: now,
    actor: {
      company_name: "Aarav Packaging Pvt Ltd",
      role: "generator"
    }
  },
  {
    id: "evt-2",
    batch_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    actor_id: "22222222-2222-4222-8222-222222222222",
    event_type: "pickup_scanned",
    location_lat: 12.9716,
    location_lng: 77.5946,
    photo_url: null,
    weight_verified_kg: 85.5,
    notes: "Collector scanned QR and verified sealed cartons.",
    created_at: now,
    actor: {
      company_name: "GreenLoop Collection Services",
      role: "collector"
    }
  }
];

const initialProfiles: Profile[] = [
  {
    id: "pending-collector",
    role: "collector",
    company_name: "Northstar Field Logistics",
    phone: "+91 98989 77887",
    gst_number: "29AAECN9981B1Z3",
    status: "pending",
    created_at: now
  },
  {
    id: "pending-recycler",
    role: "recycler",
    company_name: "Urban Polymers Recovery",
    phone: "+91 97654 11220",
    gst_number: "27AAFCU2217L1Z5",
    status: "pending",
    created_at: now
  }
];

if (!globalStore.__sustainableEcgDemoStore) {
  globalStore.__sustainableEcgDemoStore = {
    batches: initialBatches,
    events: initialEvents,
    pickups: [],
    recyclingLogs: [],
    profiles: initialProfiles
  };
}

export const demoBatches = globalStore.__sustainableEcgDemoStore.batches;
export const demoEvents = globalStore.__sustainableEcgDemoStore.events;
export const demoPickups = globalStore.__sustainableEcgDemoStore.pickups;
export const demoRecyclingLogs = globalStore.__sustainableEcgDemoStore.recyclingLogs;
export const demoProfiles = globalStore.__sustainableEcgDemoStore.profiles;

export function computeMetrics(batches = demoBatches): Metrics {
  const byStatus = {
    pending: 0,
    assigned: 0,
    picked_up: 0,
    in_transit: 0,
    delivered: 0,
    recycled: 0
  } satisfies Record<BatchStatus, number>;

  for (const batch of batches) {
    byStatus[batch.status] += 1;
  }

  const totalKg = batches.reduce((sum, batch) => sum + Number(batch.weight_kg), 0);
  const recycledKg = batches
    .filter((batch) => batch.status === "recycled")
    .reduce((sum, batch) => sum + Number(batch.weight_kg), 0);

  return {
    totalBatches: batches.length,
    totalKg,
    recycledKg,
    pendingPickups: byStatus.pending + byStatus.assigned,
    activeCollectors: 12,
    pendingApprovals: demoProfiles.length,
    byStatus
  };
}
