import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMAIL_OFF_BANNER, shouldShowEmailBanner } from "@/server/notify";
import { AdminEmailBanner } from "./email-banner";

describe("AdminEmailBanner", () => {
  it("renders EMAIL_OFF_BANNER when email is off", () => {
    expect(shouldShowEmailBanner({})).toBe(true);
    const html = renderToStaticMarkup(<AdminEmailBanner env={{}} />);
    expect(html).toContain(EMAIL_OFF_BANNER);
  });

  it("renders nothing when a mail key is set", () => {
    expect(shouldShowEmailBanner({ RESEND_API_KEY: "re_test" })).toBe(false);
    const html = renderToStaticMarkup(<AdminEmailBanner env={{ RESEND_API_KEY: "re_test" }} />);
    expect(html).toBe("");
  });
});
