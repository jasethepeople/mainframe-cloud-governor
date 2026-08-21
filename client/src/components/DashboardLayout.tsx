import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { LogOut, Menu, ShieldCheck, type LucideIcon } from "lucide-react";
import { useState } from "react";

type NavigationItem = { label: string; icon: LucideIcon; active: boolean; onClick: () => void };

export default function DashboardLayout({ children, navigation }: { children: React.ReactNode; navigation: NavigationItem[] }) {
  const { loading, user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (loading) return <div className="mainframe-loading">INITIALIZING SECURE TERMINAL<span className="cursor-block">_</span></div>;
  if (!user) return <div className="mainframe-auth"><div className="mainframe-auth__grid" /><section className="auth-terminal"><div className="terminal-kicker">MANUS // ACCESS CONTROL // V2.6</div><h1>MAINFRAME<br /><span>CLOUD GOVERNOR</span></h1><p>A zero-trust control console for simulated infrastructure waste governance. Authenticate to access your private shred lists.</p><button className="mainframe-button mainframe-button--primary" onClick={() => startLogin()}>[ AUTHENTICATE OPERATOR ]</button><div className="auth-terminal__footer"><ShieldCheck size={15} /> CREDENTIALS REMAIN CLIENT-ENCRYPTED</div></section></div>;
  const choose = (item: NavigationItem) => { item.onClick(); setMobileOpen(false); };
  return <div className="mainframe-shell"><aside className={`mainframe-sidebar ${mobileOpen ? "mainframe-sidebar--open" : ""}`}><div className="mainframe-brand"><span className="brand-led" /> <span>MCG</span><small>V.81</small></div><div className="sidebar-caption">SYSTEM PANELS</div><nav className="mainframe-nav">{navigation.map(item => <button key={item.label} onClick={() => choose(item)} className={`mainframe-nav__item ${item.active ? "is-active" : ""}`}><item.icon size={17} /><span>{item.label}</span><i /></button>)}</nav><div className="sidebar-bottom"><div className="operator-readout"><span>OPERATOR</span><strong>{user.name || user.email || "AUTHORIZED USER"}</strong></div><button onClick={logout} className="signout-button"><LogOut size={15} /> TERMINATE SESSION</button></div></aside>{mobileOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}<div className="mainframe-stage"><header className="mainframe-topbar"><div><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><span className="topbar-prefix">NODE:</span> <strong>GOVERNOR-01</strong> <span className="status-live">SYSTEM NOMINAL</span></div><div className="topbar-time">UTC // {new Date().toISOString().slice(11, 19)}</div></header><main className="mainframe-content">{children}</main></div></div>;
}

