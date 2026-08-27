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
    .header img { max-height: 48px; display: block; margin: 0 auto; }
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
