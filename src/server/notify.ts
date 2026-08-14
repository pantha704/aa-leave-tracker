import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { and, eq } from "drizzle-orm";
import { employees, leaveTypes, orgSettings } from "@/db/schema";
import { getDb } from "@/server/db";
import { renderLeavePendingHtml } from "@/server/templates/leave-pending.html";

export const EMAIL_OFF_BANNER = "Email is off; check pending daily.";

export type EmailEnv = Record<string, string | undefined>;

export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
};

export type EmailTransport = {
  send: (message: EmailMessage) => Promise<void>;
};

export type LeavePendingInput = {
  employeeName: string;
  employeeEmail?: string | null;
  leaveTypeName?: string | null;
  startDate: string;
  endDate: string;
  entryId?: string | null;
  adminEmails: string[];
  adminUrl?: string | null;
};

export type NotifyOptions = {
  env?: EmailEnv;
  transport?: EmailTransport;
  from?: string;
  fetchImpl?: typeof fetch;
};

export type NotifyResult = {
  ok: boolean;
  skipped: boolean;
  reason?: "email_disabled" | "no_recipients" | "send_failed";
};

export type PendingLeaveEntryNotice = {
  employeeId: string;
  leaveTypeId: string;
  entryId: string;
  startDate: string;
  endDate: string;
};

let lastSendFailed = false;

export function resetNotifyState(): void {
  lastSendFailed = false;
}

export function markSendFailed(): void {
  lastSendFailed = true;
}

export function clearSendFailure(): void {
  lastSendFailed = false;
}

export function isEmailConfigured(env: EmailEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() || env.SMTP_URL?.trim());
}

export function shouldShowEmailBanner(env: EmailEnv = process.env): boolean {
  return !isEmailConfigured(env) || lastSendFailed;
}

export function emailFromAddress(env: EmailEnv = process.env): string {
  return (
    env.EMAIL_FROM?.trim() ||
    env.RESEND_FROM?.trim() ||
    env.MAIL_FROM?.trim() ||
    "leave@localhost"
  );
}

export function leavePendingSubject(input: Pick<LeavePendingInput, "employeeName" | "startDate" | "endDate">): string {
  const dates =
    input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate} – ${input.endDate}`;
  return `Pending leave: ${input.employeeName} ${dates}`;
}

export function createResendTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): EmailTransport {
  return {
    async send(message) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Resend ${res.status}${body ? `: ${body}` : ""}`);
      }
    },
  };
}

export function createSmtpTransport(smtpUrl: string): EmailTransport {
  return {
    async send(message) {
      await sendSmtp(smtpUrl, message);
    },
  };
}

export function createEmailTransport(
  env: EmailEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): EmailTransport | null {
  const resend = env.RESEND_API_KEY?.trim();
  if (resend) return createResendTransport(resend, fetchImpl);
  const smtp = env.SMTP_URL?.trim();
  if (smtp) return createSmtpTransport(smtp);
  return null;
}

export async function notifyLeavePending(
  input: LeavePendingInput,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const env = options.env ?? process.env;
  if (!isEmailConfigured(env)) {
    return { ok: true, skipped: true, reason: "email_disabled" };
  }

  const to = [...new Set(input.adminEmails.map((email) => email.trim()).filter(Boolean))];
  if (to.length === 0) {
    return { ok: true, skipped: true, reason: "no_recipients" };
  }

  const transport = options.transport ?? createEmailTransport(env, options.fetchImpl);
  if (!transport) {
    return { ok: true, skipped: true, reason: "email_disabled" };
  }

  const message: EmailMessage = {
    from: options.from ?? emailFromAddress(env),
    to,
    subject: leavePendingSubject(input),
    html: renderLeavePendingHtml(input),
  };

  try {
    await transport.send(message);
    clearSendFailure();
    return { ok: true, skipped: false };
  } catch (err) {
    markSendFailed();
    console.error("leave.pending notify failed", err);
    return { ok: false, skipped: false, reason: "send_failed" };
  }
}

/** Never throw: submit must not become 500 because mail I/O failed. */
export async function tryNotifyLeavePending(
  notify: (input: PendingLeaveEntryNotice) => Promise<unknown>,
  input: PendingLeaveEntryNotice,
): Promise<void> {
  try {
    await notify(input);
  } catch (err) {
    markSendFailed();
    console.error("leave.pending notify failed", err);
  }
}

export async function listAdminEmails(orgId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ email: employees.email })
    .from(employees)
    .where(
      and(eq(employees.orgId, orgId), eq(employees.role, "admin"), eq(employees.active, true)),
    );
  return rows.map((row) => row.email);
}

export async function syncEmailEnabled(
  orgId: string,
  env: EmailEnv = process.env,
): Promise<boolean> {
  const enabled = isEmailConfigured(env);
  const db = getDb();
  const [row] = await db
    .select({ emailEnabled: orgSettings.emailEnabled })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId))
    .limit(1);
  if (row && row.emailEnabled !== enabled) {
    await db
      .update(orgSettings)
      .set({ emailEnabled: enabled })
      .where(eq(orgSettings.orgId, orgId));
  }
  return enabled;
}

