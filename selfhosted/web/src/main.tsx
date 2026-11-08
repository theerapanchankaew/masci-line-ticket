import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { api, setToken, fmt, deadline, downloadFile } from "./api";
import "./style.css";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  queued: "เข้าคิว",
  assigned: "มอบหมายแล้ว",
  working: "กำลังดำเนินการ",
  waiting_customer: "รอลูกค้า",
  resolved: "รอยืนยันผล",
  closed: "ปิดแล้ว",
  cancelled: "ยกเลิก",
};
const names: Record<string, string> = {
  dashboard: "ภาพรวมบริการ",
  inbox: "รับเรื่องและ Mapping",
  tickets: "คิว Ticket",
  operations: "SLA และการส่งข้อความ",
  settings: "ตั้งค่าระบบ",
};
const field = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) || "");
const id = () => crypto.randomUUID();
function App() {
  const [user, setUser] = useState<Row | null>(null),
    [page, setPage] = useState("dashboard"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<Row>({
      teams: [],
      users: [],
      policies: [],
      rules: [],
    }),
    [tickets, setTickets] = useState<Row[]>([]),
    [inbox, setInbox] = useState<Row[]>([]),
    [dash, setDash] = useState<Row>({}),
    [ops, setOps] = useState<Row>({ events: [], outbox: [], alerts: [] });
  const [selected, setSelected] = useState<Row | null>(null),
    [message, setMessage] = useState<Row | null>(null),
    [history, setHistory] = useState<Row[]>([]);
  const manager = user?.role === "admin" || user?.role === "dispatcher";
  const name = (type: string, key: string) =>
    catalog[type]?.find((x: Row) => x.id === key)?.name || "—";
  async function refresh(ticketId?: string) {
    const [c, t, d] = await Promise.all([
      api("/api/catalog"),
      api("/api/tickets"),
      api("/api/dashboard"),
    ]);
    setCatalog(c);
    setTickets(t);
    setDash(d);
    if (manager) {
      const [i, o] = await Promise.all([
        api("/api/inbox"),
        api("/api/operations"),
      ]);
      setInbox(i);
      setOps(o);
    }
    if (ticketId) setSelected(await api(`/api/tickets/${ticketId}`));
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user) void run(() => refresh());
  }, [user?.id]);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await run(async () => {
      const result = await api("/api/auth/login", "POST", {
        email: field(form, "email"),
        password: field(form, "password"),
      });
      setToken(result.token);
      setUser(result.user);
    });
  }
  async function change(action: string) {
    let reason = "";
    if (!["start", "resume"].includes(action)) {
      reason =
        prompt(
          action === "resolve" ? "สรุปผลแก้ไขที่จะส่งลูกค้า" : "ระบุเหตุผล",
        ) || "";
      if (!reason) return;
    }
    await run(async () => {
      await api(`/api/tickets/${selected!.id}/transition`, "POST", {
        version: selected!.version,
        action,
        reason,
      });
      await refresh(selected!.id);
    });
  }
  if (!user)
    return (
      <div className="login">
        <section className="intro">
          <span className="eyebrow">MASCI · CUSTOMER OPERATIONS</span>
          <h1>
            ทุกเรื่องมีเจ้าภาพ
            <br />
            ทุกงานติดตามได้
          </h1>
          <p>LINE Service Desk สำหรับรับเรื่อง จัดคิว และดูแลลูกค้าจนจบเคส</p>
          <div className="intro-line">INBOX → TICKET → DISPATCH → RESOLVE</div>
        </section>
        <form onSubmit={login} className="login-card">
          <div className="brand">
            MASCI <small>SERVICE DESK</small>
          </div>
          <h2>เข้าสู่ระบบเจ้าหน้าที่</h2>
          <label>
            อีเมล
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            รหัสผ่าน
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>เข้าสู่ระบบ</button>
          <p className="muted">
            ใช้บัญชีที่ผู้ดูแลระบบสร้างให้ · ไม่มีรหัสผ่านเริ่มต้น
          </p>
        </form>
      </div>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          MASCI<small>SERVICE DESK</small>
        </div>
        <span className="eyebrow">WORKSPACE</span>
        <nav>
          {Object.entries(names)
            .filter(
              ([k]) =>
                manager || !["inbox", "operations", "settings"].includes(k),
            )
            .map(([k, v]) => (
              <button
                key={k}
                className={page === k ? "active" : "nav"}
                onClick={() => {
                  setPage(k);
                  setSelected(null);
                  setMessage(null);
                }}
              >
                {v}
                {k === "inbox" && <b>{inbox.length}</b>}
              </button>
            ))}
        </nav>
        <div className="profile">
          <strong>{user.name}</strong>
          <small>
            {user.role} · {name("teams", user.team_id)}
          </small>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                await api("/api/auth/logout", "POST");
                setToken("");
                setUser(null);
                setSelected(null);
              })
            }
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">MASCI SERVICE OPERATIONS</span>
            <h1>{names[page]}</h1>
          </div>
          <div className="header-actions">
            <span
              className={
                "badge " + (catalog.line_mode === "live" ? "working" : "queued")
              }
            >
              {catalog.line_mode === "live"
                ? "LINE LIVE"
                : "DRY RUN · ไม่ส่ง LINE จริง"}
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => refresh(selected?.id))}
            >
              รีเฟรช
            </button>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="loading" role="status">
            กำลังดำเนินการ…
          </div>
        )}
        {page === "dashboard" && (
          <>
            <div className="stats">
              {[
                ["active", "งานเปิด"],
                ["unassigned", "รอผู้รับผิดชอบ"],
                ["resolution_breached", "เกิน SLA แก้ไข"],
                ["response_breached", "เกิน SLA ตอบรับ"],
                ["resolved", "รอยืนยัน"],
                ["closed", "ปิดแล้ว"],
              ].map(([k, v]) => (
                <article key={k}>
                  <span>{v}</span>
                  <strong>{dash[k] ?? 0}</strong>
                </article>
              ))}
            </div>
            <section className="panel">
              <h2>งานที่ต้องติดตาม</h2>
              <TicketTable
                rows={tickets.filter(
                  (t) => !["closed", "cancelled"].includes(t.status),
                )}
                open={(t) => {
                  setPage("tickets");
                  void run(async () =>
                    setSelected(await api(`/api/tickets/${t.id}`)),
                  );
                }}
                name={name}
              />
            </section>
          </>
        )}
        {page === "inbox" && (
          <div className="split">
            <section className="panel">
              <h2>
                ข้อความที่ยังไม่ผูกเคส <small>สูงสุด 100 รายการแรก</small>
              </h2>
              {!inbox.length && <Empty text="ไม่มีข้อความรอคัดแยก" />}
              {inbox.map((m) => (
                <button
                  className={
                    "message-card " + (message?.id === m.id ? "chosen" : "")
                  }
                  key={m.id}
                  onClick={() =>
                    void run(async () => {
                      setMessage(m);
                      setHistory(
                        await api(
                          `/api/messages?customer_id=${encodeURIComponent(m.customer_id)}`,
                        ),
                      );
                    })
                  }
                >
                  <small>
                    {fmt(m.created_at)} · {m.kind}
                  </small>
                  <p>{m.text}</p>
                  <small>
                    {m.suggestion
                      ? `แนะนำ: ${m.suggestion.name}`
                      : "ต้องคัดแยกโดยเจ้าหน้าที่"}
                  </small>
                </button>
              ))}
            </section>
            <section className="panel">
              {message ? (
                <>
                  <h2>คัดแยกและเปิด Ticket</h2>
                  <p className="mono">ลูกค้า {message.customer_id}</p>
                  <p className="quote">{message.text}</p>
                  <form
                    key={message.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void run(async () => {
                        await api(
                          "/api/tickets",
                          "POST",
                          {
                            message_ids: [message.id],
                            title: field(f, "title"),
                            team_id: field(f, "team_id"),
                            policy_id: field(f, "policy_id"),
                            priority: Number(field(f, "priority")),
                            rule_id: message.suggestion?.id || null,
                            reason: field(f, "reason"),
                          },
                          id(),
                        );
                        setMessage(null);
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      หัวข้อ
                      <input
                        name="title"
                        maxLength={300}
                        required
                        defaultValue={message.text.slice(0, 100)}
                      />
                    </label>
                    <label>
                      ทีม
                      <select
                        name="team_id"
                        defaultValue={message.suggestion?.team_id}
                      >
                        {catalog.teams.map((t: Row) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      นโยบาย SLA
                      <select
                        name="policy_id"
                        defaultValue={message.suggestion?.policy_id}
                      >
                        {catalog.policies.map((p: Row) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      ความเร่งด่วน
                      <select
                        name="priority"
                        defaultValue={message.suggestion?.priority || 3}
                      >
                        {[1, 2, 3, 4].map((p) => (
                          <option key={p} value={p}>
                            P{p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      เหตุผล Mapping
                      <input
                        name="reason"
                        required
                        defaultValue="เจ้าหน้าที่ตรวจสอบแล้ว"
                      />
                    </label>
                    <button disabled={busy}>เปิด Ticket</button>
                  </form>
                  <hr />
                  <h3>เพิ่มข้อความเข้าเคสเดิม</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void run(async () => {
                        const target = tickets.find(
                          (t) => t.id === field(f, "ticket"),
                        );
                        if (!target) throw new Error("เลือก Ticket ก่อน");
                        await api(
                          `/api/tickets/${target.id}/messages/${message.id}`,
                          "POST",
                          { version: target.version },
                        );
                        setMessage(null);
                        await refresh();
                      });
                    }}
                  >
                    <select name="ticket" required>
                      <option value="">เลือกเคสของลูกค้ารายนี้</option>
                      {tickets
                        .filter((t) => t.customer_id === message.customer_id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.number} · {t.title}
                          </option>
                        ))}
                    </select>
                    <button className="secondary" disabled={busy}>
                      แนบเข้า Ticket
                    </button>
                  </form>
                  <h3>ประวัติบทสนทนา</h3>
                  {history.map((m) => (
                    <div className="timeline" key={m.id}>
                      <small>
                        {fmt(m.occurred_at)} · {m.direction}
                      </small>
                      <p>{m.withdrawn ? "[ถอนข้อความแล้ว]" : m.text}</p>
                      {m.media_state && (
                        <small>
                          ไฟล์: {m.media_state} {m.media_error || ""}
                        </small>
                      )}
                      {m.media_state === "ready" && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void run(() =>
                              downloadFile(m.id, "line-attachment.bin", true),
                            )
                          }
                        >
                          ดาวน์โหลดไฟล์จาก LINE
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() => setMessage(m)}
                      >
                        ใช้ข้อความนี้คัดแยก
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <Empty text="เลือกข้อความเพื่อจัดประเภท เปิดเคส หรือแนบเข้าเคสเดิม" />
              )}
            </section>
          </div>
        )}
        {page === "tickets" && !selected && (
          <section className="panel">
            <h2>คิวงาน · เรียงตาม Priority และ SLA</h2>
            <TicketTable
              rows={tickets}
              name={name}
              open={(t) =>
                void run(async () =>
                  setSelected(await api(`/api/tickets/${t.id}`)),
                )
              }
            />
            <small>แสดงสูงสุด 100 รายการแรก · API รองรับ offset</small>
          </section>
        )}
        {page === "tickets" && selected && (
          <>
            <button className="secondary" onClick={() => setSelected(null)}>
              ← กลับคิวงาน
            </button>
            <section className="panel">
              <div className="ticket-heading">
                <div>
                  <span className="eyebrow">{selected.number}</span>
                  <h2>{selected.title}</h2>
                </div>
                <Status value={selected.status} />
              </div>
              <div className="metadata">
                <span>
                  Priority <b>P{selected.priority}</b>
                </span>
                <span>
                  ทีม <b>{name("teams", selected.team_id)}</b>
                </span>
                <span>
                  เจ้าของเคส <b>{name("users", selected.owner_id)}</b>
                </span>
                <span>
                  รอบที่ <b>{selected.round}</b>
                </span>
              </div>
              <div className="sla-grid">
                <div>
                  ตอบรับภายใน <strong>{fmt(selected.response_due)}</strong>
                  <small>
                    {deadline(selected.response_due, selected.responded_at)}
                  </small>
                </div>
                <div>
                  แก้ไขภายใน <strong>{fmt(selected.resolution_due)}</strong>
                  <small>
                    {deadline(selected.resolution_due, selected.resolved_at)}
                  </small>
                </div>
              </div>
              <div className="actions">
                {[
                  ["assigned", "start", "เริ่มงาน"],
                  ["working", "wait", "รอลูกค้า"],
                  ["waiting_customer", "resume", "ดำเนินการต่อ"],
                  ["working", "resolve", "ส่งผลแก้ไข"],
                  ["waiting_customer", "resolve", "ส่งผลแก้ไข"],
                  ["resolved", "close", "ปิดพร้อมเหตุผล"],
                  ["resolved", "reopen", "เปิดกลับ"],
                  ["closed", "reopen", "เปิดกลับ"],
                ]
                  .filter(([s]) => s === selected.status)
                  .map(([, a, l]) => (
                    <button
                      key={a}
                      disabled={busy}
                      onClick={() => void change(a)}
                    >
                      {l}
                    </button>
                  ))}
              </div>
              {manager && (
                <div className="form-grid">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void run(async () => {
                        await api(
                          `/api/tickets/${selected.id}/assign`,
                          "POST",
                          {
                            version: selected.version,
                            owner_id: field(f, "owner") || null,
                          },
                        );
                        await refresh(selected.id);
                      });
                    }}
                  >
                    <label>
                      มอบหมายเจ้าของเคส
                      <select name="owner">
                        <option value="">อัตโนมัติตามกำลังรับงาน</option>
                        {catalog.users
                          .filter(
                            (u: Row) =>
                              u.role === "agent" &&
                              u.team_id === selected.team_id,
                          )
                          .map((u: Row) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="secondary" disabled={busy}>
                      มอบหมาย
                    </button>
                  </form>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void run(async () => {
                        await api(
                          `/api/tickets/${selected.id}/transfer`,
                          "POST",
                          {
                            version: selected.version,
                            team_id: field(f, "team"),
                            reason: field(f, "reason"),
                          },
                        );
                        await refresh(selected.id);
                      });
                    }}
                  >
                    <label>
                      โอนทีม
                      <select name="team">
                        {catalog.teams.map((t: Row) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input name="reason" required placeholder="เหตุผลโอนงาน" />
                    <button className="secondary" disabled={busy}>
                      โอนโดยคง SLA เดิม
                    </button>
                  </form>
                </div>
              )}
            </section>
            <div className="split">
              <section className="panel">
                <h2>ข้อความลูกค้า</h2>
                {selected.messages.map((m: Row) => (
                  <div className={"timeline " + m.direction} key={m.id}>
                    <small>
                      {m.direction} · {fmt(m.occurred_at)}
                    </small>
                    <p>{m.withdrawn ? "[ถอนข้อความแล้ว]" : m.text}</p>
                    {m.media_state && (
                      <small>
                        ไฟล์: {m.media_state} {m.media_error || ""}
                      </small>
                    )}
                    {m.media_state === "ready" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void run(() =>
                            downloadFile(m.id, "line-attachment.bin", true),
                          )
                        }
                      >
                        ดาวน์โหลดไฟล์จาก LINE
                      </button>
                    )}
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const text = field(f, "text");
                    void run(async () => {
                      await api(
                        `/api/tickets/${selected.id}/reply`,
                        "POST",
                        { text },
                        id(),
                      );
                      f.reset();
                      await refresh(selected.id);
                    });
                  }}
                >
                  <label>
                    ส่งข้อความถึงลูกค้าผ่าน LINE
                    <textarea name="text" required maxLength={4800} />
                  </label>
                  <button disabled={busy}>เข้าคิวส่งข้อความ</button>
                </form>
                <h3>สถานะการส่ง</h3>
                {selected.outbox.map((o: Row) => (
                  <div className="timeline" key={o.id}>
                    <b>
                      {o.kind} · {o.state}
                    </b>
                    <small>
                      ลอง {o.attempts} ครั้ง · {o.error || "—"}
                    </small>
                  </div>
                ))}
              </section>
              <section className="panel">
                <h2>งานย่อยและผู้ร่วมดำเนินการ</h2>
                {selected.tasks.map((t: Row) => (
                  <div className="task" key={t.id}>
                    <strong>{t.title}</strong>
                    <small>
                      {name("users", t.assignee_id)} · {fmt(t.due_at)} ·{" "}
                      {t.required ? "บังคับ" : "เสริม"} · {t.status}
                    </small>
                    {t.dependencies.length > 0 && (
                      <small>
                        รอ:{" "}
                        {t.dependencies
                          .map(
                            (d: string) =>
                              selected.tasks.find((x: Row) => x.id === d)
                                ?.title,
                          )
                          .join(", ")}
                      </small>
                    )}
                    {t.status !== "done" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`/api/tasks/${t.id}/complete`, "POST", {
                              version: selected.version,
                            });
                            await refresh(selected.id);
                          })
                        }
                      >
                        บันทึกเสร็จงาน
                      </button>
                    )}
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    const fd = new FormData(f);
                    void run(async () => {
                      await api(`/api/tickets/${selected.id}/tasks`, "POST", {
                        version: selected.version,
                        title: field(f, "title"),
                        assignee_id: field(f, "assignee"),
                        due_at: new Date(field(f, "due")).getTime() / 1000,
                        dependencies: fd.getAll("dependencies"),
                        required: fd.has("required"),
                      });
                      f.reset();
                      await refresh(selected.id);
                    });
                  }}
                >
                  <label>
                    ชื่องาน
                    <input name="title" required />
                  </label>
                  <label>
                    ผู้รับผิดชอบ
                    <select name="assignee">
                      {catalog.users
                        .filter((u: Row) => u.role === "agent")
                        .map((u: Row) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {name("teams", u.team_id)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    กำหนดส่ง (เวลาท้องถิ่นเครื่องผู้ใช้)
                    <input name="due" type="datetime-local" required />
                  </label>
                  <fieldset>
                    <legend>งานที่ต้องเสร็จก่อน</legend>
                    {selected.tasks.map((t: Row) => (
                      <label className="check" key={t.id}>
                        <input
                          type="checkbox"
                          name="dependencies"
                          value={t.id}
                        />
                        {t.title}
                      </label>
                    ))}
                  </fieldset>
                  <label className="check">
                    <input name="required" type="checkbox" defaultChecked />
                    ต้องเสร็จก่อน Resolve
                  </label>
                  <button className="secondary" disabled={busy}>
                    เพิ่มงานย่อย
                  </button>
                </form>
              </section>
            </div>
            <div className="split">
              <section className="panel">
                <h2>บันทึกภายใน</h2>
                <p className="muted">ข้อความส่วนนี้ไม่ส่งถึงลูกค้า</p>
                {selected.notes.map((n: Row) => (
                  <div className="timeline" key={n.id}>
                    <small>
                      {name("users", n.author_id)} · {fmt(n.created_at)}
                    </small>
                    <p>{n.text}</p>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api(`/api/tickets/${selected.id}/notes`, "POST", {
                        text: field(f, "text"),
                      });
                      f.reset();
                      await refresh(selected.id);
                    });
                  }}
                >
                  <textarea name="text" required />
                  <button className="secondary" disabled={busy}>
                    บันทึกภายใน
                  </button>
                </form>
                <h3>หลักฐานแนบ</h3>
                {selected.attachments.map((a: Row) => (
                  <button
                    key={a.id}
                    className="secondary"
                    onClick={() =>
                      void run(() => downloadFile(a.id, a.filename))
                    }
                  >
                    {a.filename} · {a.size} bytes
                  </button>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api(
                        `/api/tickets/${selected.id}/attachments`,
                        "POST",
                        new FormData(f),
                      );
                      f.reset();
                      await refresh(selected.id);
                    });
                  }}
                >
                  <input type="file" name="file" required />
                  <button className="secondary" disabled={busy}>
                    แนบไฟล์ ≤10 MB
                  </button>
                </form>
              </section>
              <section className="panel">
                <h2>ประวัติการดำเนินการ</h2>
                {selected.audit.map((a: Row) => (
                  <div className="timeline" key={a.id}>
                    <b>{a.action}</b>
                    <small>
                      {fmt(a.created_at)} · {name("users", a.actor_id)}
                    </small>
                    <pre>{JSON.stringify(a.details, null, 2)}</pre>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}
        {page === "operations" && (
          <>
            <p className="notice">
              accepted = LINE รับคำขอแล้ว · simulated = จำลองและยังไม่ส่ง ·
              ไม่ใช่หลักฐานว่าลูกค้าอ่านข้อความ
            </p>
            <div className="split">
              <section className="panel">
                <h2>สถานะงานเบื้องหลัง</h2>
                {ops.heartbeats?.map((h: Row) => (
                  <p key={h.name}>
                    {h.name} · {fmt(h.last_seen)} ·{" "}
                    {Date.now() / 1000 - h.last_seen < 120
                      ? "ทำงาน"
                      : "ต้องตรวจสอบ"}
                  </p>
                ))}
                <h2>SLA Alerts</h2>
                {ops.alerts.map((a: Row) => (
                  <div className="timeline" key={a.id}>
                    <b>
                      {a.phase} · {a.level}
                    </b>
                    <small>
                      {tickets.find((t) => t.id === a.ticket_id)?.number ||
                        a.ticket_id}{" "}
                      · {fmt(a.created_at)}
                    </small>
                  </div>
                ))}
              </section>
              <section className="panel">
                <h2>Webhook รอประมวลผล/ล้มเหลว</h2>
                {ops.events.map((e: Row) => (
                  <div className="timeline" key={e.id}>
                    <b>
                      {e.state} · {e.error || "—"}
                    </b>
                    <small>{e.id}</small>
                    {e.state === "failed" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `/api/operations/events/${e.id}/retry`,
                              "POST",
                            );
                            await refresh();
                          })
                        }
                      >
                        ลองประมวลผลใหม่
                      </button>
                    )}
                  </div>
                ))}
                <h2>ไฟล์ LINE ที่ดึงไม่สำเร็จ</h2>
                {ops.media?.map((m: Row) => (
                  <div key={m.id} className="timeline">
                    <b>
                      {m.kind} · {m.media_error}
                    </b>
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/api/operations/media/${m.id}/retry`,
                            "POST",
                          );
                          await refresh();
                        })
                      }
                    >
                      ลองดึงไฟล์ใหม่
                    </button>
                  </div>
                ))}
                <h2>Outbox ที่ยังไม่ Accepted</h2>
                {ops.outbox.map((o: Row) => (
                  <div className="timeline" key={o.id}>
                    <b>
                      {o.kind} · {o.state}
                    </b>
                    <small>
                      {fmt(o.created_at)} · {o.error || "—"}
                    </small>
                  </div>
                ))}
              </section>
            </div>
          </>
        )}
        {page === "settings" && (
          <>
            <p className="notice">
              ตั้งค่าผ่านสิทธิ์ Admin · SLA
              ตัวอย่างต้องได้รับการตกลงก่อนใช้งานจริง · รอลูกค้ายังนับเวลา
            </p>
            <div className="split">
              <section className="panel">
                <h2>ทีมและเจ้าหน้าที่</h2>
                {catalog.teams.map((t: Row) => (
                  <p key={t.id}>{t.name}</p>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api("/api/admin/teams", "POST", {
                        text: field(f, "name"),
                      });
                      f.reset();
                      await refresh();
                    });
                  }}
                >
                  <input name="name" placeholder="ชื่อทีมใหม่" required />
                  <button disabled={busy}>เพิ่มทีม</button>
                </form>
                <hr />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api("/api/admin/users", "POST", {
                        name: field(f, "name"),
                        email: field(f, "email"),
                        password: field(f, "password"),
                        team_id: field(f, "team_id"),
                        role: field(f, "role"),
                        capacity: Number(field(f, "capacity")),
                      });
                      f.reset();
                      await refresh();
                    });
                  }}
                >
                  <label>
                    ชื่อ
                    <input name="name" required />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    รหัสผ่าน ≥12 ตัว
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    ทีม
                    <select name="team_id">
                      {catalog.teams.map((t: Row) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    บทบาท
                    <select name="role">
                      <option value="agent">agent</option>
                      <option value="dispatcher">dispatcher</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <label>
                    กำลังรับงานรวม Ticket + Task
                    <input
                      name="capacity"
                      type="number"
                      min="1"
                      max="100"
                      defaultValue="5"
                      required
                    />
                  </label>
                  <button disabled={busy}>เพิ่มเจ้าหน้าที่</button>
                </form>
                <h3>รายชื่อ</h3>
                {catalog.users.map((u: Row) => (
                  <p key={u.id}>
                    {u.name} · {u.role} · capacity {u.capacity}{" "}
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/admin/users/${u.id}`, "PATCH", {
                            available: !u.available,
                          });
                          await refresh();
                        })
                      }
                    >
                      {u.available ? "พักรับงาน" : "เปิดรับงาน"}
                    </button>
                  </p>
                ))}
              </section>
              <section className="panel">
                <h2>Mapping Rules</h2>
                {catalog.rules.map((r: Row) => (
                  <div className="timeline" key={r.id}>
                    <b>
                      {r.name} · P{r.priority}
                    </b>
                    <small>
                      {r.keywords.join(", ")} → {name("teams", r.team_id)}
                    </small>
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/admin/rules/${r.id}`, "PATCH", {
                            active: !r.active,
                          });
                          await refresh();
                        })
                      }
                    >
                      {r.active ? "ปิดกฎ" : "เปิดกฎ"}
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api("/api/admin/rules", "POST", {
                        name: field(f, "name"),
                        keywords: field(f, "keywords")
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                        team_id: field(f, "team_id"),
                        policy_id: field(f, "policy_id"),
                        priority: Number(field(f, "priority")),
                        rank: Number(field(f, "rank")),
                      });
                      f.reset();
                      await refresh();
                    });
                  }}
                >
                  <label>
                    ชื่อกฎ
                    <input name="name" required />
                  </label>
                  <label>
                    Keywords คั่นด้วย comma
                    <input name="keywords" required />
                  </label>
                  <label>
                    ทีม
                    <select name="team_id">
                      {catalog.teams.map((t: Row) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    SLA
                    <select name="policy_id">
                      {catalog.policies.map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select name="priority">
                      {[1, 2, 3, 4].map((p) => (
                        <option key={p} value={p}>
                          P{p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Rank (น้อยก่อน)
                    <input
                      name="rank"
                      type="number"
                      defaultValue="100"
                      min="0"
                      required
                    />
                  </label>
                  <button disabled={busy}>เพิ่มกฎ</button>
                </form>
                <hr />
                <h2>SLA Policy ใหม่</h2>
                <form
                  key={catalog.policies[0]?.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    void run(async () => {
                      await api("/api/admin/policies", "POST", {
                        name: field(f, "name"),
                        config: JSON.parse(field(f, "config")),
                      });
                      await refresh();
                    });
                  }}
                >
                  <label>
                    ชื่อและเวอร์ชัน
                    <input name="name" required placeholder="MASCI SLA v2" />
                  </label>
                  <label>
                    Calendar และเป้าหมายเป็นนาที
                    <textarea
                      className="json-input"
                      name="config"
                      required
                      defaultValue={JSON.stringify(
                        catalog.policies[0]?.config || {},
                        null,
                        2,
                      )}
                    />
                  </label>
                  <button disabled={busy}>สร้าง Policy ใหม่</button>
                </form>
              </section>
            </div>
          </>
        )}
        <footer>
          MASCI Service Desk · Self-hosted v0.1 · เวลาแสดงผล Asia/Bangkok ·
          ข้อมูลล่าสุดเมื่อกดรีเฟรช
        </footer>
      </main>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
function Status({ value }: { value: string }) {
  return <span className={"badge " + value}>{labels[value] || value}</span>;
}
function TicketTable({
  rows,
  open,
  name,
}: {
  rows: Row[];
  open: (t: Row) => void;
  name: (type: string, key: string) => string;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ticket / เรื่อง</th>
            <th>สถานะ</th>
            <th>ผู้รับผิดชอบ</th>
            <th>กำหนดแก้ไข</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                <button className="ticket-link" onClick={() => open(t)}>
                  {t.number}{" "}
                  <span className={"priority p" + t.priority}>
                    P{t.priority}
                  </span>
                  <strong>{t.title}</strong>
                </button>
              </td>
              <td>
                <Status value={t.status} />
              </td>
              <td>
                {name("users", t.owner_id)}
                <small>{name("teams", t.team_id)}</small>
              </td>
              <td>
                {fmt(t.resolution_due)}
                <small>{deadline(t.resolution_due, t.resolved_at)}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="ยังไม่มี Ticket ในคิวนี้" />
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
