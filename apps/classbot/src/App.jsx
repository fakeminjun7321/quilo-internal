import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, RotateCw } from "lucide-react";
import { api } from "./api/client.js";
import { BottomNavigation, Brand, Sidebar, Topbar } from "./components/AppShell.jsx";
import { EventDrawer, NoticeDrawer } from "./components/Editors.jsx";
import TodayPage from "./pages/TodayPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import TimetablePage from "./pages/TimetablePage.jsx";
import NoticesPage from "./pages/NoticesPage.jsx";
import MembersPage from "./pages/MembersPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

const actions = { today: "일정 추가", events: "일정 추가", notices: "공지 추가" };

function Login({ onLogin, busy, error }) {
  const [password, setPassword] = useState("");
  return <main className="login-page"><div className="login-card"><Brand /><div className="login-icon"><LockKeyhole size={25} /></div><h1>관리자 로그인</h1><p>학급 일정과 카카오톡 알림을 관리하려면 로그인해 주세요.</p><form onSubmit={(e) => { e.preventDefault(); onLogin(password); }}><label>관리자 비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required /></label>{error && <p className="form-error"><AlertTriangle size={16} />{error}</p>}<button className="primary-button wide" disabled={busy}>{busy ? "확인 중" : "로그인"}</button></form></div></main>;
}

