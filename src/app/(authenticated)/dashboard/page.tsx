import { Activity, Building2, FolderKanban, KeyRound, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import connectToDatabase from "@/lib/db";
import Profile from "@/models/Profile";
import Client from "@/models/Client";
import Project from "@/models/Project";
import License from "@/models/License";
import AuditLog from "@/models/AuditLog";
import { getServerSession } from "next-auth";

export const metadata = {
  title: "Dashboard · AivraSol Builder",
  description: "AivraSol Builder administrator dashboard.",
};

export default async function DashboardPage() {
  const session = await getServerSession();
  
  await connectToDatabase();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const [users, clients, projects, licenses, events24h, eventsTotal] = await Promise.all([
    Profile.countDocuments(),
    Client.countDocuments(),
    Project.countDocuments(),
    License.countDocuments(),
    AuditLog.countDocuments({ created_at: { $gte: yesterday } }),
    AuditLog.countDocuments(),
  ]);

  const cards = [
    { label: "Administrators", value: users, icon: Users },
    { label: "Clients", value: clients, icon: Building2 },
    { label: "Projects", value: projects, icon: FolderKanban },
    { label: "Active licenses", value: licenses, icon: KeyRound },
    { label: "Events (24h)", value: events24h, icon: Activity },
    { label: "Events (total)", value: eventsTotal, icon: Activity },
  ];

  const displayName = session?.user?.name || session?.user?.email?.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {displayName}</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your AivraSol Builder workspace.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Milestone 1 · Foundation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The Next.js Builder foundation is live: MongoDB backend, custom authentication,
            role-based access (super_admin / admin / operator), audit logging, admin layout, and
            dashboard.
          </p>
          <p>
            Next milestone (M2) will introduce Clients and Business Templates. Sidebar links for
            future modules are visible but disabled until their milestones are shipped.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
