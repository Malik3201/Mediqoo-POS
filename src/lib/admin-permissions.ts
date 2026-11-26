export interface AdminPermissionDef {
  key: string;
  label: string;
  description: string;
  group: "Operations" | "Commerce & Media" | "Administration";
}

export const ADMIN_PERMISSIONS: AdminPermissionDef[] = [
  {
    key: "clients",
    label: "Clients Management",
    description: "Create, edit, and manage pharmacy clients",
    group: "Operations",
  },
  {
    key: "projects",
    label: "Projects Management",
    description: "Create and configure pharmacy POS projects",
    group: "Operations",
  },
  {
    key: "licenses",
    label: "Licenses & Extensions",
    description: "Issue, renew, extend, suspend, or revoke licenses",
    group: "Operations",
  },
  {
    key: "quick_trial",
    label: "Quick 3-Day Trials",
    description: "Instantly issue and extend 3-day trial licenses & .aivra files",
    group: "Operations",
  },
  {
    key: "packages",
    label: "Packages (.aivra)",
    description: "Generate signed .aivra installation packages",
    group: "Operations",
  },
  {
    key: "billing",
    label: "Billing & Renewals",
    description: "Record payments, vouchers, and billing cycles",
    group: "Operations",
  },
  {
    key: "websites",
    label: "Pharmacy Websites",
    description: "Manage pharmacy online storefronts and QR posters",
    group: "Commerce & Media",
  },
  {
    key: "central_images",
    label: "Central Image Library",
    description: "Upload, browse, and approve shared medicine photos",
    group: "Commerce & Media",
  },
  {
    key: "releases",
    label: "Releases & Updates",
    description: "Publish desktop and mobile POS updates",
    group: "Commerce & Media",
  },
  {
    key: "ai_management",
    label: "AI Management",
    description: "Configure Groq keys, limits, and Aiva AI quotas",
    group: "Administration",
  },
  {
    key: "audit_view",
    label: "Activity & Audit Logs",
    description: "Inspect administrator activity and audit trails",
    group: "Administration",
  },
  {
    key: "roles_manage",
    label: "Roles & Team Admins",
    description: "Create custom roles and add/manage admin accounts (Super Admin)",
    group: "Administration",
  },
];

export const ALL_PERMISSION_KEYS = ADMIN_PERMISSIONS.map((p) => p.key);

export const SYSTEM_DEFAULT_ROLES = [
  {
    slug: "super_admin",
    name: "Super Admin",
    description: "Full unrestricted access across all modules, roles, team admins, and system security.",
    permissions: ALL_PERMISSION_KEYS,
    is_system: true,
  },
  {
    slug: "admin",
    name: "Admin",
    description: "Day-to-day operational access for clients, projects, licenses, trials, packages, and billing.",
    permissions: [
      "clients",
      "projects",
      "licenses",
      "quick_trial",
      "packages",
      "billing",
      "websites",
      "central_images",
      "audit_view",
    ],
    is_system: true,
  },
];

export function slugifyRoleName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
