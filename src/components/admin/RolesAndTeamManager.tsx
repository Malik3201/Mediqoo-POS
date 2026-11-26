"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Users,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  Lock,
  Activity,
  RefreshCw,
  UserPlus,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PermissionDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

interface RoleItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  member_count: number;
  created_by_name?: string;
  created_at?: string;
}

interface AdminMember {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  role: string;
  role_name: string;
  is_master?: boolean;
  created_by_name?: string | null;
  last_login_at?: string | null;
  activity_count: number;
  last_activity_at?: string | null;
}

export function RolesAndTeamManager({ defaultTab = "admins" }: { defaultTab?: "admins" | "roles" }) {
  const [tab, setTab] = useState<"admins" | "roles">(defaultTab);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [permsCatalog, setPermsCatalog] = useState<PermissionDef[]>([]);

  // Create / Edit Role modal
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [roleForm, setRoleForm] = useState({
    name: "",
    description: "",
    permissions: [] as string[],
  });
  const [savingRole, setSavingRole] = useState(false);

  // Add / Edit Admin modal
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminMember | null>(null);
  const [adminForm, setAdminForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "admin",
    status: "active" as "active" | "disabled",
  });
  const [savingAdmin, setSavingAdmin] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load roles and admins");
      }
      setIsSuperAdmin(Boolean(data.current_actor?.isSuperAdmin));
      setRoles(data.roles || []);
      setAdmins(data.admins || []);
      setPermsCatalog(data.permissions_catalog || []);
    } catch (err: any) {
      toast.error(err?.message || "Could not load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreateRole = () => {
    setEditingRole(null);
    setRoleForm({
      name: "",
      description: "",
      permissions: ["clients", "projects", "licenses", "quick_trial", "audit_view"],
    });
    setRoleModalOpen(true);
  };

  const openEditRole = (r: RoleItem) => {
    setEditingRole(r);
    setRoleForm({
      name: r.name,
      description: r.description || "",
      permissions: [...(r.permissions || [])],
    });
    setRoleModalOpen(true);
  };

  const togglePermission = (key: string) => {
    setRoleForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleForm.name.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSavingRole(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: editingRole ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingRole
            ? { id: editingRole.id, ...roleForm }
            : roleForm
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save role");
      toast.success(editingRole ? `Updated role "${roleForm.name}"` : `Created role "${roleForm.name}"`);
      setRoleModalOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save role");
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (r: RoleItem) => {
    if (!window.confirm(`Delete custom role "${r.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/roles?id=${encodeURIComponent(r.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete role");
      toast.success(`Deleted role "${r.name}"`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const openAddAdmin = () => {
    setEditingAdmin(null);
    const defaultRole = roles.find((r) => r.slug !== "super_admin")?.slug || "admin";
    setAdminForm({
      name: "",
      email: "",
      password: "",
      role: defaultRole,
      status: "active",
    });
    setAdminModalOpen(true);
  };

  const openEditAdmin = (m: AdminMember) => {
    setEditingAdmin(m);
    setAdminForm({
      name: m.name,
      email: m.email,
      password: "",
      role: m.role,
      status: m.status,
    });
    setAdminModalOpen(true);
  };

  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminForm.name.trim()) {
      toast.error("Admin name is required");
      return;
    }
    if (!editingAdmin && (!adminForm.email.trim() || adminForm.password.length < 6)) {
      toast.error("Valid email and password (min 6 characters) are required");
      return;
    }
    setSavingAdmin(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: editingAdmin ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingAdmin
            ? {
                id: editingAdmin.id,
                name: adminForm.name.trim(),
                role: adminForm.role,
                status: adminForm.status,
                ...(adminForm.password.trim() ? { password: adminForm.password } : {}),
              }
            : {
                name: adminForm.name.trim(),
                email: adminForm.email.trim(),
                password: adminForm.password,
                role: adminForm.role,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save admin");
      toast.success(
        editingAdmin
          ? `Updated admin "${adminForm.name}"`
          : `Added admin "${adminForm.name}" — all their actions will be logged under their name.`
      );
      setAdminModalOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save admin");
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleToggleAdminStatus = async (m: AdminMember) => {
    const nextStatus = m.status === "active" ? "disabled" : "active";
    if (!window.confirm(`${nextStatus === "disabled" ? "Disable" : "Re-enable"} login access for "${m.name}"?`)) {
      return;
    }
    try {
      const res = await fetch("/api/admin/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to update status");
      toast.success(`${m.name} is now ${nextStatus}`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Update failed");
    }
  };

  const handleDeleteAdmin = async (m: AdminMember) => {
    if (!window.confirm(`Permanently remove admin "${m.name}" (${m.email})? Their historical activity logs remain intact.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/team?id=${encodeURIComponent(m.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to remove admin");
      toast.success(`Removed admin "${m.name}"`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const groupedPerms = permsCatalog.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    (acc[p.group] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 mb-2">
            <ShieldCheck className="h-3.5 w-3.5" /> Access Control &amp; Team Activity Attribution
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Roles &amp; Admin Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create custom admin roles, add team admins with their names, and track every client, license, or trial action under that admin&apos;s name.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/activity">
              <Activity className="h-4 w-4 mr-1.5" /> View Activity Feed
            </Link>
          </Button>
          {isSuperAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={openCreateRole}>
                <Plus className="h-4 w-4 mr-1.5" /> New Role
              </Button>
              <Button size="sm" onClick={openAddAdmin}>
                <UserPlus className="h-4 w-4 mr-1.5" /> Add Admin
              </Button>
            </>
          )}
        </div>
      </div>

      {!loading && !isSuperAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            You are viewing in read-only mode. Only <strong>Super Admin</strong> can create custom roles or add/edit admin team accounts.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b pb-1">
        <button
          type="button"
          onClick={() => setTab("admins")}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
            tab === "admins"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Admin Team ({admins.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("roles")}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
            tab === "roles"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Roles &amp; Permissions ({roles.length})
        </button>
      </div>

      {/* TAB 1: ADMIN TEAM */}
      {tab === "admins" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Administrator Accounts</CardTitle>
              <CardDescription>
                Every action performed by an admin (creating clients, issuing licenses, extending trials, generating packages) is automatically saved under their name in Activity &amp; Audit Logs.
              </CardDescription>
            </div>
            {isSuperAdmin && (
              <Button size="sm" onClick={openAddAdmin} className="shrink-0">
                <UserPlus className="h-4 w-4 mr-1.5" /> Add Admin
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-3 px-4 text-left">Admin Name</th>
                    <th className="py-3 px-4 text-left">Role</th>
                    <th className="py-3 px-4 text-left">Status</th>
                    <th className="py-3 px-4 text-left">Logged Activity</th>
                    <th className="py-3 px-4 text-left">Last Login</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted-foreground">
                        Loading team admins…
                      </td>
                    </tr>
                  ) : admins.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted-foreground">
                        No administrators configured yet.
                      </td>
                    </tr>
                  ) : (
                    admins.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground flex items-center gap-2">
                            {m.name}
                            {m.is_master && (
                              <Badge variant="default" className="text-[10px]">
                                Master
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={m.role === "super_admin" ? "default" : "secondary"}>
                            {m.role_name}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          {m.status === "active" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600">
                              <XCircle className="h-3.5 w-3.5" /> Disabled
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/activity?actor_id=${encodeURIComponent(m.id)}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                          >
                            <Activity className="h-3.5 w-3.5" />
                            {m.activity_count} event{m.activity_count === 1 ? "" : "s"}
                          </Link>
                          {m.last_activity_at && (
                            <div className="text-[11px] text-muted-foreground">
                              Last: {new Date(m.last_activity_at).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {m.last_login_at
                            ? new Date(m.last_login_at).toLocaleString()
                            : m.is_master
                            ? "Env Master"
                            : "Never"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isSuperAdmin && !m.is_master ? (
                            <div className="inline-flex items-center gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => openEditAdmin(m)}>
                                <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleToggleAdminStatus(m)}
                              >
                                {m.status === "active" ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleDeleteAdmin(m)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Protected</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 2: ROLES & PERMISSIONS */}
      {tab === "roles" && (
        <div className="grid gap-4 md:grid-cols-2">
          {loading ? (
            <div className="col-span-2 py-10 text-center text-sm text-muted-foreground">
              Loading roles…
            </div>
          ) : (
            roles.map((r) => (
              <Card key={r.id} className="flex flex-col justify-between">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{r.name}</CardTitle>
                        {r.is_system ? (
                          <Badge variant="outline" className="text-[10px]">
                            System Role
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Custom Role
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="mt-1">
                        {r.description || "Custom administrator role"}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {r.member_count} admin{r.member_count === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {(r.permissions || []).map((pKey) => {
                      const def = permsCatalog.find((d) => d.key === pKey);
                      return (
                        <span
                          key={pKey}
                          className="rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] font-medium"
                        >
                          {def?.label || pKey}
                        </span>
                      );
                    })}
                  </div>
                  {isSuperAdmin && r.slug !== "super_admin" && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t">
                      <Button variant="outline" size="sm" onClick={() => openEditRole(r)}>
                        <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit Permissions
                      </Button>
                      {!r.is_system && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void handleDeleteRole(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* MODAL: CREATE / EDIT ROLE */}
      <Dialog open={roleModalOpen} onOpenChange={setRoleModalOpen}>
        <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? `Edit Role — ${editingRole.name}` : "Create Custom Role"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveRole} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role Name *</Label>
              <Input
                value={roleForm.name}
                onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                placeholder="e.g. Sales Manager, Support Specialist, Trial Operator"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                placeholder="Short summary of what this role manages"
              />
            </div>

            <div className="space-y-3 pt-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Permissions ({roleForm.permissions.length} selected)
              </Label>
              {Object.entries(groupedPerms).map(([group, defs]) => (
                <div key={group} className="rounded-xl border p-3 space-y-2">
                  <div className="text-xs font-bold text-muted-foreground uppercase">{group}</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {defs.map((d) => {
                      const checked = roleForm.permissions.includes(d.key);
                      return (
                        <label
                          key={d.key}
                          className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer text-xs transition ${
                            checked ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(d.key)}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-semibold">{d.label}</div>
                            <div className="text-[11px] text-muted-foreground">{d.description}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRoleModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingRole}>
                {savingRole ? "Saving…" : editingRole ? "Update Role" : "Create Role"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: ADD / EDIT ADMIN */}
      <Dialog open={adminModalOpen} onOpenChange={setAdminModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAdmin ? `Edit Admin — ${editingAdmin.name}` : "Add New Administrator"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveAdmin} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name * (Shown in Activity Logs)</Label>
              <Input
                value={adminForm.name}
                onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })}
                placeholder="e.g. Ali Raza"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Login Email *</Label>
              <Input
                type="email"
                value={adminForm.email}
                onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                placeholder="ali@aivrasol.com"
                disabled={Boolean(editingAdmin)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                {editingAdmin ? "Reset Password (leave blank to keep current)" : "Password * (min 6 chars)"}
              </Label>
              <Input
                type="password"
                value={adminForm.password}
                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                placeholder={editingAdmin ? "Optional new password" : "Set strong password"}
                required={!editingAdmin}
                minLength={editingAdmin ? 0 : 6}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Assigned Role *</Label>
              <select
                value={adminForm.role}
                onChange={(e) => setAdminForm({ ...adminForm, role: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {roles.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name} ({r.permissions.length} permissions)
                  </option>
                ))}
              </select>
            </div>

            {editingAdmin && (
              <div className="space-y-1.5">
                <Label>Account Status</Label>
                <select
                  value={adminForm.status}
                  onChange={(e) =>
                    setAdminForm({ ...adminForm, status: e.target.value as "active" | "disabled" })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="active">Active (Can Sign In)</option>
                  <option value="disabled">Disabled (Access Blocked)</option>
                </select>
              </div>
            )}

            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
              <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <span>
                When <strong>{adminForm.name || "this admin"}</strong> creates or modifies any client, license, project, or trial, it will automatically be recorded under their name in Activity &amp; Audit Logs.
              </span>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdminModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingAdmin}>
                {savingAdmin ? "Saving…" : editingAdmin ? "Save Changes" : "Create Admin"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
