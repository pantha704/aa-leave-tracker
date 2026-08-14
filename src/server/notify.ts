import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";
import { and, eq } from "drizzle-orm";
import { employees, leaveTypes, orgSettings } from "@/db/schema";
import { getDb } from "@/server/db";
import { renderLeavePendingHtml } from "@/server/templates/leave-pending.html";

export const EMAIL_OFF_BANNER = "Email is off; check pending daily.";
/** Bound so a hung Resend/SMTP call cannot 504 submit. */
export const NOTIFY_TIMEOUT_MS = 4_000;

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
  timeoutMs?: number;
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

export function isEmailConfigured(env: EmailEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() || env.SMTP_URL?.trim());
}

/** Banner is env-only. Send failures are logged; they do not flip this. */
export function shouldShowEmailBanner(env: EmailEnv = process.env): boolean {
  return !isEmailConfigured(env);
}

export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

export function emailFromAddress(env: EmailEnv = process.env): string {
  return sanitizeHeaderValue(
    env.EMAIL_FROM?.trim() ||
      env.RESEND_FROM?.trim() ||
      env.MAIL_FROM?.trim() ||
      "leave@localhost",
  );
}

export function leavePendingSubject(input: Pick<LeavePendingInput, "employeeName" | "startDate" | "endDate">): string {
  const dates =
    input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate} – ${input.endDate}`;
  return sanitizeHeaderValue(`Pending leave: ${input.employeeName} ${dates}`);
}

export async function withNotifyTimeout<T>(
  work: Promise<T>,
  timeoutMs = NOTIFY_TIMEOUT_MS,
  label = "leave.pending notify",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createResendTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = NOTIFY_TIMEOUT_MS,
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Resend ${res.status}${body ? `: ${body}` : ""}`);
      }
    },
  };
}

export function createSmtpTransport(
  smtpUrl: string,
  timeoutMs = NOTIFY_TIMEOUT_MS,
): EmailTransport {
  return {
    async send(message) {
      await sendSmtp(smtpUrl, message, timeoutMs);
    },
  };
}

export function createEmailTransport(
  env: EmailEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = NOTIFY_TIMEOUT_MS,
): EmailTransport | null {
  const resend = env.RESEND_API_KEY?.trim();
  if (resend) return createResendTransport(resend, fetchImpl, timeoutMs);
  const smtp = env.SMTP_URL?.trim();
  if (smtp) return createSmtpTransport(smtp, timeoutMs);
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

  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;
  const transport =
    options.transport ?? createEmailTransport(env, options.fetchImpl, timeoutMs);
  if (!transport) {
    return { ok: true, skipped: true, reason: "email_disabled" };
  }

  const message: EmailMessage = {
    from: sanitizeHeaderValue(options.from ?? emailFromAddress(env)),
    to: to.map(sanitizeHeaderValue),
    subject: leavePendingSubject(input),
    html: renderLeavePendingHtml(input),
  };

  try {
    await withNotifyTimeout(transport.send(message), timeoutMs);
    return { ok: true, skipped: false };
  } catch (err) {
    console.error("leave.pending notify failed", err);
    return { ok: false, skipped: false, reason: "send_failed" };
  }
}

/** Never throw and never wait past `timeoutMs`: submit must not hang or 500. */
export async function tryNotifyLeavePending(
  notify: (input: PendingLeaveEntryNotice) => Promise<unknown>,
  input: PendingLeaveEntryNotice,
  timeoutMs = NOTIFY_TIMEOUT_MS,
): Promise<void> {
  try {
    await withNotifyTimeout(Promise.resolve(notify(input)), timeoutMs);
  } catch (err) {
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

/** Mirror of env (`RESEND_API_KEY` / `SMTP_URL`). Not a separate kill switch; send and banner read env. */
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
    console.error("leave.pending notify failed", err);
    return { ok: false, skipped: false, reason: "send_failed" };
  }
}