function ConnectionError({ message, onRetry }) {
  return <main className="connection-error"><div><AlertTriangle size={28} /><h1>관리 서버에 연결할 수 없습니다.</h1><p>{message || "잠시 후 다시 시도해 주세요."}</p><button className="outline-button" onClick={onRetry}><RotateCw size={17} />다시 시도</button></div></main>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [overview, setOverview] = useState(null);
  const [active, setActive] = useState("today");
  const [drawer, setDrawer] = useState({ type: null, item: null, open: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const flash = (message) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      const nextSession = await api.session();
      setSession(nextSession);
      if (nextSession.authenticated) {
        const data = await api.overview();
        setSession({ ...nextSession, demo: nextSession.demo || api.mode === "local" });
        setOverview(data);
        if (window.matchMedia("(min-width: 1181px)").matches) setDrawer({ type: "event", item: null, open: true });
      }
    } catch (err) {
      setLoadError(err.message || "관리 서버 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const patchCollection = (collection, item) => setOverview((current) => ({ ...current, [collection]: current[collection].map((existing) => existing.id === item.id ? item : existing) }));
  const addCollection = (collection, item) => setOverview((current) => ({ ...current, [collection]: [item, ...current[collection]] }));

  const login = async (password) => {
    setBusy(true); setError("");
    try { const result = await api.login(password); setSession(result); setOverview(await api.overview()); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const openCreate = () => setDrawer({ type: active === "notices" ? "notice" : "event", item: null, open: true });
  const closeDrawer = () => setDrawer((current) => ({ ...current, open: false }));
  const saveEvent = async (input) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = drawer.item ? await api.updateEvent(drawer.item.id, input) : await api.createEvent(input);
      drawer.item ? patchCollection("events", result.item) : addCollection("events", result.item);
      closeDrawer(); flash(drawer.item ? "일정을 수정했습니다." : "새 일정을 추가했습니다.");
    } catch (err) { flash(err.message); } finally { setBusy(false); }
  };
  const deleteEvent = async () => { if (busy || !drawer.item || !window.confirm("이 일정을 삭제할까요?")) return; setBusy(true); try { await api.deleteEvent(drawer.item.id); setOverview((current) => ({ ...current, events: current.events.filter((item) => item.id !== drawer.item.id) })); closeDrawer(); flash("일정을 삭제했습니다."); } finally { setBusy(false); } };
  const saveNotice = async (input) => { if (busy) return; setBusy(true); try { const result = drawer.item ? await api.updateNotice(drawer.item.id, input) : await api.createNotice(input); drawer.item ? patchCollection("notices", result.item) : addCollection("notices", result.item); closeDrawer(); flash("공지를 저장했습니다."); } catch (err) { flash(err.message); } finally { setBusy(false); } };
  const deleteNotice = async () => { if (busy || !drawer.item || !window.confirm("이 공지를 삭제할까요?")) return; setBusy(true); try { await api.deleteNotice(drawer.item.id); setOverview((current) => ({ ...current, notices: current.notices.filter((item) => item.id !== drawer.item.id) })); closeDrawer(); flash("공지를 삭제했습니다."); } finally { setBusy(false); } };
  const navigate = (id) => { setActive(id); if (drawer.open) closeDrawer(); };

  const screen = useMemo(() => {
    if (!overview) return null;
    if (active === "today") return <TodayPage overview={overview} onEditEvent={(item) => setDrawer({ type: "event", item, open: true })} onNavigate={navigate} />;
    if (active === "events") return <EventsPage events={overview.events} members={overview.members} onEdit={(item) => setDrawer({ type: "event", item, open: true })} />;
    if (active === "timetable") return <TimetablePage timetable={overview.timetable} saving={busy} onSave={async (weekday, items) => { if (busy) return; setBusy(true); try { const result = await api.saveTimetable(weekday, items); setOverview((current) => ({ ...current, timetable: [...current.timetable.filter((item) => item.weekday !== weekday), ...result.items] })); flash(`${["", "월", "화", "수", "목", "금"][weekday]}요일 시간표를 저장했습니다.`); } catch (err) { flash(err.message); } finally { setBusy(false); } }} />;
    if (active === "notices") return <NoticesPage notices={overview.notices} onEdit={(item) => setDrawer({ type: "notice", item, open: true })} onSend={async (id) => { if (busy) return; setBusy(true); try { const result = await api.sendNotice(id); patchCollection("notices", result.item); flash("게시 요청을 접수했습니다. 전송 결과는 알림 기록에서 확인하세요."); } catch (err) { flash(err.message); } finally { setBusy(false); } }} />;
    if (active === "members") return <MembersPage members={overview.members} classroom={overview.classroom} busy={busy} onCreate={async (input) => { if (busy) return false; setBusy(true); try { const result = await api.createMember(input); addCollection("members", result.item); flash("구성원을 추가했습니다."); return true; } catch (err) { flash(err.message); return false; } finally { setBusy(false); } }} onUpdate={async (id, patch) => { if (busy) return; setBusy(true); try { const result = await api.updateMember(id, patch); patchCollection("members", result.item); } catch (err) { flash(err.message); } finally { setBusy(false); } }} onInvite={async (id) => { if (busy) return; setBusy(true); try { const result = await api.inviteMember(id); await navigator.clipboard?.writeText(result.invite_url || result.code || ""); flash("초대 링크를 복사했습니다."); } catch (err) { flash(err.message); } finally { setBusy(false); } }} />;
    if (active === "notifications") return <NotificationsPage notifications={overview.notifications} busy={busy} onRefresh={async () => { if (busy) return; setBusy(true); try { const result = await api.notifications(); setOverview((current) => ({ ...current, notifications: result.items })); flash("알림 상태를 새로고침했습니다."); } catch (err) { flash(err.message); } finally { setBusy(false); } }} onTest={async () => { if (busy) return; setBusy(true); try { const result = await api.testNotification(); if (result.item) addCollection("notifications", result.item); flash("테스트 알림 요청을 접수했습니다. 아직 전송 완료 상태는 아닙니다."); } catch (err) { flash(err.message); } finally { setBusy(false); } }} />;
    return <SettingsPage classroom={overview.classroom} saving={busy} onSave={async (patch) => { if (busy) return; setBusy(true); try { const result = await api.updateSettings(patch); setOverview((current) => ({ ...current, classroom: result.item })); flash("설정을 저장했습니다."); } catch (err) { flash(err.message); } finally { setBusy(false); } }} onLogout={async () => { await api.logout(); setSession({ authenticated: false }); setOverview(null); }} />;
  }, [active, overview, busy, drawer.item]);

  if (loading) return <div className="app-loading"><RotateCw className="spin" /><span>학급 정보를 불러오는 중</span></div>;
  if (loadError && !overview) return <ConnectionError message={loadError} onRetry={load} />;
  if (!session) return <ConnectionError message="관리자 세션을 확인하지 못했습니다." onRetry={load} />;
  if (!session.authenticated) return <Login onLogin={login} busy={busy} error={error} />;
  if (!overview) return <div className="app-loading"><AlertTriangle /><span>{error || "데이터를 불러오지 못했습니다."}</span><button className="outline-button" onClick={load}>다시 시도</button></div>;
  return (
    <div className={`app-shell ${drawer.open ? "drawer-open" : ""}`}>
      <Sidebar active={active} onNavigate={navigate} classroom={overview.classroom} memberCount={overview.members.length} />
      <div className="workspace"><Topbar classroom={overview.classroom} action={actions[active]} onAction={openCreate} demoMode={session.demo || api.mode === "local"} /><main className="main-content">{screen}</main></div>
      <EventDrawer open={drawer.open && drawer.type === "event"} item={drawer.item} members={overview.members} onClose={closeDrawer} onSave={saveEvent} onDelete={deleteEvent} busy={busy} />
      <NoticeDrawer open={drawer.open && drawer.type === "notice"} item={drawer.item} onClose={closeDrawer} onSave={saveNotice} onDelete={deleteNotice} busy={busy} />
      <BottomNavigation active={active} onNavigate={navigate} />
      {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}
