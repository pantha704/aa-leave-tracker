import { OpsBanner } from "@/components/ops-banner";
import { requireEmployee } from "@/server/auth";
import { getOrgSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function MeLayout({ children }: LayoutProps<"/me">) {
  const { employee } = await requireEmployee();
  const settings = await getOrgSettings(employee.orgId);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <OpsBanner appReadonly={settings.appReadonly} />
      {children}
    </div>
  );
}
