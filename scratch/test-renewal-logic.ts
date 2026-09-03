import { calculateRenewalDates, LicenseBillingState } from "../src/lib/billing";
import { deriveBillingStatus, deriveOperationalStatus } from "../src/lib/status";
import PDFDocument from "pdfkit";
import fs from "fs";
import { startOfDay } from "date-fns";

async function runTest() {
  console.log("=== RUNNING RENEWAL LOGIC TESTS ===");

  // Mock license state
  const license: any = {
    id: "test-license-1",
    status: "active",
    expires_at: new Date("2026-09-01T00:00:00Z"),
    grace_until: new Date("2026-09-03T00:00:00Z"),
    billing: {
      enabled: true,
      cycle: "monthly",
      amount: 1500,
      currency: "PKR",
      grace_days: 2
    }
  };

  // Mock settled period (e.g. they paid the Sep 1 - Oct 1 period)
  const settledPeriodEnd = new Date("2026-10-01T00:00:00Z");

  const result = calculateRenewalDates(license, settledPeriodEnd);

  console.log("Expected New Expiry: 2026-10-01");
  console.log("Actual New Expiry:  ", result.newExpiry.toISOString().split("T")[0]);

  const expectedGrace = new Date("2026-10-03T00:00:00Z");
  console.log("Expected Grace:    ", expectedGrace.toISOString().split("T")[0]);
  console.log("Actual Grace:      ", result.newGraceUntil.toISOString().split("T")[0]);

  // Test Billing Status logic
  // Case: They paid, so the next period is for Oct 1 - Nov 1, which is unpaid but due in the future
  const currentPeriod = {
    status: "unpaid",
    due_at: new Date("2026-10-01T00:00:00Z"),
  };

  // Assume today is 2026-09-03 (using a mock date inside deriveBillingStatus isn't easy without injecting Date, but we can verify our daysDiff logic manually)
  const billingStatus = deriveBillingStatus(license, currentPeriod, true);
  console.log("Billing Status for future unpaid period:", billingStatus);
  
  if (billingStatus !== "Paid" && billingStatus !== "Not Due Yet") {
    console.error("FAIL: Future unpaid period should be marked as Paid or Not Due Yet.");
  } else {
    console.log("SUCCESS: Billing Status logic correctly handles future periods.");
  }

  // Test PDF generation
  console.log("\n=== RUNNING PDF GENERATION TEST ===");
  try {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: any[] = [];
    
    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(20).text("Test Invoice", { align: "center" });
    doc.end();

    const buffer = await pdfPromise;
    console.log(`SUCCESS: PDF generated in memory, size: ${buffer.length} bytes`);
    fs.writeFileSync("scratch/test.pdf", buffer);
    console.log("Saved test PDF to scratch/test.pdf");
  } catch (err: any) {
    console.error("FAIL: PDF generation threw an error", err);
  }
}

runTest();