export function smtpAuthAllowed(tlsActive: boolean, user: string): boolean {
  return !user || tlsActive;
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

function attachSocketTimeout(socket: Socket | TLSSocket, timeoutMs: number): void {
  socket.setTimeout(timeoutMs);
}

async function openSmtp(
  host: string,
  port: number,
  implicitTls: boolean,
  timeoutMs: number,
): Promise<SmtpConn> {
  let socket: Socket | TLSSocket = implicitTls
    ? tlsConnect({ host, port, servername: host })
    : netConnect({ host, port });
  attachSocketTimeout(socket, timeoutMs);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const onTimeout = () => reject(new Error("SMTP connect timed out"));
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.once(implicitTls ? "secureConnect" : "connect", () => {
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      resolve();
    });
  });

  let buffer = "";
  const waiters: Array<() => void> = [];
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    waiters.shift()?.();
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
      const raced = await new Promise<{ code: number; lines: string[] } | null>(
        (resolve, reject) => {
          const onError = (err: Error) => {
            socket.off("timeout", onTimeout);
            reject(err);
          };
          const onTimeout = () => {
            socket.off("error", onError);
            reject(new Error("SMTP read timed out"));
          };
          socket.once("error", onError);
          socket.once("timeout", onTimeout);
          waiters.push(() => {
            socket.off("error", onError);
            socket.off("timeout", onTimeout);
            resolve(null);
          });
          const again = takeReply();
          if (again) {
            waiters.pop();
            socket.off("error", onError);
            socket.off("timeout", onTimeout);
            resolve(again);
          }
        },
      );
      if (raced) return raced;
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
    attachSocketTimeout(socket, timeoutMs);
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

function smtpDataHeaders(message: EmailMessage): string {
  const from = sanitizeHeaderValue(message.from);
  const to = message.to.map(sanitizeHeaderValue).join(", ");
  const subject = sanitizeHeaderValue(message.subject);
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
  ].join("\r\n");
}

async function sendSmtp(
  smtpUrl: string,
  message: EmailMessage,
  timeoutMs = NOTIFY_TIMEOUT_MS,
): Promise<void> {
  const url = new URL(smtpUrl);
  const implicitTls = url.protocol === "smtps:";
  const host = url.hostname;
  const port = url.port ? Number(url.port) : implicitTls ? 465 : 587;
  const user = url.username ? decodeURIComponent(url.username) : "";
  const pass = url.password ? decodeURIComponent(url.password) : "";

  const conn = await openSmtp(host, port, implicitTls, timeoutMs);
  try {
    expectSmtp(await conn.readReply(), 220);
    await conn.write(`EHLO ${host}`);
    const ehlo = await conn.readReply();
    expectSmtp(ehlo, 250);
    const offersStartTls = ehlo.lines.some((line) => /STARTTLS/i.test(line));
    let tlsActive = implicitTls;
    if (!implicitTls && offersStartTls) {
      await conn.write("STARTTLS");
      expectSmtp(await conn.readReply(), 220);
      await conn.upgradeTls();
      tlsActive = true;
      await conn.write(`EHLO ${host}`);
      expectSmtp(await conn.readReply(), 250);
    }
    if (user) {
      if (!smtpAuthAllowed(tlsActive, user)) {
        throw new Error("SMTP AUTH requires STARTTLS or smtps://");
      }
      await conn.write("AUTH LOGIN");
      expectSmtp(await conn.readReply(), 334);
      await conn.write(Buffer.from(user).toString("base64"));
      expectSmtp(await conn.readReply(), 334);
      await conn.write(Buffer.from(pass).toString("base64"));
      expectSmtp(await conn.readReply(), 235, 250);
    }
    await conn.write(`MAIL FROM:<${sanitizeHeaderValue(message.from)}>`);
    expectSmtp(await conn.readReply(), 250);
    for (const rcpt of message.to) {
      await conn.write(`RCPT TO:<${sanitizeHeaderValue(rcpt)}>`);
      expectSmtp(await conn.readReply(), 250, 251);
    }
    await conn.write("DATA");
    expectSmtp(await conn.readReply(), 354);
    await conn.write(`${smtpDataHeaders(message)}\r\n\r\n${encodeDotStuff(message.html)}\r\n.`);
    expectSmtp(await conn.readReply(), 250);
    await conn.write("QUIT");
    await conn.readReply().catch(() => undefined);
  } finally {
    conn.end();
  }
}
