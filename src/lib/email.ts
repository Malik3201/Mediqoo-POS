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

const FROM_EMAIL = process.env.SMTP_FROM || '"AivraSol Support" <support@aivrasol.com>';
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
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f9fafa; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #eaeaea; }
    .header { background-color: #009A4D; padding: 24px; text-align: center; }
    .header img { max-height: 40px; }
    .content { padding: 32px; color: #333333; line-height: 1.6; }
    .footer { background-color: #f1f5f9; padding: 24px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #eaeaea; }
    h1 { color: #1e293b; font-size: 24px; margin-top: 0; }
    h2 { color: #009A4D; font-size: 20px; }
    .btn { display: inline-block; background-color: #009A4D; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 16px; }
    .quote { background-color: #f8fafc; border-left: 4px solid #009A4D; padding: 16px; margin: 20px 0; font-style: italic; color: #475569; }
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
      <p>This is an automated message, please do not reply directly to this email.</p>
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
      from: FROM_EMAIL,
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
      from: FROM_EMAIL,
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
      from: FROM_EMAIL,
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
      from: FROM_EMAIL,
      to: email,
      subject,
      html: baseTemplate(content),
    });
  } catch (err) {
    console.error("Failed to send custom message", err);
    throw err;
  }
}
