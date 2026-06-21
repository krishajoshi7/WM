import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { getAuthContext } from "@/lib/auth/server";
import { demoBatches, demoEvents } from "@/lib/demo-store";
import { hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CustodyEvent, WasteBatch } from "@/lib/types";
import { formatKg, statusLabel } from "@/lib/utils";
import { getWasteCategoryLabel } from "@/lib/waste-categories";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await getAuthContext(request, ["admin"]);
    const { batch, events } = await loadEvidencePacket(params.id);
    const pdf = buildEvidencePdf(batch, events);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${batch.batch_code}-custody-evidence.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function loadEvidencePacket(batchId: string) {
  if (!hasSupabaseConfig()) {
    const batch = demoBatches.find((item) => item.id === batchId);

    if (!batch) {
      throw new Response("Batch not found", { status: 404 });
    }

    return {
      batch,
      events: demoEvents
        .filter((event) => event.batch_id === batchId)
        .slice()
        .reverse()
    };
  }

  const supabase = createSupabaseAdminClient();
  const [{ data: batch, error: batchError }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase.from("waste_batches").select("*").eq("id", batchId).single(),
      supabase
        .from("custody_events")
        .select("*, actor:profiles!custody_events_actor_id_fkey(company_name, role)")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true })
    ]);

  if (batchError || !batch) {
    throw new Response("Batch not found", { status: 404 });
  }

  if (eventsError) {
    throw eventsError;
  }

  return {
    batch: batch as WasteBatch,
    events: (events || []) as CustodyEvent[]
  };
}

function buildEvidencePdf(batch: WasteBatch, events: CustodyEvent[]) {
  const lines = buildPacketLines(batch, events);
  const pages = paginate(lines, 46);
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const fontObjectId = 3;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (const pageLines of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = makeStream(pageLines);
  }

  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageObjectIds.length} >>`;

  return serializePdf(objects);
}

function buildPacketLines(batch: WasteBatch, events: CustodyEvent[]) {
  const lines: string[] = [
    "Sustainable ECG Custody Evidence Packet",
    `Generated: ${new Date().toLocaleString("en-IN")}`,
    "",
    `Batch: ${batch.batch_code}`,
    `Status: ${batch.status}`,
    `Waste type: ${batch.waste_type}`,
    `Category: ${getWasteCategoryLabel(batch.category)}`,
    `Weight: ${formatKg(batch.weight_kg)}`,
    `Pickup date: ${batch.pickup_date}`,
    `Pickup address: ${batch.pickup_address}`,
    "",
    "Generator batch images:"
  ];

  if (batch.images?.length) {
    batch.images.forEach((imageUrl, index) => {
      lines.push(...wrapLine(`${index + 1}. ${imageUrl}`, 92));
    });
  } else {
    lines.push("No generator batch images attached.");
  }

  lines.push("", "Custody timeline:");

  if (events.length === 0) {
    lines.push("No custody events recorded.");
  }

  for (const event of events) {
    lines.push("");
    lines.push(`${statusLabel(event.event_type)} | ${new Date(event.created_at).toLocaleString("en-IN")}`);
    lines.push(`Actor: ${event.actor?.company_name || event.actor_id} (${event.actor?.role || "system"})`);
    lines.push(`Weight: ${event.weight_verified_kg ? formatKg(event.weight_verified_kg) : "Not verified"}`);
    lines.push(`GPS: ${formatEventGps(event)}`);
    lines.push(...wrapLine(`Notes: ${event.notes || "No notes recorded"}`, 92));
    lines.push(...wrapLine(`Photo proof: ${event.photo_url || "No photo proof attached"}`, 92));
  }

  return lines.flatMap((line) => wrapLine(line, 96));
}

function paginate(lines: string[], linesPerPage: number) {
  const pages: string[][] = [];

  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  return pages.length ? pages : [["Sustainable ECG Custody Evidence Packet"]];
}

function wrapLine(line: string, width: number) {
  const words = normalizePdfText(line).split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (`${current} ${word}`.trim().length > width) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  return lines.length || current ? [...lines, current] : [""];
}

function makeStream(lines: string[]) {
  const text = [
    "BT",
    "/F1 10 Tf",
    "50 752 Td",
    "14 TL",
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET"
  ].join("\n");

  return `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`;
}

function serializePdf(objects: string[]) {
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(chunks.join(""), "latin1");
    chunks.push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length}\n`);
  chunks.push("0000000000 65535 f \n");

  for (let id = 1; id < objects.length; id += 1) {
    chunks.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }

  chunks.push(
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  return Buffer.from(chunks.join(""), "latin1");
}

function formatEventGps(event: CustodyEvent) {
  if (!event.location_lat || !event.location_lng) {
    return "Not captured";
  }

  return `${Number(event.location_lat).toFixed(5)}, ${Number(event.location_lng).toFixed(5)}`;
}

function normalizePdfText(value: string) {
  return value.replace(/[^\x20-\x7E]/g, " ");
}

function escapePdfText(value: string) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
