"use client";
import { Suspense } from "react";
import { PageHeader } from "@flowaid/ui/shell";
import { ApiKeysTab } from "~/admin/settings/ApiKeysTab";
import { AuditTab } from "~/admin/settings/AuditTab";
import { EnvironmentsTab } from "~/admin/settings/EnvironmentsTab";
import { MembersTab } from "~/admin/settings/MembersTab";
import { NotificationsTab } from "~/admin/settings/NotificationsTab";
import { ProfileTab } from "~/admin/settings/ProfileTab";
import { WorkspaceTab } from "~/admin/settings/WorkspaceTab";
import { DraftProvider, isTabDirty, useDirtyKeys } from "~/admin/drafts";
import { useQueryTab } from "~/admin/ui";
import { useSession, type Session } from "~/session";
import { AppFrame, PageBody } from "~/shell/AppFrame";

const TABS = [
  { id: "workspace", label: "Workspace", visible: () => true },
  {
    id: "members",
    label: "Members",
    visible: (s: Session) => !s.local && s.can("workflows:read"),
  },
  { id: "api-keys", label: "API keys", visible: (s: Session) => s.can("api_keys:manage") },
  { id: "environments", label: "Environments", visible: () => true },
  {
    id: "notifications",
    label: "Notifications",
    visible: (s: Session) => s.can("admin") && s.features.settings_notifications === true,
  },
  {
    id: "audit",
    label: "Audit log",
    visible: (s: Session) => s.can("audit:read") && s.features.settings_audit === true,
  },
  {
    id: "profile",
    label: "Profile",
    visible: (s: Session) => !s.local && s.me.user !== null,
  },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Settings() {
  const s = useSession();
  const tabs = TABS.filter((t) => t.visible(s));
  const [tab, setTab] = useQueryTab<TabId>(tabs.map((t) => t.id));
  const dirtyKeys = useDirtyKeys();
  return (
    <PageBody>
      <PageHeader
        title="Settings"
        description={
          s.local
            ? `${s.workspaceName} workspace`
            : `${s.workspaceName} · your role: ${s.me.principal.role ?? "none"}`
        }
        tabs={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          unsaved: isTabDirty(dirtyKeys, t.id),
        }))}
        tab={tab}
        onTabChange={(t) => setTab(t as TabId)}
      />
      <div className="mt-5">
        {tab === "workspace" ? (
          <WorkspaceTab />
        ) : tab === "members" ? (
          <MembersTab />
        ) : tab === "api-keys" ? (
          <ApiKeysTab />
        ) : tab === "environments" ? (
          <EnvironmentsTab />
        ) : tab === "notifications" ? (
          <NotificationsTab />
        ) : tab === "audit" ? (
          <AuditTab />
        ) : (
          <ProfileTab />
        )}
      </div>
    </PageBody>
  );
}

export default function SettingsPage() {
  const s = useSession();
  return (
    <AppFrame crumbs={[{ label: s.workspaceName }, { label: "Settings" }]}>
      <Suspense>
        {/* unsaved edits survive switching tabs */}
        <DraftProvider>
          <Settings />
        </DraftProvider>
      </Suspense>
    </AppFrame>
  );
}
