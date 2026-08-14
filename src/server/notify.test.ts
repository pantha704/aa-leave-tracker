import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_OFF_BANNER,
  isEmailConfigured,
  notifyLeavePending,
  sanitizeHeaderValue,
  shouldShowEmailBanner,
  smtpAuthAllowed,
  tryNotifyLeavePending,
  type EmailTransport,
} from "./notify";
import { renderLeavePendingHtml } from "./templates/leave-pending.html";

const notice = {
  employeeName: "Ada Lovelace",
  employeeEmail: "ada@example.com",
  leaveTypeName: "Vacation / Unpaid",
  startDate: "2026-07-06",
  endDate: "2026-07-08",
  entryId: "entry-1",
  adminEmails: ["admin@example.com", "hr@example.com"],
};

afterEach(() => {
  console.error = consoleError;
});

const consoleError = console.error;

function mockTransport(): EmailTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => undefined) };
}

describe("isEmailConfigured", () => {
  it("is false without RESEND_API_KEY or SMTP_URL", () => {
    expect(isEmailConfigured({})).toBe(false);
    expect(isEmailConfigured({ RESEND_API_KEY: "  ", SMTP_URL: "" })).toBe(false);
    expect(shouldShowEmailBanner({})).toBe(true);
    expect(EMAIL_OFF_BANNER).toBe("Email is off; check pending daily.");
  });

  it("is true when either key is set; banner stays off even after a send failure", async () => {
    expect(isEmailConfigured({ RESEND_API_KEY: "re_test" })).toBe(true);
    expect(isEmailConfigured({ SMTP_URL: "smtp://localhost:587" })).toBe(true);
    expect(shouldShowEmailBanner({ RESEND_API_KEY: "re_test" })).toBe(false);
    console.error = () => {};
    await notifyLeavePending(notice, {
      env: { RESEND_API_KEY: "re_test" },
      transport: {
        send: async () => {
          throw new Error("resend down");
        },
      },
    });
    expect(shouldShowEmailBanner({ RESEND_API_KEY: "re_test" })).toBe(false);
  });
});

describe("notifyLeavePending", () => {
  it("no-ops without a key even if a transport is provided", async () => {
    const transport = mockTransport();
    const result = await notifyLeavePending(notice, { env: {}, transport });
    expect(result).toEqual({ ok: true, skipped: true, reason: "email_disabled" });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("calls the mock transport once when RESEND_API_KEY is set", async () => {
    const transport = mockTransport();
    const result = await notifyLeavePending(notice, {
      env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "leave@example.com" },
      transport,
    });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({
      from: "leave@example.com",
      to: ["admin@example.com", "hr@example.com"],
      subject: "Pending leave: Ada Lovelace 2026-07-06 – 2026-07-08",
      html: renderLeavePendingHtml(notice),
    });
  });

  it("calls the mock transport once when SMTP_URL is set", async () => {
    const transport = mockTransport();
    const result = await notifyLeavePending(notice, {
      env: { SMTP_URL: "smtp://localhost:587" },
      transport,
    });
    expect(result).toEqual({ ok: true, skipped: false });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the transport fails", async () => {
    console.error = () => {};
    const transport: EmailTransport = {
      send: async () => {
        throw new Error("resend down");
      },
    };
    await expect(
      notifyLeavePending(notice, { env: { RESEND_API_KEY: "re_test" }, transport }),
    ).resolves.toEqual({ ok: false, skipped: false, reason: "send_failed" });
  });

  it("strips CR/LF from header fields", async () => {
    const transport = mockTransport();
    await notifyLeavePending(
      { ...notice, employeeName: "Ada\r\nBcc: evil@example.com" },
      {
        env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "leave@example.com\nBcc: x@y.z" },
        transport,
      },
    );
    const sent = transport.send.mock.calls[0]?.[0];
    expect(sent?.subject).not.toMatch(/[\r\n]/);
    expect(sent?.from).not.toMatch(/[\r\n]/);
    expect(sent?.subject).toContain("Ada");
    expect(sent?.from).toBe("leave@example.com Bcc: x@y.z");
  });

  it("skips when there are no admin emails", async () => {
    const transport = mockTransport();
    const result = await notifyLeavePending(
      { ...notice, adminEmails: ["", "  "] },
      { env: { RESEND_API_KEY: "re_test" }, transport },
    );
    expect(result).toEqual({ ok: true, skipped: true, reason: "no_recipients" });
    expect(transport.send).not.toHaveBeenCalled();
  });
});

describe("tryNotifyLeavePending", () => {
  it("swallows a throwing notifier so submit can still return 200", async () => {
    console.error = () => {};
    await expect(
      tryNotifyLeavePending(
        async () => {
          throw new Error("smtp down");
        },
        {
          employeeId: "e",
          leaveTypeId: "t",
          entryId: "x",
          startDate: "2026-07-06",
          endDate: "2026-07-06",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("does not hang when notify never resolves", async () => {
    console.error = () => {};
    const started = Date.now();
    await tryNotifyLeavePending(
      () => new Promise(() => {}),
      {
        employeeId: "e",
        leaveTypeId: "t",
        entryId: "x",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      },
      30,
    );
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("smtp + headers", () => {
  it("sanitizes CR/LF in header values", () => {
    expect(sanitizeHeaderValue("Ada\r\nBcc: evil@x")).toBe("Ada Bcc: evil@x");
  });

  it("allows AUTH only after TLS", () => {
    expect(smtpAuthAllowed(false, "user")).toBe(false);
    expect(smtpAuthAllowed(true, "user")).toBe(true);
    expect(smtpAuthAllowed(false, "")).toBe(true);
  });
});

describe("renderLeavePendingHtml", () => {
  it("escapes employee-provided text", () => {
    const html = renderLeavePendingHtml({
      employeeName: "<script>alert(1)</script>",
      startDate: "2026-07-06",
      endDate: "2026-07-06",
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
