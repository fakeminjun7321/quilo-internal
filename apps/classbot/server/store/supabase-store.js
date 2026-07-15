import { createClient } from "@supabase/supabase-js";
import { hashInviteCode } from "../security.js";
import { parseKoreaDateTime } from "../time.js";

function unwrap(result, message) {
  if (result.error) throw new Error(`${message}: ${result.error.message}`);
  return result.data;
}

function redactAuditData(value) {
  if (Array.isArray(value)) return value.map(redactAuditData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "kakao_user_key" || key === "code_hash" ? "[redacted]" : redactAuditData(item),
    ]),
  );
}

function fetchWithTimeout(url, options = {}) {
  const timeout = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, signal });
}

export class SupabaseStore {
  constructor(config) {
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    });
    this.classroom = null;
  }

  async initialize() {
    const existing = unwrap(
      await this.client.from("classbot_classes").select("*").eq("code", this.config.classCode).maybeSingle(),
      "학급 조회 실패",
    );
    if (existing) {
      this.classroom = existing;
    } else {
      this.classroom = unwrap(
        await this.client
          .from("classbot_classes")
          .insert({ code: this.config.classCode, name: this.config.className, timezone: this.config.timezone })
          .select("*")
          .single(),
        "학급 생성 실패",
      );
    }
  }

  async ensureClassroom() {
    if (!this.classroom) await this.initialize();
    return this.classroom;
  }

  async healthCheck() {
    await this.ensureClassroom();
    const version = unwrap(await this.client.rpc("classbot_health_check"), "학급 저장소 상태 확인 실패");
    if (Number(version) !== 1) throw new Error("지원하지 않는 Classbot 데이터베이스 스키마입니다.");
    return { ok: true, storage: "supabase" };
  }

  async getClassroom() {
    const classroom = await this.ensureClassroom();
    const fresh = unwrap(
      await this.client.from("classbot_classes").select("*").eq("id", classroom.id).single(),
      "학급 조회 실패",
    );
    this.classroom = fresh;
    return fresh;
  }

  async updateSettings(patch, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const allowed = Object.fromEntries(
      Object.entries(patch).filter(([key]) => ["daily_digest_time", "daily_digest_enabled", "name"].includes(key)),
    );
    const updated = unwrap(
      await this.client.from("classbot_classes").update(allowed).eq("id", classroom.id).select("*").single(),
      "학급 설정 저장 실패",
    );
    this.classroom = updated;
    await this.appendAudit({ actor, action: "settings.update", entityType: "classroom", entityId: classroom.id, after: updated });
    return updated;
  }

  async listMembers() {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client.from("classbot_members").select("*").eq("class_id", classroom.id).order("display_name"),
      "구성원 조회 실패",
    );
  }

  async getMember(memberId) {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client.from("classbot_members").select("*").eq("class_id", classroom.id).eq("id", memberId).maybeSingle(),
      "구성원 조회 실패",
    );
  }

  async createMember(input, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const created = unwrap(
      await this.client.rpc("classbot_create_member", {
        p_class_id: classroom.id,
        p_display_name: String(input.display_name || "").trim(),
        p_role: input.role === "admin" ? "admin" : "student",
      }),
      "구성원 생성 실패",
    );
    const member = created?.[0];
    if (!member) throw new Error("구성원을 생성하지 못했습니다.");
    await this.appendAudit({ actor, action: "member.create", entityType: "member", entityId: member.id, after: member });
    return member;
  }

  async seedMembersIfEmpty(items, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const count = Number(unwrap(
      await this.client.rpc("classbot_seed_members_if_empty", {
        p_class_id: classroom.id,
        p_members: items,
      }),
      "초기 구성원 명단 생성 실패",
    ) || 0);
    if (count > 0) {
      await this.appendAudit({
        actor,
        action: "member.seed",
        entityType: "member",
        entityId: "initial-roster",
        after: { count },
      });
    }
    return count;
  }

  async updateMember(memberId, patch, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const allowed = Object.fromEntries(
      Object.entries(patch).filter(([key]) => ["display_name", "role", "notification_enabled", "daily_digest_enabled", "status"].includes(key)),
    );
    const member = unwrap(
      await this.client.from("classbot_members").update(allowed).eq("class_id", classroom.id).eq("id", memberId).select("*").single(),
      "구성원 저장 실패",
    );
    await this.appendAudit({ actor, action: "member.update", entityType: "member", entityId: member.id, after: member });
    return member;
  }

  async createInvite({ memberId, codeHash, expiresAt }, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const member = unwrap(
      await this.client.from("classbot_members").select("id,status").eq("class_id", classroom.id).eq("id", memberId).maybeSingle(),
      "초대 대상 조회 실패",
    );
    if (!member) throw new Error("초대할 구성원을 찾을 수 없습니다.");
    if (member.status === "active") throw new Error("이미 가입한 구성원에게 초대 코드를 만들 수 없습니다.");
    unwrap(
      await this.client
        .from("classbot_invites")
        .update({ used_at: new Date().toISOString() })
        .eq("class_id", classroom.id)
        .eq("member_id", memberId)
        .is("used_at", null),
      "기존 초대 코드 정리 실패",
    );
    const invite = unwrap(
      await this.client
        .from("classbot_invites")
        .insert({ class_id: classroom.id, member_id: memberId, code_hash: codeHash, expires_at: expiresAt })
        .select("*")
        .single(),
      "초대 코드 생성 실패",
    );
    await this.appendAudit({ actor, action: "invite.create", entityType: "invite", entityId: invite.id, after: { ...invite, code_hash: "[redacted]" } });
    return invite;
  }

  async claimInvite({ code, userKey, userKeyType = "botUserKey" }) {
    const classroom = await this.ensureClassroom();
    const codeHash = hashInviteCode(code);
    const claimed = unwrap(
      await this.client.rpc("classbot_claim_invite", {
        p_class_id: classroom.id,
        p_code_hash: codeHash,
        p_user_key: userKey,
        p_user_key_type: userKeyType,
      }),
      "초대 코드 가입 처리 실패",
    );
    const member = claimed?.[0];
    if (!member) throw new Error("초대 코드가 올바르지 않거나 만료되었습니다.");
    await this.appendAudit({ actor: member.id, action: "invite.claim", entityType: "member", entityId: member.id, after: { status: "active" } });
    return member;
  }

  async findMemberByUserKey(userKey) {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client
        .from("classbot_members")
        .select("*")
        .eq("class_id", classroom.id)
        .eq("kakao_user_key", userKey)
        .eq("status", "active")
        .maybeSingle(),
      "구성원 조회 실패",
    );
  }

  async listTimetable({ weekday } = {}) {
    const classroom = await this.ensureClassroom();
    let query = this.client.from("classbot_timetable").select("*").eq("class_id", classroom.id);
    if (weekday != null) query = query.eq("weekday", Number(weekday));
    return unwrap(await query.order("weekday").order("period"), "시간표 조회 실패");
  }

  async replaceTimetableDay({ weekday, rows }, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const numericWeekday = Number(weekday);
    if (!Number.isInteger(numericWeekday) || numericWeekday < 1 || numericWeekday > 5) throw new Error("요일은 월요일부터 금요일까지만 선택할 수 있습니다.");
    const payload = rows
      .filter((row) => String(row.subject || "").trim())
      .map((row, index) => ({
        class_id: classroom.id,
        weekday: numericWeekday,
        period: Number(row.period || index + 1),
        subject: String(row.subject).trim(),
        activity: String(row.activity || "").trim(),
        teacher: String(row.teacher || "").trim(),
        room: String(row.room || "").trim(),
        memo: String(row.memo || "").trim(),
        effective_from: row.effective_from || new Date().toISOString().slice(0, 10),
        effective_to: row.effective_to || null,
      }));
    const saved = unwrap(
      await this.client.rpc("classbot_replace_timetable_day", {
        p_class_id: classroom.id,
        p_weekday: numericWeekday,
        p_rows: payload,
      }),
      "시간표 저장 실패",
    );
    await this.appendAudit({ actor, action: "timetable.replace", entityType: "timetable", entityId: String(numericWeekday), after: saved });
    return saved;
  }

  async listEvents({ from, to, status, targetMemberId } = {}) {
    const classroom = await this.ensureClassroom();
    let query = this.client.from("classbot_events").select("*").eq("class_id", classroom.id);
    if (from) query = query.gte("due_at", from);
    if (to) query = query.lte("due_at", to);
    if (status) query = query.eq("status", status);
    if (targetMemberId !== undefined) query = query.or(`member_id.is.null,member_id.eq.${targetMemberId}`);
    return unwrap(await query.order("due_at"), "일정 조회 실패");
  }

  async getEvent(eventId) {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client.from("classbot_events").select("*").eq("class_id", classroom.id).eq("id", eventId).maybeSingle(),
      "일정 조회 실패",
    );
  }

  async createEvent(input, actor = "admin") {
    const classroom = await this.ensureClassroom();
    if (input.member_id) {
      const member = await this.getMember(input.member_id);
      if (!member || member.status === "left") throw new Error("개인 일정을 등록할 구성원을 찾을 수 없습니다.");
    }
    if (input.request_key) {
      const existing = unwrap(
        await this.client
          .from("classbot_events")
          .select("*")
          .eq("class_id", classroom.id)
          .eq("request_key", input.request_key)
          .maybeSingle(),
        "중복 일정 확인 실패",
      );
      if (existing) return existing;
    }
    const result = await this.client
        .from("classbot_events")
        .insert({
          class_id: classroom.id,
          member_id: input.member_id || null,
          category: input.category || "assessment",
          subject: String(input.subject || "").trim(),
          title: String(input.title || "").trim(),
          description: String(input.description || "").trim(),
          due_at: parseKoreaDateTime(input.due_at).toISOString(),
          reminder_offsets: input.reminder_offsets || [4320, 1440, 0],
          notify_on_change: input.notify_on_change !== false,
          request_key: input.request_key || null,
          created_by: actor,
        })
        .select("*")
        .single();
    if (result.error && input.request_key && result.error.code === "23505") {
      const existing = unwrap(
        await this.client.from("classbot_events").select("*").eq("class_id", classroom.id).eq("request_key", input.request_key).single(),
        "중복 일정 조회 실패",
      );
      return existing;
    }
    const event = unwrap(result, "일정 생성 실패");
    await this.appendAudit({ actor, action: "event.create", entityType: "event", entityId: event.id, after: event });
    return event;
  }

  async updateEvent(eventId, patch, actor = "admin") {
    const classroom = await this.ensureClassroom();
    if (patch.member_id) {
      const member = await this.getMember(patch.member_id);
      if (!member || member.status === "left") throw new Error("개인 일정을 등록할 구성원을 찾을 수 없습니다.");
    }
    const allowed = Object.fromEntries(
      Object.entries(patch).filter(([key]) => ["member_id", "category", "subject", "title", "description", "status", "notify_on_change", "reminder_offsets"].includes(key)),
    );
    if (patch.due_at !== undefined) allowed.due_at = parseKoreaDateTime(patch.due_at).toISOString();
    const event = unwrap(
      await this.client.from("classbot_events").update(allowed).eq("class_id", classroom.id).eq("id", eventId).select("*").single(),
      "일정 저장 실패",
    );
    await this.appendAudit({ actor, action: "event.update", entityType: "event", entityId: event.id, after: event });
    return event;
  }

  async cancelEvent(eventId, actor = "admin") {
    return this.updateEvent(eventId, { status: "cancelled" }, actor);
  }

  async listNotices({ status, limit = 50 } = {}) {
    const classroom = await this.ensureClassroom();
    let query = this.client
      .from("classbot_notices")
      .select("*")
      .eq("class_id", classroom.id)
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(Number(limit) || 50);
    if (status) query = query.eq("status", status);
    return unwrap(await query, "공지 조회 실패");
  }

  async getNotice(noticeId) {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client.from("classbot_notices").select("*").eq("class_id", classroom.id).eq("id", noticeId).maybeSingle(),
      "공지 조회 실패",
    );
  }

  async createNotice(input, actor = "admin") {
    const classroom = await this.ensureClassroom();
    if (input.request_key) {
      const existing = unwrap(
        await this.client
          .from("classbot_notices")
          .select("*")
          .eq("class_id", classroom.id)
          .eq("request_key", input.request_key)
          .maybeSingle(),
        "중복 공지 확인 실패",
      );
      if (existing) return existing;
    }
    const status = input.status === "published" ? "published" : "draft";
    const result = await this.client
        .from("classbot_notices")
        .insert({
          class_id: classroom.id,
          title: String(input.title || "").trim(),
          body: String(input.body || "").trim(),
          status,
          pinned: Boolean(input.pinned),
          notify_on_publish: input.notify_on_publish !== false,
          request_key: input.request_key || null,
          created_by: actor,
          published_at: status === "published" ? new Date().toISOString() : null,
        })
        .select("*")
        .single();
    if (result.error && input.request_key && result.error.code === "23505") {
      const existing = unwrap(
        await this.client.from("classbot_notices").select("*").eq("class_id", classroom.id).eq("request_key", input.request_key).single(),
        "중복 공지 조회 실패",
      );
      return existing;
    }
    const notice = unwrap(result, "공지 생성 실패");
    await this.appendAudit({ actor, action: "notice.create", entityType: "notice", entityId: notice.id, after: notice });
    return notice;
  }

  async updateNotice(noticeId, patch, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const allowed = Object.fromEntries(
      Object.entries(patch).filter(([key]) => ["title", "body", "status", "pinned", "notify_on_publish"].includes(key)),
    );
    if (patch.status === "published") {
      const current = await this.getNotice(noticeId);
      if (!current) throw new Error("공지를 찾을 수 없습니다.");
      if (!current.published_at) allowed.published_at = new Date().toISOString();
    }
    const notice = unwrap(
      await this.client
        .from("classbot_notices")
        .update(allowed)
        .eq("class_id", classroom.id)
        .eq("id", noticeId)
        .select("*")
        .single(),
      "공지 저장 실패",
    );
    await this.appendAudit({ actor, action: "notice.update", entityType: "notice", entityId: notice.id, after: notice });
    return notice;
  }

  async archiveNotice(noticeId, actor = "admin") {
    return this.updateNotice(noticeId, { status: "archived" }, actor);
  }

  async publishNotice(noticeId, actor = "admin") {
    const classroom = await this.ensureClassroom();
    const published = unwrap(
      await this.client
        .from("classbot_notices")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("class_id", classroom.id)
        .eq("id", noticeId)
        .eq("status", "draft")
        .select("*")
        .maybeSingle(),
      "공지 게시 실패",
    );
    if (published) {
      await this.appendAudit({ actor, action: "notice.publish", entityType: "notice", entityId: published.id, after: published });
      return { notice: published, newlyPublished: true };
    }
    const current = await this.getNotice(noticeId);
    if (!current) throw new Error("공지를 찾을 수 없습니다.");
    if (current.status === "archived") throw new Error("보관된 공지는 먼저 복원해야 게시할 수 있습니다.");
    return { notice: current, newlyPublished: false };
  }

  async listNotifications({ limit = 50, status } = {}) {
    const classroom = await this.ensureClassroom();
    let query = this.client
      .from("classbot_notifications")
      .select("*")
      .eq("class_id", classroom.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    return unwrap(await query, "알림 기록 조회 실패");
  }

  async getNotification(notificationId) {
    const classroom = await this.ensureClassroom();
    return unwrap(
      await this.client
        .from("classbot_notifications")
        .select("*")
        .eq("class_id", classroom.id)
        .eq("id", notificationId)
        .maybeSingle(),
      "알림 기록 조회 실패",
    );
  }

  async reserveNotifications(items) {
    if (!items.length) return [];
    const classroom = await this.ensureClassroom();
    const payload = items.map((item) => ({ ...item, class_id: classroom.id, status: "reserved" }));
    const result = await this.client.from("classbot_notifications").upsert(payload, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*");
    return unwrap(result, "알림 예약 실패");
  }

  async markNotifications(ids, patch) {
    if (!ids.length) return [];
    const classroom = await this.ensureClassroom();
    const changes = { ...patch };
    if (patch.status === "sent") changes.sent_at = new Date().toISOString();
    return unwrap(
      await this.client.from("classbot_notifications").update(changes).eq("class_id", classroom.id).in("id", ids).select("*"),
      "알림 상태 저장 실패",
    );
  }

  async appendAudit({ actor, action, entityType, entityId, before = null, after = null }) {
    const classroom = await this.ensureClassroom();
    unwrap(
      await this.client.from("classbot_audit_logs").insert({
        class_id: classroom.id,
        actor,
        action,
        entity_type: entityType,
        entity_id: entityId,
        before_data: before ? redactAuditData(before) : null,
        after_data: after ? redactAuditData(after) : null,
      }),
      "변경 기록 저장 실패",
    );
  }
}
