"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Rocket, Pencil, Trash2, ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useDataQuery, useDataMutation } from "@/hooks/use-data";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Client = { id: string; name: string };
type Template = { id: string; name: string; slug: string; modules: string[]; version: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  version: string;
  status: string;
  client_id: string;
  template_id: string;
  modules_config: Record<string, boolean>;
  branding: Record<string, string>;
  hardware_config: Record<string, unknown>;
  notes: string | null;
  updated_at: string;
  clients?: { name: string } | null;
  business_templates?: { name: string; slug: string } | null;
};

const STEPS = [
  { key: "client", label: "Client" },
  { key: "template", label: "Template" },
  { key: "modules", label: "Modules" },
  { key: "branding", label: "Branding" },
  { key: "hardware", label: "Hardware" },
  { key: "review", label: "Review" },
] as const;

type WizardForm = {
  name: string;
  slug: string;
  version: string;
  description: string;
  client_id: string;
  template_id: string;
  modules_config: Record<string, boolean>;
  branding: { primary_color: string; logo_url: string; store_name: string };
  hardware_config: { printer: string; barcode_scanner: boolean; cash_drawer: boolean };
  notes: string;
};

const emptyForm: WizardForm = {
  name: "",
  slug: "",
  version: "1.0.0",
  description: "",
  client_id: "",
  template_id: "",
  modules_config: {},
  branding: { primary_color: "#16a34a", logo_url: "", store_name: "" },
  hardware_config: { printer: "none", barcode_scanner: false, cash_drawer: false },
  notes: "",
};