export async function notifyPendingLeaveEntry(
  input: PendingLeaveEntryNotice,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const env = options.env ?? process.env;
  if (!isEmailConfigured(env)) {
    return { ok: true, skipped: true, reason: "email_disabled" };
  }

  try {
    const db = getDb();
    const [emp] = await db
      .select({
        orgId: employees.orgId,
        name: employees.name,
        email: employees.email,
      })
      .from(employees)
      .where(eq(employees.id, input.employeeId))
      .limit(1);
    if (!emp) {
      return { ok: true, skipped: true, reason: "no_recipients" };
    }

    await syncEmailEnabled(emp.orgId, env).catch((err) => {
      console.error("org_settings.email_enabled sync failed", err);
    });

    const [typeRow] = await db
      .select({ name: leaveTypes.name })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, input.leaveTypeId))
      .limit(1);

    const adminEmails = await listAdminEmails(emp.orgId);
    const origin = (env.APP_URL ?? env.BETTER_AUTH_URL)?.replace(/\/$/, "") ?? "";
    return notifyLeavePending(
      {
        employeeName: emp.name,
        employeeEmail: emp.email,
        leaveTypeName: typeRow?.name ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        entryId: input.entryId,
        adminEmails,
        adminUrl: origin ? `${origin}/admin/employees#pending` : "/admin/employees#pending",
      },
      options,
    );
  } catch (err) {
    markSendFailed();
    console.error("leave.pending notify failed", err);
    return { ok: false, skipped: false, reason: "send_failed" };
  }
}

type SmtpConn = {
  readReply: () => Promise<{ code: number; lines: string[] }>;
  write: (line: string) => Promise<void>;
  upgradeTls: () => Promise<void>;
  end: () => void;
};

function expectSmtp(reply: { code: number; lines: string[] }, ...codes: number[]): void {
  if (!codes.includes(reply.code)) {
    throw new Error(`SMTP ${reply.code}: ${reply.lines.join("\n")}`);
  }
}

function encodeDotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

async function openSmtp(host: string, port: number, implicitTls: boolean): Promise<SmtpConn> {
  let socket: Socket | TLSSocket = implicitTls
    ? tlsConnect({ host, port, servername: host })
    : netConnect({ host, port });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    socket.once("error", onError);
    socket.once(implicitTls ? "secureConnect" : "connect", () => {
      socket.off("error", onError);
      resolve();
    });
  });

  let buffer = "";
  const waiters: Array<(chunk: string) => void> = [];
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (waiters.length > 0) waiters.shift()?.("");
  };
  socket.on("data", onData);

  const takeReply = (): { code: number; lines: string[] } | null => {
    const lines: string[] = [];
    let offset = 0;
    while (offset < buffer.length) {
      const nl = buffer.indexOf("\n", offset);
      if (nl === -1) return null;
      let line = buffer.slice(offset, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      offset = nl + 1;
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        buffer = buffer.slice(offset);
        return { code: Number(line.slice(0, 3)), lines };
      }
    }
    return null;
  };

  const readReply = async (): Promise<{ code: number; lines: string[] }> => {
    for (;;) {
      const ready = takeReply();
      if (ready) return ready;
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        socket.once("error", onError);
        waiters.push(() => {
          socket.off("error", onError);
          resolve();
        });
      });
    }
  };

  const write = async (line: string) => {
    await new Promise<void>((resolve, reject) => {
      socket.write(line.endsWith("\r\n") ? line : `${line}\r\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const upgradeTls = async () => {
    if (socket instanceof TLSSocket) return;
    const next = tlsConnect({ host, servername: host, socket: socket as Socket });
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      next.once("error", onError);
      next.once("secureConnect", () => {
        next.off("error", onError);
        resolve();
      });
    });
    socket.removeListener("data", onData);
    socket = next;
    buffer = "";
    socket.on("data", onData);
  };

  return {
    readReply,
    write,
    upgradeTls,
    end: () => {
      socket.end();
    },
  };
}

async function sendSmtp(smtpUrl: string, message: EmailMessage): Promise<void> {
  const url = new URL(smtpUrl);
  const implicitTls = url.protocol === "smtps:";
  const host = url.hostname;
  const port = url.port ? Number(url.port) : implicitTls ? 465 : 587;
  const user = url.username ? decodeURIComponent(url.username) : "";
  const pass = url.password ? decodeURIComponent(url.password) : "";

  const conn = await openSmtp(host, port, implicitTls);
  try {
    expectSmtp(await conn.readReply(), 220);
    await conn.write(`EHLO ${host}`);
    const ehlo = await conn.readReply();
    expectSmtp(ehlo, 250);
    const offersStartTls = ehlo.lines.some((line) => /STARTTLS/i.test(line));
    if (!implicitTls && offersStartTls) {
      await conn.write("STARTTLS");
      expectSmtp(await conn.readReply(), 220);
      await conn.upgradeTls();
      await conn.write(`EHLO ${host}`);
      expectSmtp(await conn.readReply(), 250);
    }
    if (user) {
      await conn.write("AUTH LOGIN");
      expectSmtp(await conn.readReply(), 334);
      await conn.write(Buffer.from(user).toString("base64"));
      expectSmtp(await conn.readReply(), 334);
      await conn.write(Buffer.from(pass).toString("base64"));
      expectSmtp(await conn.readReply(), 235, 250);
    }
    await conn.write(`MAIL FROM:<${message.from}>`);
    expectSmtp(await conn.readReply(), 250);
    for (const rcpt of message.to) {
      await conn.write(`RCPT TO:<${rcpt}>`);
      expectSmtp(await conn.readReply(), 250, 251);
    }
    await conn.write("DATA");
    expectSmtp(await conn.readReply(), 354);
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to.join(", ")}`,
      `Subject: ${message.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
    ].join("\r\n");
    await conn.write(`${headers}\r\n\r\n${encodeDotStuff(message.html)}\r\n.`);
    expectSmtp(await conn.readReply(), 250);
    await conn.write("QUIT");
    await conn.readReply().catch(() => undefined);
  } finally {
    conn.end();
  }
}
