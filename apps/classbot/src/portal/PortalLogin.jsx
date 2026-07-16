import { AlertTriangle, ArrowRight, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { Brand } from "../components/AppShell.jsx";

export default function PortalLogin({ busy, error, onLogin }) {
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  return (
    <main className="portal-login-page">
      <section className="portal-login-card">
        <Brand />
        <div className="portal-login-icon"><UserRoundCheck size={27} /></div>
        <h1>학급 포털 입장</h1>
        <p>관리자가 등록한 이름과 정확히 같게 입력해 주세요.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && inviteCode.trim() && !busy) onLogin({ display_name: name.trim(), invite_code: inviteCode.trim() }); }}>
          <label>이름<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="이름을 입력하세요" autoFocus required disabled={busy} /></label>
          <label>초대 코드<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="one-time-code" inputMode="text" placeholder="관리자에게 받은 초대 코드" required disabled={busy} /></label>
          {error && <p className="form-error"><AlertTriangle size={16} />{error}</p>}
          <div className="portal-privacy"><ShieldCheck size={18} /><p>이름과 초대 코드는 최초 본인 확인에만 사용되며, 입장 후에는 안전한 쿠키로 상태가 유지됩니다.</p></div>
          <button className="primary-button wide" disabled={busy || !name.trim() || !inviteCode.trim()}>{busy ? "확인 중" : "내 일정 보기"}<ArrowRight size={18} /></button>
        </form>
        <a className="portal-admin-link" href="/login.html?next=/schedule/">관리자 로그인</a>
      </section>
    </main>
  );
}
