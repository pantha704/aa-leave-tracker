export type LeavePendingHtmlInput = {
  employeeName: string;
  employeeEmail?: string | null;
  leaveTypeName?: string | null;
  startDate: string;
  endDate: string;
  entryId?: string | null;
  adminUrl?: string | null;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** One `leave.pending` HTML body. */
export function renderLeavePendingHtml(input: LeavePendingHtmlInput): string {
  const name = escapeHtml(input.employeeName);
  const email = input.employeeEmail ? escapeHtml(input.employeeEmail) : "";
  const who = email ? `${name} (${email})` : name;
  const type = escapeHtml(input.leaveTypeName?.trim() || "leave");
  const start = escapeHtml(input.startDate);
  const end = escapeHtml(input.endDate);
  const dates = start === end ? start : `${start} – ${end}`;
  const reviewHref = input.adminUrl?.trim() || "/admin/employees#pending";
  const review = escapeHtml(reviewHref);
  const entry = input.entryId ? escapeHtml(input.entryId) : "";

  return `<!doctype html>
<html lang="en">
  <body>
    <p>A leave request is pending.</p>
    <p><strong>Employee:</strong> ${who}</p>
    <p><strong>Type:</strong> ${type}</p>
    <p><strong>Dates:</strong> ${dates}</p>
    ${entry ? `<p><strong>Entry:</strong> ${entry}</p>` : ""}
    <p>Review pending requests: <a href="${review}">${review}</a></p>
    <p>If you cannot open the link, check Admin → Employees → Pending.</p>
  </body>
</html>
`;
}