export default function ProjectsPage() {
  const { data: session } = useSession();
  
  const { data: rawRows = [], isLoading: loadingRows } = useDataQuery("projects");
  const { data: clients = [], isLoading: loadingClients } = useDataQuery("clients");
  const { data: templates = [], isLoading: loadingTemplates } = useDataQuery("business_templates");
  
  const { mutateAsync: mutateProject } = useDataMutation("projects");

  const loading = loadingRows || loadingClients || loadingTemplates;

  const rows: Project[] = useMemo(() => {
    return rawRows.map((r: any) => ({
      ...r,
      clients: clients.find((c: any) => c.id === r.client_id) || null,
      business_templates: templates.find((t: any) => t.id === r.template_id) || null,
    }));
  }, [rawRows, clients, templates]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(emptyForm);

  const selectedTemplate = useMemo(
    () => templates.find((t: any) => t.id === form.template_id) ?? null,
    [templates, form.template_id],
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setStep(0);
    setOpen(true);
  }

  function openEdit(row: Project) {
    setEditing(row);
    setForm({
      name: row.name,
      slug: row.slug,
      version: row.version,
      description: "",
      client_id: row.client_id,
      template_id: row.template_id,
      modules_config: row.modules_config ?? {},
      branding: {
        primary_color: row.branding?.primary_color ?? "#16a34a",
        logo_url: row.branding?.logo_url ?? "",
        store_name: row.branding?.store_name ?? "",
      },
      hardware_config: {
        printer: (row.hardware_config?.printer as string) ?? "none",
        barcode_scanner: Boolean(row.hardware_config?.barcode_scanner),
        cash_drawer: Boolean(row.hardware_config?.cash_drawer),
      },
      notes: row.notes ?? "",
    });
    setStep(0);
    setOpen(true);
  }

  function pickTemplate(id: string) {
    const tpl = templates.find((t: any) => t.id === id);
    const mods: Record<string, boolean> = {};
    (tpl?.modules || []).forEach((m: string) => (mods[m] = true));
    setForm((f) => ({ ...f, template_id: id, modules_config: mods, version: tpl?.version ?? f.version }));
  }

  async function save(markReady = false) {
    if (!form.name.trim() || !form.slug.trim() || !form.client_id || !form.template_id) {
      toast.error("Name, slug, client and template are required");
      return;
    }
    const status = (markReady ? "ready" : (editing?.status ?? "draft")) as string;
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase(),
      version: form.version.trim() || "1.0.0",
      description: form.description || null,
      client_id: form.client_id,
      template_id: form.template_id,
      modules_config: form.modules_config,
      branding: form.branding,
      hardware_config: form.hardware_config,
      notes: form.notes || null,
      status,
    };
    
    try {
      if (editing) {
        await mutateProject({ method: "PATCH", data: payload, id: editing.id });
      } else {
        await mutateProject({ method: "POST", data: { ...payload, created_by: session?.user?.id } });
      }
      toast.success(editing ? "Project updated" : "Project created");
      setOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project?")) return;
    try {
      await mutateProject({ method: "DELETE", id });
      toast.success("Project deleted");
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  const canNext = () => {
    if (step === 0) return Boolean(form.client_id && form.name.trim() && form.slug.trim());
    if (step === 1) return Boolean(form.template_id);
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" />
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure a client deployment through the wizard, then generate a license and package.
          </p>
        </div>
        <Button onClick={openNew} disabled={clients.length === 0 || templates.length === 0}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {(clients.length === 0 || templates.length === 0) && (
        <div className="rounded-md border bg-muted/40 p-4 text-sm">
          You need at least one <Link href="/clients" className="underline">client</Link> and one active{" "}
          <Link href="/templates" className="underline">business template</Link> before creating a project.
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Version</TableHead>
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
                  No projects yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name}
                    <div className="text-xs text-muted-foreground font-mono">{r.slug}</div>
                  </TableCell>
                  <TableCell>{r.clients?.name ?? "—"}</TableCell>
                  <TableCell>{r.business_templates?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.version}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "draft" ? "secondary" : "default"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-1 text-xs">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={`h-6 w-6 rounded-full grid place-items-center border ${
                    i === step
                      ? "bg-primary text-primary-foreground border-primary"
                      : i < step
                        ? "bg-primary/20 border-primary/30"
                        : "bg-muted border-border"
                  }`}
                >
                  {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={i === step ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
                {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>

          <div className="min-h-[280px] py-2">
            {step === 0 && (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>Client *</Label>
                  <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Project name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Slug *</Label>
                    <Input
                      value={form.slug}
                      onChange={(e) => setForm({ ...form, slug: e.target.value })}
                      placeholder="acme-pharmacy"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-3">
                <Label>Business template *</Label>
                <div className="grid gap-2">
                  {templates.map((t: any) => (
                    <button
                      key={t.id}
                      onClick={() => pickTemplate(t.id)}
                      className={`text-left flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                        form.template_id === t.id
                          ? "border-primary bg-primary/5"
                          : "hover:border-foreground/20 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex-1">
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          v{t.version} · {t.modules.length} modules configured
                        </div>
                      </div>
                      {form.template_id === t.id && <CheckCircle2 className="h-5 w-5 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4">
                <div className="text-sm text-muted-foreground">
                  The active modules based on <strong>{selectedTemplate?.name}</strong>. Toggle to
                  override.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {["inventory", "crm", "analytics", "kitchen_display", "loyalty", "ecommerce"].map((mod) => (
                    <label
                      key={mod}
                      className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={form.modules_config[mod] || false}
                        onCheckedChange={(c) =>
                          setForm({
                            ...form,
                            modules_config: { ...form.modules_config, [mod]: c === true },
                          })
                        }
                      />
                      <span className="font-medium capitalize text-sm">
                        {mod.replace("_", " ")}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label>Store Name</Label>
                    <Input
                      value={form.branding.store_name}
                      onChange={(e) =>
                        setForm({ ...form, branding: { ...form.branding, store_name: e.target.value } })
                      }
                      placeholder="Acme Pharmacy"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Primary Color (Hex)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="color"
                        value={form.branding.primary_color}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            branding: { ...form.branding, primary_color: e.target.value },
                          })
                        }
                        className="w-12 p-1 px-2 h-9"
                      />
                      <Input
                        value={form.branding.primary_color}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            branding: { ...form.branding, primary_color: e.target.value },
                          })
                        }
                        className="flex-1 font-mono text-sm uppercase"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Store Logo (Auto cropped to 1:1)</Label>
                  <div className="flex items-center gap-4">
                    {form.branding.logo_url ? (
                      <img 
                        src={form.branding.logo_url} 
                        alt="Logo Preview" 
                        className="h-16 w-16 rounded-md border object-cover bg-muted"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-md border border-dashed flex items-center justify-center bg-muted/50 text-xs text-muted-foreground">
                        No Logo
                      </div>
                    )}
                    <div className="flex-1">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const img = new Image();
                            img.onload = () => {
                              const canvas = document.createElement("canvas");
                              const size = Math.min(img.width, img.height);
                              const targetSize = Math.min(size, 256);
                              canvas.width = targetSize;
                              canvas.height = targetSize;
                              const ctx = canvas.getContext("2d");
                              if (!ctx) return;
                              
                              const startX = (img.width - size) / 2;
                              const startY = (img.height - size) / 2;
                              
                              ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);
                              const base64 = canvas.toDataURL("image/png");
                              setForm({ ...form, branding: { ...form.branding, logo_url: base64 } });
                            };
                            img.src = event.target?.result as string;
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Select an image from your device. It will be embedded directly into the .aivra package for offline use.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label>Printer type</Label>
                  <Select
                    value={form.hardware_config.printer}
                    onValueChange={(v) =>
                      setForm({ ...form, hardware_config: { ...form.hardware_config, printer: v } })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="thermal_80mm">Thermal 80mm</SelectItem>
                      <SelectItem value="thermal_58mm">Thermal 58mm</SelectItem>
                      <SelectItem value="network_kitchen">Network Kitchen Printer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-6 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <Checkbox
                      checked={form.hardware_config.barcode_scanner}
                      onCheckedChange={(c) =>
                        setForm({
                          ...form,
                          hardware_config: { ...form.hardware_config, barcode_scanner: c === true },
                        })
                      }
                    />
                    Barcode Scanner
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <Checkbox
                      checked={form.hardware_config.cash_drawer}
                      onCheckedChange={(c) =>
                        setForm({
                          ...form,
                          hardware_config: { ...form.hardware_config, cash_drawer: c === true },
                        })
                      }
                    />
                    Cash Drawer (RJ11)
                  </label>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="grid gap-4 text-sm">
                <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-y-2">
                    <div className="text-muted-foreground">Project</div>
                    <div className="font-medium">{form.name}</div>

                    <div className="text-muted-foreground">Slug</div>
                    <div className="font-mono">{form.slug}</div>

                    <div className="text-muted-foreground">Client</div>
                    <div className="font-medium">
                      {clients.find((c: any) => c.id === form.client_id)?.name}
                    </div>

                    <div className="text-muted-foreground">Template</div>
                    <div className="font-medium">{selectedTemplate?.name}</div>

                    <div className="text-muted-foreground">Active Modules</div>
                    <div className="font-medium">
                      {Object.keys(form.modules_config)
                        .filter((k) => form.modules_config[k])
                        .map((k) => k.replace("_", " "))
                        .join(", ") || "None"}
                    </div>

                    <div className="text-muted-foreground">Primary Color</div>
                    <div className="font-medium flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full shadow-sm border"
                        style={{ backgroundColor: form.branding.primary_color }}
                      />
                      {form.branding.primary_color}
                    </div>

                    <div className="text-muted-foreground">Store Logo</div>
                    <div className="font-medium">
                      {form.branding.logo_url ? (
                        <img 
                          src={form.branding.logo_url} 
                          alt="Logo" 
                          className="h-8 w-8 rounded bg-muted object-cover border"
                        />
                      ) : (
                        "None"
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label>Internal notes</Label>
                  <Textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center sm:justify-between border-t pt-4">
            <Button
              variant="outline"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => save(false)}>
                    Save Draft
                  </Button>
                  <Button onClick={() => save(true)}>
                    Mark Ready
                  </Button>
                </div>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
