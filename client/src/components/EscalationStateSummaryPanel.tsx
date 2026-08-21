import { trpc } from "@/lib/trpc";
import { CheckCircle2, CircleDot, Route } from "lucide-react";
import { toast } from "sonner";

export function EscalationStateSummaryPanel() {
  const utils = trpc.useUtils();
  const alerts = trpc.governance.localAgentReadinessAlerts.useQuery();
  const completeEscalation = trpc.governance.completeLocalAgentEscalation.useMutation();
  const complete = async (alertId: number) => { try { await completeEscalation.mutateAsync({ alertId }); await Promise.all([utils.governance.localAgentReadinessAlerts.invalidate(), utils.governance.auditEvents.invalidate()]); toast.success("ESCALATION RESPONSE COMPLETED"); } catch (error) { toast.error(error instanceof Error ? error.message : "Escalation response could not be completed"); } };
  const active = (alerts.data ?? []).filter(alert => alert.status !== "resolved");
  return <><style>{`.state-panel{padding:18px}.state-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #543913}.state-row strong{display:block;color:#efb657;font-size:10px}.state-row small{display:block;margin-top:4px;color:#946b30;font-size:8px}.state-row em{display:block;color:#e8ac47;font-size:8px;font-style:normal;margin-bottom:6px}.state-icon{color:#efb657;vertical-align:middle;margin-right:6px}`}</style><section className="terminal-panel state-panel"><h2 className="panel-title"><b>STG</b><span>ESCALATION STATE TRACKER</span></h2>{active.map(alert => <div className="state-row" key={alert.id}><div><strong>{alert.escalationState === "response_complete" ? <CheckCircle2 className="state-icon" size={14} /> : alert.escalationState === "handoff_recorded" ? <Route className="state-icon" size={14} /> : <CircleDot className="state-icon" size={14} />}{alert.alertType.replaceAll("_", " ").toUpperCase()}</strong><small>ASSIGNEE: {alert.assigneeName ?? "UNASSIGNED"} · {alert.assigneeEmail ?? "NO CONTACT"}</small></div><div><em>{alert.escalationState.replaceAll("_", " ").toUpperCase()}</em>{alert.escalationState === "handoff_recorded" && <button type="button" className="mainframe-button" onClick={() => complete(alert.id)} disabled={completeEscalation.isPending}>COMPLETE RESPONSE</button>}</div></div>)}{!active.length && <p className="empty-terminal">NO ESCALATION STATES IN FLIGHT<span className="cursor-block">_</span></p>}</section></>;
}
