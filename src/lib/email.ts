import nodemailer from "nodemailer";

const LOGO_URL = "https://plain-eeur-prod-public.komododecks.com/202608/27/GmrnozHZRElvE1sywOKi/image.png";

// Create a transporter using environment variables
const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const FROM_EMAIL = process.env.SMTP_FROM || 'support@aivrasol.com';
const FROM_OBJECT = {
  name: "AivraSol Support",
  address: FROM_EMAIL,
};
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@aivrasol.com";

/**
 * Base HTML Template wrapper for consistent styling
 */
const baseTemplate = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 40px 20px; color: #1e293b; }
    .container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); }
    .header { background-color: #ffffff; padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #f1f5f9; border-top: 5px solid #009A4D; }
    .header img { max-height: 80px; display: block; margin: 0 auto; }
    .content { padding: 40px 32px; font-size: 16px; line-height: 1.6; color: #334155; }
    .footer { background-color: #f8fafc; padding: 32px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
    .footer p { margin: 8px 0; }
    h1 { color: #0f172a; font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 24px; letter-spacing: -0.02em; }
    h2 { color: #009A4D; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px; }
    p { margin-top: 0; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #009A4D; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 24px; transition: background-color 0.2s; }
    .quote { background-color: #f1f5f9; border-left: 4px solid #009A4D; padding: 20px; margin: 24px 0; border-radius: 0 8px 8px 0; font-style: italic; color: #475569; font-size: 15px; }
    strong { color: #0f172a; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="AivraSol Logo" />
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} AivraSol POS. All rights reserved.</p>
      <p>This email was sent automatically. Please do not reply directly to this message.</p>
    </div>
  </div>
</body>
</html>
`;

/**
 * Send auto-reply to user who submitted feedback
 */
export async function sendUserAutoReply(name: string, email: string, type: "issue" | "suggestion") {
  const subject = type === "issue" 
    ? "We've received your issue report - AivraSol" 
    : "Thank you for your suggestion! - AivraSol";

  const content = type === "issue" 
    ? `
      <h1>Hello ${name},</h1>
      <p>Thank you for reaching out to us. We have received your bug/issue report.</p>
      <p>Our technical team is reviewing the details and will get back to you shortly if we need more information or once the issue is resolved.</p>
      <p>We appreciate your patience while we work on providing you the best experience possible with AivraSol POS.</p>
      <p>Best regards,<br>The AivraSol Team</p>
    `
    : `
      <h1>Hello ${name},</h1>
      <p>Thank you for sharing your suggestion with us!</p>
      <p>We're constantly looking for ways to improve AivraSol POS, and feedback from users like you is incredibly valuable. Our product team will review your idea for future updates.</p>
      <p>If we have any questions, we'll be sure to reach out. Thanks again for helping us build a better product.</p>
      <p>Best regards,<br>The AivraSol Team</p>
    `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: email,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send user auto-reply", err);
  }
}

/**
 * Send alert to Admin for new feedback
 */
export async function sendAdminAlert(name: string, email: string, type: "issue" | "suggestion", description: string) {
  const subject = `New ${type === "issue" ? "Issue" : "Suggestion"} from ${name}`;
  
  const content = `
    <h2>New Feedback Submitted</h2>
    <p><strong>User:</strong> ${name} (${email})</p>
    <p><strong>Type:</strong> ${type.toUpperCase()}</p>
    <div class="quote">
      ${description}
    </div>
    <p>Please log in to the admin panel to review the full details and take action.</p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: ADMIN_EMAIL,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send admin alert", err);
  }
}

/**
 * Quick Action: Send status update to user
 */
export async function sendStatusUpdate(name: string, email: string, action: "analyzing" | "fixing" | "fixed") {
  let subject = "";
  let content = "";

  if (action === "analyzing") {
    subject = "Update: We are analyzing your report - AivraSol";
    content = `
      <h1>Hello ${name},</h1>
      <p>We wanted to give you a quick update regarding your recent report.</p>
      <p>Our engineering team is currently <strong>analyzing</strong> the details you provided. We are working hard to identify the root cause or evaluate your request.</p>
      <p>We will let you know as soon as we make progress.</p>
      <p>Best regards,<br>The AivraSol Team</p>
    `;
  } else if (action === "fixing") {
    subject = "Update: We're working on a fix - AivraSol";
    content = `
      <h1>Hello ${name},</h1>
      <p>Great news! Our engineering team is currently <strong>working on a fix</strong> for the issue you reported.</p>
      <p>We are actively developing and testing the solution. You'll receive another notification once the fix is deployed in our next update.</p>
      <p>Thank you for your patience and for helping us improve.</p>
      <p>Best regards,<br>The AivraSol Team</p>
    `;
  } else if (action === "fixed") {
    subject = "Resolved: Your reported issue is fixed! - AivraSol";
    content = `
      <h1>Hello ${name},</h1>
      <p>We are happy to inform you that the issue you reported has been <strong>fixed</strong>!</p>
      <p>The solution is included in our latest release. Please ensure your POS application is updated to the latest version to apply the fix.</p>
      <p>If you still experience any problems, please don't hesitate to reach out again.</p>
      <p>Best regards,<br>The AivraSol Team</p>
    `;
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: email,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send status update", err);
    throw err;
  }
}

/**
 * Custom Message from Admin
 */
export async function sendCustomMessage(name: string, email: string, customMessage: string) {
  const subject = "Message regarding your feedback - AivraSol";
  
  // Convert newlines to <br> for HTML email
  const formattedMessage = customMessage.replace(/\n/g, "<br>");
  
  const content = `
    <h1>Hello ${name},</h1>
    <p>We are reaching out regarding the feedback you recently submitted to AivraSol.</p>
    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0; color: #334155;">
      ${formattedMessage}
    </div>
    <p>Best regards,<br>The AivraSol Team</p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: email,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send custom message", err);
    throw err;
  }
}

/**
 * Send portal invite email to a pharmacy owner/manager.
 * The raw token is included in the link — only the hash is stored in DB.
 *
 * @param name - portal user's name
 * @param email - portal user's email
 * @param clientName - pharmacy/business name
 * @param inviteUrl - full URL including raw token, e.g. https://mediqoo.vercel.app/portal/accept-invite?token=abc123
 * @param expiresInDays - token validity in days (display only)
 */
export async function sendPortalInvite(
  name: string,
  email: string,
  clientName: string,
  inviteUrl: string,
  expiresInDays: number = 7
) {
  const subject = `You're invited to ${clientName} Owner Portal — AivraSol`;

  const content = `
    <h1>Welcome to AivraSol Owner Portal</h1>
    <p>Hello <strong>${name}</strong>,</p>
    <p>You have been invited to access the <strong>${clientName}</strong> owner portal on AivraSol.</p>
    <p>The portal gives you real-time visibility into your pharmacy's sales, inventory, and financial performance.</p>
    <p>To get started, click the button below to set your password and activate your account:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${inviteUrl}" class="btn" style="display: inline-block; background-color: #009A4D; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Set Password &amp; Activate Account
      </a>
    </div>
    <div class="quote">
      This invitation link expires in <strong>${expiresInDays} days</strong> and can only be used once.
    </div>
    <p>If you did not expect this invitation, please ignore this email. If you have questions, contact your AivraSol administrator.</p>
    <p style="margin-top: 32px;">Best regards,<br><strong>The AivraSol Team</strong></p>
    <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
      If the button above doesn't work, copy and paste this link into your browser:<br>
      <a href="${inviteUrl}" style="color: #009A4D; word-break: break-all;">${inviteUrl}</a>
    </p>
  `;

  const transporter = getTransporter();
  await transporter.sendMail({
    from: FROM_OBJECT,
    to: email,
    subject,
    html: baseTemplate(content),
  });
}

/**
 * Send renewal reminder to Admin.
 */
export async function sendAdminRenewalReminder(
  clientName: string,
  licenseKey: string,
  feeAmount: number,
  currency: string,
  expiryDate: Date
) {
  const subject = `Renewal Due: ${clientName} - AivraSol`;
  const content = `
    <h2>License Renewal Reminder</h2>
    <p>The license for <strong>${clientName}</strong> is approaching its renewal date.</p>
    <ul>
      <li><strong>License Key:</strong> ${licenseKey.substring(0, 16)}...</li>
      <li><strong>Renewal Fee:</strong> ${currency} ${feeAmount}</li>
      <li><strong>Expiry Date:</strong> ${expiryDate.toLocaleDateString()}</li>
    </ul>
    <p>Please coordinate with the client to collect the payment and record it in the admin panel to avoid service interruption.</p>
  `;

  try {
    const transporter = getTransporter();
    const recipient = process.env.RENEWAL_ADMIN_EMAIL || ADMIN_EMAIL;
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: recipient,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send admin renewal reminder", err);
  }
}

/**
 * Send renewal reminder to Client.
 */
export async function sendClientRenewalReminder(
  contactName: string,
  contactEmail: string,
  clientName: string,
  feeAmount: number,
  currency: string,
  expiryDate: Date
) {
  const subject = `Your AivraSol License Renewal is Due`;
  const content = `
    <h1>Hello ${contactName || clientName},</h1>
    <p>This is a friendly reminder that your AivraSol POS subscription for <strong>${clientName}</strong> is due for renewal soon.</p>
    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0; color: #334155;">
      <p><strong>Renewal Amount:</strong> ${currency} ${feeAmount}</p>
      <p><strong>Due Date:</strong> ${expiryDate.toLocaleDateString()}</p>
    </div>
    <p>To ensure uninterrupted service for your POS terminals, please arrange payment before the due date. Contact our support team if you have any questions or need payment instructions.</p>
    <p>Best regards,<br>The AivraSol Team</p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: contactEmail,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send client renewal reminder", err);
    throw err;
  }
}

/**
 * Send payment confirmation and new expiry to Client.
 */
export async function sendClientPaymentConfirmation(
  contactName: string,
  contactEmail: string,
  clientName: string,
  amountPaid: number,
  currency: string,
  newExpiryDate: Date
) {
  const subject = `Payment Confirmation - AivraSol`;
  const content = `
    <h1>Hello ${contactName || clientName},</h1>
    <p>Thank you! We have successfully received your payment for the AivraSol POS subscription.</p>
    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0; color: #334155;">
      <p><strong>Amount Paid:</strong> ${currency} ${amountPaid}</p>
      <p><strong>New Expiry Date:</strong> ${newExpiryDate.toLocaleDateString()}</p>
    </div>
    <p>Your POS terminals will automatically synchronize this updated subscription within the next few hours.</p>
    <p>Best regards,<br>The AivraSol Team</p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: contactEmail,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send client payment confirmation", err);
    throw err;
  }
}

/**
 * Generate a PDF Payment Receipt and send it.
 * This is used for all payments (both Payment Only and Payment+Renew).
 */
export async function sendPaymentReceipt(paymentId: string) {
  // Dynamically import mongoose models to avoid circular dependencies
  const LicensePayment = (await import("@/models/LicensePayment")).default;
  const License = (await import("@/models/License")).default;
  const PDFDocument = (await import("pdfkit")).default;

  const payment = await LicensePayment.findById(paymentId).lean();
  if (!payment) throw new Error("Payment not found");

  const license = await License.findOne({ id: payment.license_id }).lean();
  if (!license) throw new Error("License not found");

  const clientName = license.client_snapshot?.name || "Client";
  const contactName = license.client_snapshot?.contact_name || "";
  const contactEmail = license.client_snapshot?.email || "";
  const phone = license.client_snapshot?.phone || "";

  // Generate PDF
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks: Buffer[] = [];
  
  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // --- PDF Layout (Professional SaaS Receipt) ---
  // Header
  doc.fillColor("#009A4D").fontSize(28).text("AIVRASOL", { align: "left" });
  doc.fillColor("#64748B").fontSize(10).text("Pharmacy POS", { align: "left" });
  
  doc.moveUp(2);
  doc.fillColor("#0F172A").fontSize(20).text("Payment Receipt", { align: "right" });
  doc.fillColor("#64748B").fontSize(10).text(`Receipt No: ${payment.receipt_number || payment.id}`, { align: "right" });
  doc.text(`Payment Date: ${new Date(payment.paid_at).toLocaleDateString()}`, { align: "right" });
  
  doc.moveDown(3);

  // Billed To
  doc.fillColor("#0F172A").fontSize(12).text("BILLED TO", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(clientName);
  if (contactName) doc.text(`Owner: ${contactName}`);
  if (phone) doc.text(`Phone: ${phone}`);
  if (contactEmail) doc.text(`Email: ${contactEmail}`);
  
  doc.moveDown(2);

  // Subscription Details
  const isPerInvoice = license.billing?.model === "per_invoice";
  doc.fillColor("#0F172A").fontSize(12).text("SUBSCRIPTION", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(`Plan: ${isPerInvoice ? "Pay Per Invoice" : "Fixed Subscription"}`);
  if (isPerInvoice && payment.rate_snapshot) {
    doc.text(`Rate: ${payment.currency} ${payment.rate_snapshot} / invoice`);
  }
  
  doc.moveDown(2);

  // Billing Summary
  doc.fillColor("#0F172A").fontSize(12).text("BILLING SUMMARY", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  if (isPerInvoice) {
    doc.text(`Billable Invoices (Snapshot): ${payment.usage_count_snapshot || 0}`);
    doc.text(`Usage Charges (Snapshot): ${payment.currency} ${payment.usage_amount_snapshot || 0}`);
  }
  doc.text(`Previous Outstanding: ${payment.currency} ${payment.outstanding_before || 0}`);
  doc.fillColor("#009A4D").text(`Amount Paid: ${payment.currency} ${payment.amount_paid}`);
  doc.fillColor("#334155").text(`Outstanding After Payment: ${payment.currency} ${payment.outstanding_after || 0}`);
  
  doc.moveDown(2);

  // Payment Details
  doc.fillColor("#0F172A").fontSize(12).text("PAYMENT DETAILS", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  doc.text(`Method: ${payment.payment_method || "N/A"}`);
  if (payment.payment_reference) doc.text(`Reference: ${payment.payment_reference}`);
  if (payment.recorded_by) doc.text(`Recorded By: ${payment.recorded_by}`);

  doc.moveDown(2);

  // License Info
  doc.fillColor("#0F172A").fontSize(12).text("LICENSE INFORMATION", { underline: true });
  doc.fontSize(10).fillColor("#334155");
  if (payment.action === "payment_only") {
    doc.text(`Current Expiry: ${new Date(license.expires_at).toLocaleDateString()}`);
    doc.fillColor("#64748B").text("License expiry is unchanged by this payment.");
  } else {
    doc.text(`Renewed Until: ${new Date(license.expires_at).toLocaleDateString()}`);
  }

  // Footer
  doc.moveDown(4);
  doc.fillColor("#64748B").fontSize(9).text("Thank you for choosing AivraSol.", { align: "center" });
  doc.text("support@aivrasol.com | www.aivrasol.com", { align: "center" });

  doc.end();

  const pdfBuffer = await pdfPromise;

  // Now send the email
  const subject = `AivraSol Payment Receipt - ${payment.currency} ${payment.amount_paid} Received`;
  const content = `
    <h1>Hello ${contactName || clientName},</h1>
    <p>We have successfully received your payment for the AivraSol POS subscription.</p>
    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0; color: #334155;">
      <p><strong>Amount Paid:</strong> ${payment.currency} ${payment.amount_paid}</p>
      <p><strong>Payment Date:</strong> ${new Date(payment.paid_at).toLocaleDateString()}</p>
      <p><strong>Current Outstanding:</strong> ${payment.currency} ${payment.outstanding_after || 0}</p>
    </div>
    <p>Please find your detailed professional PDF receipt attached to this email.</p>
    <p>Best regards,<br>The AivraSol Team</p>
  `;

  if (!contactEmail) {
    console.warn(`Cannot email receipt for payment ${payment.id}, no client email.`);
    return;
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: FROM_OBJECT,
      to: contactEmail,
      subject,
      html: baseTemplate(content),
      attachments: [
        {
          filename: `AivraSol-Receipt-${payment.receipt_number || payment.id}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    // Update status safely
    await LicensePayment.updateOne(
      { _id: payment._id }, 
      { $set: { email_status: "sent", email_sent_at: new Date() } }
    );
  } catch (err: any) {
    console.error("Failed to send client payment receipt", err);
    await LicensePayment.updateOne(
      { _id: payment._id }, 
      { $set: { email_status: "failed", email_error: err.message?.substring(0, 200) } }
    );
    throw err;
  }
}


