"use server";

import { redirect } from "next/navigation";
import { acceptInvite, defaultInviteDeps } from "@/server/invite";

export type AcceptInviteState = { error: string } | undefined;

export async function acceptInviteAction(
  token: string,
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const password = String(formData.get("password") ?? "");
  const result = await acceptInvite({ rawToken: token, password }, defaultInviteDeps());
  if (!result.ok) {
    return { error: result.error };
  }
  redirect("/login?invited=1");
}
