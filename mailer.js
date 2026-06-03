'use strict';

const nodemailer = require('nodemailer');

// Transport SMTP đọc từ env. Thiếu cấu hình → trả null (chế độ dev: log mã ra console).
function getTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = SSL, còn lại STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Gửi mã xác minh tới email seller.
// Trả { sent }. Chưa cấu hình SMTP → sent=false và log mã ra console để vẫn test được.
async function sendVerificationEmail(to, code) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[MAIL] (chưa cấu hình SMTP) mã xác minh cho ${to}: \x1b[36m${code}\x1b[0m`);
    return { sent: false };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({
    from,
    to,
    subject: 'Mã xác minh tài khoản Seller',
    text: `Mã xác minh của bạn là: ${code} (hết hạn sau 15 phút).`,
    html: `<p>Mã xác minh tài khoản Seller của bạn là:</p>
           <p style="font-size:1.6rem;font-weight:800;letter-spacing:4px">${code}</p>
           <p style="color:#888">Mã hết hạn sau 15 phút.</p>`,
  });
  return { sent: true };
}

module.exports = { sendVerificationEmail };
