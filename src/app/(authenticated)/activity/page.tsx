"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, RefreshCw, Search, UserCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ActivityItem {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  actor_email: string;
  actor_role: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

interface ActorOption {
  id: string;
  name: string;
  email: string;
}

function ActivityPageContent() {
  const searchParams = useSearchParams();
  const initialActor = searchParams.get("actor_id") || "all";

  const [logs, setLogs] = useState<ActivityItem[]>([]);
  const [actors, setActors] = useState<ActorOption[]>([]);
  const [actorFilter, setActorFilter] = useState(initialActor);
  const [entityFilter, setEntityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (actorFilter !== "all") qs.set("actor_id", actorFilter);
      if (entityFilter !== "all") qs.set("entity_type", entityFilter);
      if (searchQuery.trim()) qs.set("q", searchQuery.trim());
      const res = await fetch(`/api/admin/activity?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setLogs(data.logs || []);
        setActors(data.actors || []);
      }
    } finally {
      setLoading(false);
    }
  }, [actorFilter, entityFilter, searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => void loadActivity(), 200);
    return () => clearTimeout(t);
  }, [loadActivity]);

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Administrator Activity Feed
          </h1>
          <p className="text-sm text-muted-foreground">
            Live attribution log of every client, license, quick trial, project, and role change — saved with the acting admin&apos;s name.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadActivity()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by admin name, license key, client, action..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="all">All Admins</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="all">All Modules</option>
          <option value="client">Clients</option>
          <option value="license">Licenses</option>
          <option value="quick_trial">Quick Trials</option>
          <option value="project">Projects</option>
          <option value="package">Packages</option>
          <option value="role">Roles</option>
          <option value="admin_user">Admin Team</option>
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Actions ({logs.length})</CardTitle>
          <CardDescription>Showing up to 200 most recent logged administrator activities.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Activity Details</TableHead>
                  <TableHead>Entity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading administrator activity…
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No matching activity recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-semibold text-sm">
                          <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>{row.actor_name}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.actor_role}
                          {row.actor_email ? ` · ${row.actor_email}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[11px]">
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[340px]">
                        {row.summary || row.action}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {row.entity_type ? `${row.entity_type}${row.entity_id ? `:${row.entity_id.slice(0, 12)}` : ""}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading activity feed…</div>
      }
    >
      <ActivityPageContent />
    </Suspense>
  );
}
