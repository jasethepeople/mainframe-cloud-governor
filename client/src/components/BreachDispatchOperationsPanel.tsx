import { trpc } from "@/lib/trpc";
import { breachDispatchTimelineToCsv } from "@/lib/breachDispatchExport";
import { CheckCircle2, FileDown, Filter, RadioTower } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type TimelineFilter = "all" | "prepared" | "confirmed" | "failed";

const RUNBOOK = `# Mainframe Cloud Governor — sealed-route SLA-breach delivery

## Local agent configuration (keep this file on the operator-controlled machine)
{
  "escalation": {
    "profileId": "<MANUALLY_TESTED_ROUTE_ID>",
    "endpoint": "https://<MANUALLY_TESTED_ROUTE_HOST>/...",
    "token": "<LOCAL_ROUTE_SECRET>",
    "tokenHeader": "Authorization"
  }
}

## Safe execution sequence
1. In Production Gate, complete a manual test on the sealed route and record its evidence.
2. Select that route in SLA-Breach Auto-Escalation and arm the mechanical policy switch.
3. When an overdue incident qualifies, copy the generated sealed_route_escalation manifest.
4. Save the manifest locally and execute:
   node agent/mainframe-local-agent.mjs execute manifest.json agent-config.json ~/.config/mainframe-governor/agent-private.pem
5. Paste the returned signed receipt and signature into Zero-Trust Local Agent Bridge.
6. Confirm that the Breach Dispatch Timeline records VERIFIED RECEIPT CONFIRMED.
7. If a signed receipt reports delivery failure, correct the local route and prepare the one guarded retry from SLA-Breach Auto-Escalation.

The app never receives route credentials. The local agent refuses a manifest unless its route profile ID and endpoint host match the local configuration.`;

export function BreachDispatchOperationsPanel() {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const input = useMemo(() => ({ filter }), [filter]);
  const timeline = trpc.governance.slaBreachDispatchTimeline.useQuery(input);
  const downloadRunbook = () => {
    const href = URL.createObjectURL(new Blob([RUNBOOK], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = href; link.download = "mainframe-governor-sealed-route-runbook.md"; link.click(); URL.revokeObjectURL(href);
    toast.success("SEALED-ROUTE RUNBOOK DOWNLOADED");
  };
  const exportTimeline = () => {
    const href = URL.createObjectURL(new Blob([breachDispatchTimelineToCsv(timeline.data ?? [])], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = href; link.download = `mainframe-governor-breach-dispatch-${filter}.csv`; link.click(); URL.revokeObjectURL(href);
    toast.success("FILTERED BREACH TIMELINE EXPORTED");
  };
  return <><style>{`.breach-ops{padding:18px;margin-top:18px}.breach-ops-grid{display:grid;grid-template-columns:.72fr 1.28fr;gap:16px}.breach-ops-card{padding:15px;border:1px solid #5d4014;background:linear-gradient(135deg,#160e04,#0a0602)}.breach-ops-card h3{margin:0;color:#f1b95a;font:18px "VT323",monospace;letter-spacing:.06em}.breach-ops-card p{color:#ab7836;font-size:10px;line-height:1.65}.breach-ops-card select{width:100%;min-height:35px;margin:10px 0;padding:0 9px;border:1px solid #76511d;background:#080501;color:#ffd474;font:10px "Share Tech Mono",monospace}.breach-receipt{display:flex;gap:10px;padding:12px;border:1px solid #654618;background:#0b0702}.breach-receipt svg{flex:none;color:#efb04b}.breach-receipt strong{display:block;color:#edb556;font-size:10px}.breach-receipt small{display:block;margin-top:4px;color:#967033;font-size:8px;line-height:1.55}.breach-timeline{display:grid;gap:8px;margin-top:8px}.breach-timeline-item{display:grid;grid-template-columns:auto 1fr;gap:9px;padding:10px;border-left:2px solid #a66d1e;background:#0b0702}.breach-timeline-item svg{margin-top:1px;color:#efb04b}.breach-timeline-item b{display:block;color:#ecb353;font-size:9px}.breach-timeline-item small{display:block;margin-top:4px;color:#927033;font-size:8px;line-height:1.55}.breach-empty{padding:14px;border:1px dashed #5a3d12;color:#966f31;font-size:9px}.breach-timeline-actions{display:flex;justify-content:flex-end;margin:-2px 0 10px}@media(max-width:760px){.breach-ops-grid{grid-template-columns:1fr}}`}</style><section className="terminal-panel breach-ops"><h2 className="panel-title"><b>RCP</b><span>BREACH DISPATCH RECEIPTS + RUNBOOK</span></h2><div className="breach-ops-grid"><article className="breach-ops-card"><h3>LOCAL DELIVERY RUNBOOK</h3><p>Download the credential-free operating sequence for the locally held sealed route. It documents profile/host matching and signed receipt submission without exporting a secret.</p><button type="button" className="mainframe-button mainframe-button--primary" onClick={downloadRunbook}><FileDown size={15} /> DOWNLOAD RUNBOOK</button><div className="breach-receipt" style={{ marginTop: 13 }}><RadioTower size={19} /><div><strong>RECEIPT CONFIRMATION + RETRY RULE</strong><small>A confirmation requires a verified receipt for the matching incident and route with a successful 2xx local delivery. A verified failure records evidence and permits one guarded retry while the incident remains overdue.</small></div></div></article><article className="breach-ops-card"><h3>BREACH DISPATCH TIMELINE</h3><select aria-label="Filter breach dispatch timeline" value={filter} onChange={event => setFilter(event.target.value as TimelineFilter)}><option value="all">ALL BREACH DISPATCH EVENTS</option><option value="prepared">PREPARED MANIFESTS ONLY</option><option value="confirmed">VERIFIED RECEIPTS ONLY</option><option value="failed">VERIFIED DELIVERY FAILURES ONLY</option></select><div className="breach-timeline-actions"><button type="button" className="mainframe-button" disabled={timeline.isLoading || !timeline.data?.length} onClick={exportTimeline}><FileDown size={14} /> EXPORT FILTERED CSV</button></div><div className="breach-timeline">{(timeline.data ?? []).map(event => <div className="breach-timeline-item" key={event.id}><CheckCircle2 size={15} /><div><b>{event.eventType === "sla_breach_dispatch_receipt_confirmed" ? "VERIFIED RECEIPT CONFIRMED" : event.eventType === "sla_breach_dispatch_delivery_failed" ? "VERIFIED DELIVERY FAILURE // RETRY GUIDANCE" : "SEALED-ROUTE DISPATCH PREPARED"} // INCIDENT #{String(event.alertId).padStart(4, "0")}</b><small>{event.summary}<br />{event.profileLabel ? `${event.profileLabel.toUpperCase()} // ${event.endpointHost}` : "ROUTE METADATA UNAVAILABLE"} · {new Date(event.createdAt).toLocaleString()}</small></div></div>)}{!timeline.isLoading && !timeline.data?.length && <div className="breach-empty"><Filter size={14} /> NO MATCHING BREACH DISPATCH EVENTS.</div>}</div></article></div></section></>;
}
