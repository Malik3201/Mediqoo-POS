"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Building2, Users, RefreshCw, UserX, UserCheck, Copy, KeyRound, Check } from "lucide-react";
import { toast } from "sonner";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Client = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  timezone: string;
  created_at: string;
};

type PortalUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  password_plain?: string | null;
  last_login_at?: string | null;
};

const empty = {
  name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  address: "",
  notes: "",
  status: "active",
  timezone: "Asia/Karachi",
};

export default function ClientsPage() {
  const { data: rows = [], isLoading: loading } = useDataQuery("clients");
  const { mutateAsync } = useDataMutation("clients");
  
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(empty);
  const [portalClient, setPortalClient] = useState<Client | null>(null);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(row: Client) {
    setEditing(row);
    setForm({
      name: row.name,
      contact_name: row.contact_name ?? "",
      contact_email: row.contact_email ?? "",
      contact_phone: row.contact_phone ?? "",
      address: row.address ?? "",
      notes: row.notes ?? "",
      status: row.status,
      timezone: row.timezone ?? "Asia/Karachi",
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      address: form.address || null,
      notes: form.notes || null,
      status: form.status,
    };
    
    try {
      if (editing) {
        await mutateAsync({ method: "PATCH", data: payload, id: editing.id });
      } else {
        await mutateAsync({ method: "POST", data: payload });
      }
      toast.success(editing ? "Client updated" : "Client created");
      setOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this client? This cannot be undone.")) return;
    try {
      await mutateAsync({ method: "DELETE", id });
      toast.success("Client deleted");
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            Clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Businesses for which POS projects are generated.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" />
          New client
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No clients yet. Create your first one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r: Client) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.contact_name ?? "—"}</TableCell>
                  <TableCell>{r.contact_email ?? "—"}</TableCell>
                  <TableCell>{r.contact_phone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "active" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => { setPortalClient(r); }} title="Portal Access">
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "New client"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Contact name</Label>
                <Input
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Timezone (IANA)</Label>
              <Input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="Asia/Karachi"
              />
              <p className="text-xs text-muted-foreground">Used for portal dashboard date ranges. Default: Asia/Karachi</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Address</Label>
              <Textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Portal Users Modal */}
      {portalClient && (
        <PortalUsersModal
          client={portalClient}
          onClose={() => setPortalClient(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal Users Modal
// ─────────────────────────────────────────────────────────────────────────────

function PortalUsersModal({ client, onClose }: { client: { id: string; name: string }; onClose: () => void }) {
  const [users, setUsers] = useState<PortalUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", role: "owner" });
  const [inviting, setInviting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/admin/portal-users?client_id=${client.id}`);
      if (res.ok) setUsers(await res.json());
    } catch {}
    finally { setLoadingUsers(false); }
  };

  useEffect(() => { fetchUsers(); }, [client.id]);

  const copyPassword = (id: string, pwd: string) => {
    navigator.clipboard.writeText(pwd);
    setCopiedId(id);
    toast.success("Password copied to clipboard");
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  };

  const saveDirectPassword = async (userId: string) => {
    const trimmed = newPasswordInput.trim();
    if (trimmed.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/admin/portal-users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: trimmed }),
      });
      if (res.ok) {
        toast.success("Password updated");
        setEditingPasswordUserId(null);
        setNewPasswordInput("");
        fetchUsers();
      } else {
        const d = await res.json();
        toast.error(d.error ?? "Failed to update password");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingPassword(false);
    }
  };

  const invite = async () => {
    if (!inviteForm.name || !inviteForm.email) { toast.error("Name and email required"); return; }
    setInviting(true);
    try {
      const res = await fetch("/api/admin/portal-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, ...inviteForm }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error ?? "Failed"); return; }
      toast.success("Invite sent!");
      setInviteOpen(false);
      setInviteForm({ name: "", email: "", role: "owner" });
      fetchUsers();
    } catch { toast.error("Network error"); }
    finally { setInviting(false); }
  };

  const resend = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/portal-users/${id}/resend-invite`, { method: "POST" });
      if (res.ok) toast.success("Invite resent");
      else { const d = await res.json(); toast.error(d.error ?? "Failed"); }
    } catch { toast.error("Network error"); }
  };

  const toggleStatus = async (u: PortalUserRow) => {
    const newStatus = u.status === "disabled" ? "active" : "disabled";
    try {
      const res = await fetch(`/api/admin/portal-users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) { toast.success(`User ${newStatus === "disabled" ? "disabled" : "enabled"}`); fetchUsers(); }
      else { const d = await res.json(); toast.error(d.error ?? "Failed"); }
    } catch { toast.error("Network error"); }
  };

  const statusBadge = (s: string) => {
    const cls = s === "active" ? "bg-emerald-100 text-emerald-800" : s === "invited" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{s}</span>;
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Portal Access — {client.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setInviteOpen(!inviteOpen)}>
              <Plus className="h-3.5 w-3.5" />
              Create Portal User
            </Button>
          </div>

          {inviteOpen && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium">New Portal User</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Name *</Label>
                  <Input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="Ali Raza" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Email *</Label>
                  <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="ali@pharmacy.com" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Role</Label>
                <Select value={inviteForm.role} onValueChange={(v) => setInviteForm({ ...inviteForm, role: v })}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={invite} disabled={inviting}>{inviting ? "Sending…" : "Send Invite"}</Button>
                <Button size="sm" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingUsers ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No portal users yet. Create the first one above.</TableCell></TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                    <TableCell>{statusBadge(u.status)}</TableCell>
                    <TableCell>
                      {editingPasswordUserId === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="text"
                            value={newPasswordInput}
                            onChange={(e) => setNewPasswordInput(e.target.value)}
                            placeholder="Min 8 chars"
                            className="h-7 w-32 text-xs font-mono"
                          />
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={savingPassword}
                            onClick={() => saveDirectPassword(u.id)}
                          >
                            {savingPassword ? "…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-1.5 text-xs"
                            onClick={() => {
                              setEditingPasswordUserId(null);
                              setNewPasswordInput("");
                            }}
                          >
                            ✕
                          </Button>
                        </div>
                      ) : u.password_plain ? (
                        <div className="inline-flex items-center gap-1.5">
                          <code className="px-2 py-0.5 rounded bg-muted font-mono text-xs text-foreground select-all border">
                            {u.password_plain}
                          </code>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => copyPassword(u.id, u.password_plain!)}
                            title="Copy password"
                          >
                            {copiedId === u.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingPasswordUserId(u.id);
                              setNewPasswordInput(u.password_plain || "");
                            }}
                            title="Change password"
                          >
                            <KeyRound className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : u.status === "invited" ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground italic">Not set yet</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px]"
                            onClick={() => {
                              setEditingPasswordUserId(u.id);
                              setNewPasswordInput("");
                            }}
                            title="Set password manually"
                          >
                            <KeyRound className="h-3 w-3 mr-1" /> Set
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground" title="Will sync on user's next login, or click Set to define a new password now">
                            Set before update
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              setEditingPasswordUserId(u.id);
                              setNewPasswordInput("");
                            }}
                            title="Set a new visible password"
                          >
                            <KeyRound className="h-3 w-3 mr-1" /> Set Password
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.status !== "active" && (
                        <Button size="icon" variant="ghost" onClick={() => resend(u.id)} title="Resend invite">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleStatus(u)}
                        title={u.status === "disabled" ? "Enable" : "Disable"}
                      >
                        {u.status === "disabled" ? <UserCheck className="h-3.5 w-3.5" /> : <UserX className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
