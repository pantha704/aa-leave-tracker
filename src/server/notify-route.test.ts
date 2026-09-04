import { describe, expect, it } from "vitest";
import { decisionNotifyRoles, pendingNotifyRoles } from "./notify-route";

describe("notification routing", () => {
  it("sends pending requests to manager and HR, and executive when that step is next", () => {
    expect(pendingNotifyRoles()).toEqual(["manager", "hr"]);
    expect(pendingNotifyRoles("hr")).toEqual(["manager", "hr"]);
    expect(pendingNotifyRoles("executive")).toEqual(["manager", "hr", "executive"]);
  });

  it("sends decisions to employee and HR", () => {
    expect(decisionNotifyRoles()).toEqual(["employee", "hr"]);
  });
});
