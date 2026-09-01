const nodemailer = require("nodemailer");

async function test() {
  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: "aa952f001@smtp-brevo.com",
      pass: "xsmtpsib-c331090eda6a86b9b205a3e6455362249f22323e6c52eaa9c1e259ccf2ebfcb9-d7pD1gjJkpb15Cwh",
    },
  });

  try {
    console.log("Sending...");
    const info = await transporter.sendMail({
      from: { name: "Test Sender", address: "aivrasol@gmail.com" },
      to: "aivrasol@gmail.com",
      subject: "Test Email from Script",
      text: "This is a test email.",
    });
    console.log("Success! Info:", info);
  } catch (error) {
    console.error("Error:", error);
  }
}

test();
