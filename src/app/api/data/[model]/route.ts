import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import BusinessTemplate from "@/models/BusinessTemplate";
import ClientTemplate from "@/models/ClientTemplate";
import Client from "@/models/Client";
import LicenseSeat from "@/models/LicenseSeat";
import License from "@/models/License";
import Package from "@/models/Package";
import Profile from "@/models/Profile";
import Project from "@/models/Project";
import ReleaseInstall from "@/models/ReleaseInstall";
import Release from "@/models/Release";
import UserRole from "@/models/UserRole";

const modelsMap: Record<string, any> = {
  "audit_logs": AuditLog,
  "business_templates": BusinessTemplate,
  "client_templates": ClientTemplate,
  "clients": Client,
  "license_seats": LicenseSeat,
  "licenses": License,
  "packages": Package,
  "profiles": Profile,
  "projects": Project,
  "release_installs": ReleaseInstall,
  "releases": Release,
  "user_roles": UserRole,
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  const searchParams = req.nextUrl.searchParams;
  let query: any = {};
  
  // Basic query mapping (e.g. ?client_id=123)
  searchParams.forEach((value, key) => {
    if (key !== "limit" && key !== "sort" && key !== "select" && key !== "populate") {
      query[key] = value;
    }
  });

  const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit") as string, 10) : 0;
  const populateParams = searchParams.get("populate");
  
  try {
    let mQuery = Model.find(query).limit(limit);
    if (populateParams) {
      const paths = populateParams.split(",");
      paths.forEach(p => { mQuery = mQuery.populate(p.trim()); });
    }
    const data = await mQuery.lean();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const body = await req.json();
    const newData = await Model.create(body);
    return NextResponse.json(newData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const body = await req.json();
    const id = req.nextUrl.searchParams.get("id");
    
    if (!id) return NextResponse.json({ error: "ID required for PATCH" }, { status: 400 });
    
    const updatedData = await Model.findOneAndUpdate({ id }, body, { new: true }).lean();
    return NextResponse.json(updatedData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { model } = await params;
  const Model = modelsMap[model];
  if (!Model) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await connectToDatabase();
  
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID required for DELETE" }, { status: 400 });
    
    await Model.findOneAndDelete({ id });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
