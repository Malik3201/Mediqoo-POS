import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import License from "@/models/License";
import Client from "@/models/Client";
import RenewalNotification from "@/models/RenewalNotification";
import LicenseBillingPeriod from "@/models/LicenseBillingPeriod";
import { sendAdminRenewalReminder, sendClientRenewalReminder } from "@/lib/email";
import { differenceInDays, startOfDay, subMonths, subYears } from "date-fns";

export async function GET(req: Request) {
  // Protect with cron secret if provided
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  const now = startOfDay(new Date());
  
  // Find all active, billing-enabled licenses
  const licenses = await License.find({
    status: "active",
    "billing.enabled": true
  }).lean();

  let sentCount = 0;
  let errors: any[] = [];

  for (const license of licenses) {
    try {
      if (!license.expires_at) continue;

      const expiry = startOfDay(new Date(license.expires_at));
      const daysUntilExpiry = differenceInDays(expiry, now);
      
      const reminderDays = license.billing?.reminder_days || [1];

      // 1. Send Reminders if it matches the schedule
      if (reminderDays.includes(daysUntilExpiry)) {
        const client = await Client.findOne({ id: license.client_id }).lean();
        
        // Attempt Admin Notification
        const adminNotif = await RenewalNotification.findOneAndUpdate(
          {
            license_id: license.id,
            expiry_date: expiry,
            reminder_day: daysUntilExpiry,
            recipient_type: "admin",
            status: { $nin: ["sending", "sent"] } // Reserve it
          },
          { $set: { status: "sending" } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (adminNotif?.status === "sending") {
          try {
            await sendAdminRenewalReminder(
              client?.name || "Unknown Client",
              license.license_key,
              license.billing!.amount,
              license.billing!.currency,
              expiry
            );
            await RenewalNotification.updateOne({ _id: adminNotif._id }, { $set: { status: "sent", sent_at: new Date() } });
            sentCount++;
          } catch (e: any) {
            await RenewalNotification.updateOne({ _id: adminNotif._id }, { $set: { status: "failed", last_error: e.message }, $inc: { attempt_count: 1 } });
          }
        }

        // Attempt Client Notification
        if (client?.contact_email) {
          const clientNotif = await RenewalNotification.findOneAndUpdate(
            {
              license_id: license.id,
              expiry_date: expiry,
              reminder_day: daysUntilExpiry,
              recipient_type: "client",
              status: { $nin: ["sending", "sent"] }
            },
            { $set: { status: "sending" } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          if (clientNotif?.status === "sending") {
            try {
              await sendClientRenewalReminder(
                client.contact_name || "",
                client.contact_email,
                client.name,
                license.billing!.amount,
                license.billing!.currency,
                expiry
              );
              await RenewalNotification.updateOne({ _id: clientNotif._id }, { $set: { status: "sent", sent_at: new Date() } });
              sentCount++;
            } catch (e: any) {
              await RenewalNotification.updateOne({ _id: clientNotif._id }, { $set: { status: "failed", last_error: e.message }, $inc: { attempt_count: 1 } });
            }
          }
        }
      }

      // 2. Proactively generate missing Billing Periods
      // If we are within the current billing cycle, ensure a LicenseBillingPeriod exists.
      const existingPeriod = await LicenseBillingPeriod.findOne({
        license_id: license.id,
        due_at: license.expires_at
      });

      if (!existingPeriod) {
        // Find if they paid historically to know the previous boundary,
        // or default to current expires_at.
        // For simplicity in cron, we just ensure the upcoming expiry has a ledger entry.
        
        const pStart = license.billing?.cycle === "yearly" ? subYears(license.expires_at, 1) : subMonths(license.expires_at, 1);
        
        try {
          await LicenseBillingPeriod.create({
            client_id: license.client_id,
            license_id: license.id,
            period_start: pStart,
            period_end: license.expires_at,
            due_at: license.expires_at,
            amount_due: license.billing!.amount,
            currency: license.billing!.currency,
            status: "unpaid"
          });
        } catch (err: any) {
           if (err.code !== 11000) throw err; // Ignore duplicate generation
        }
      }

    } catch (e: any) {
      if (e.code === 11000) {
        // Idempotency hit during notification reservation, ignore
      } else {
        errors.push({ license_id: license.id, error: e.message });
      }
    }
  }

  return NextResponse.json({
    success: true,
    sent_reminders: sentCount,
    errors: errors.length > 0 ? errors : undefined
  });
}
