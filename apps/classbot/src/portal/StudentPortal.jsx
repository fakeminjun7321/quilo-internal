import { CalendarDays, FolderOpen, LogOut, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "../components/AppShell.jsx";
import PortalCalendar from "./PortalCalendar.jsx";
import PortalDrive from "./PortalDrive.jsx";

export default function StudentPortal({ session, onLogout }) {
  const [active, setActive] = useState("calendar");
  const [identity, setIdentity] = useState({ member: session?.member || null, classroom: session?.classroom || null });
  useEffect(() => setIdentity((current) => ({ member: session?.member || current.member, classroom: session?.classroom || current.classroom })), [session]);
  const receiveOverview = useCallback((overview) => setIdentity({ member: overview.member || null, classroom: overview.classroom || null }), []);
  const memberName = identity.member?.display_name || session?.member?.display_name || "학생";
  const classroomName = identity.classroom?.name || session?.classroom?.name || "학급 포털";
  const nav = [
    ["calendar", "캘린더", CalendarDays],
    ["drive", "드라이브", FolderOpen],
  ];
  return (
    <div className="portal-shell">
      <header className="portal-header">
        <Brand />
        <nav className="portal-primary-nav" aria-label="학생 포털 메뉴">{nav.map(([id, label, Icon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => setActive(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <div className="portal-account"><span className="portal-account-copy"><small>{classroomName}</small><strong><UserRound size={15} />{memberName}</strong></span><button className="icon-button" onClick={onLogout} aria-label="학생 포털 로그아웃" title="로그아웃"><LogOut size={19} /></button></div>
      </header>
      <main className="portal-main">{active === "calendar" ? <PortalCalendar onOverview={receiveOverview} /> : <PortalDrive />}</main>
    </div>
  );
}
