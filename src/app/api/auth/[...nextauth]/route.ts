import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import connectToDatabase from "@/lib/db";
import Profile from "@/models/Profile";
import UserRole from "@/models/UserRole";
import AdminRole from "@/models/AdminRole";
import bcrypt from "bcryptjs";
import { ALL_PERMISSION_KEYS, SYSTEM_DEFAULT_ROLES } from "@/lib/admin-permissions";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const inputEmail = credentials.email.trim().toLowerCase();
        const masterEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();

        // 1. Check for master super admin in env
        if (
          masterEmail &&
          process.env.ADMIN_PASSWORD &&
          inputEmail === masterEmail &&
          credentials.password === process.env.ADMIN_PASSWORD
        ) {
          return {
            id: "master-admin",
            name: "Super Admin",
            email: process.env.ADMIN_EMAIL,
            role: "super_admin",
            roleName: "Super Admin",
            isSuperAdmin: true,
            permissions: ALL_PERMISSION_KEYS,
          } as any;
        }

        // 2. Authenticate against MongoDB Admin Profiles
        await connectToDatabase();
        const user: any = await Profile.findOne({ email: inputEmail });

        if (!user || !user.password_hash) {
          throw new Error("User not found");
        }
        if (user.status === "disabled") {
          throw new Error("This administrator account has been disabled.");
        }

        const isMatch = await bcrypt.compare(credentials.password, user.password_hash);
        if (!isMatch) {
          throw new Error("Incorrect password");
        }

        const userRoles: any[] = await UserRole.find({ user_id: user.id }).lean();
        const slugs = userRoles.map((r) => String(r.role || "").trim()).filter(Boolean);
        const isSuperAdmin = slugs.includes("super_admin");
        const roleDocs: any[] = slugs.length
          ? await AdminRole.find({ slug: { $in: slugs } }).lean()
          : [];

        const primarySlug = isSuperAdmin ? "super_admin" : roleDocs[0]?.slug || slugs[0] || "admin";
        const primaryDoc = roleDocs.find((d) => d.slug === primarySlug);
        const permSet = new Set<string>();
        if (isSuperAdmin) {
          ALL_PERMISSION_KEYS.forEach((p) => permSet.add(p));
        } else {
          roleDocs.forEach((rd) => {
            if (Array.isArray(rd.permissions)) rd.permissions.forEach((p: string) => permSet.add(p));
          });
          if (permSet.size === 0 && slugs.includes("admin")) {
            SYSTEM_DEFAULT_ROLES[1].permissions.forEach((p) => permSet.add(p));
          }
        }

        await Profile.updateOne({ id: user.id }, { $set: { last_login_at: new Date() } }).catch(() => {});

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: primarySlug,
          roleName: isSuperAdmin ? "Super Admin" : String(primaryDoc?.name || primarySlug),
          isSuperAdmin,
          permissions: Array.from(permSet),
        } as any;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as any;
        token.id = u.id;
        token.name = u.name;
        token.email = u.email;
        (token as any).role = u.role || "admin";
        (token as any).roleName = u.roleName || "Admin";
        (token as any).isSuperAdmin = Boolean(u.isSuperAdmin);
        (token as any).permissions = Array.isArray(u.permissions) ? u.permissions : [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const su = session.user as any;
        su.id = token.id;
        su.name = token.name || su.name;
        su.role = (token as any).role || (token.id === "master-admin" ? "super_admin" : "admin");
        su.roleName = (token as any).roleName || (token.id === "master-admin" ? "Super Admin" : "Admin");
        su.isSuperAdmin = Boolean((token as any).isSuperAdmin || token.id === "master-admin");
        su.permissions = Array.isArray((token as any).permissions) ? (token as any).permissions : [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth",
  },
});

export { handler as GET, handler as POST };
