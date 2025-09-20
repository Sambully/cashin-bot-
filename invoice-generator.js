import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Cloudinary (using same config as main bot)
cloudinary.config({
    cloud_name: 'dzdn1ny95',
    api_key: '343133224449982',
    api_secret: '5nAoz8rh0MxCb3vvstLP9bKyTFg'
});

// Database file path for invoices
const INVOICES_DB_PATH = path.join(__dirname, 'invoices_db.json');

// Initialize invoices database
function initializeInvoicesDatabase() {
    if (!fs.existsSync(INVOICES_DB_PATH)) {
        fs.writeFileSync(INVOICES_DB_PATH, JSON.stringify({ invoices: [] }, null, 2));
    }
}

// Load invoices database
function loadInvoicesDatabase() {
    try {
        initializeInvoicesDatabase();
        const data = fs.readFileSync(INVOICES_DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading invoices database:', error);
        return { invoices: [] };
    }
}

// Save to invoices database
function saveInvoicesDatabase(data) {
    try {
        fs.writeFileSync(INVOICES_DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving invoices database:', error);
        return false;
    }
}

// Generate HTML content for invoice
function generateInvoiceHTML(invoiceData) {
    const {
        invoiceNumber,
        txnid,
        userId,
        username,
        email,
        amount,
        originalAmount,
        serviceCharge,
        finalAmount,
        status,
        createdAt,
        updatedAt,
        webhookData,
        verificationMethod,
        paymentLink
    } = invoiceData;

    const currentTime = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const statusClass = status === 'success' ? 'success' : 'failed';
    const statusText = status === 'success' ? 'SUCCESS' : 'FAILED';

    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Invoice - ${invoiceNumber}</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; margin: 24px; color:#111; }
    .invoice { max-width:800px; margin: 0 auto; border: 1px solid #e6e6e6; padding: 20px; border-radius:8px; }
    .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    .brand { font-size:20px; font-weight:700; color:#2563eb; }
    .meta { text-align:right; font-size:14px; color:#333; }
    table { width:100%; border-collapse: collapse; margin-top:14px; }
    th, td { padding:10px 12px; border:1px solid #eaeaea; text-align:left; vertical-align:top; font-size:14px; }
    th { background:#fafafa; font-weight:600; }
    .section-title { margin-top:18px; font-weight:700; color:#222; }
    .small { font-size:13px; color:#555; }
    .status { display:inline-block; padding:6px 10px; border-radius:6px; font-weight:600; }
    .status.success { background:#e6f7ed; color:#116a2b; border:1px solid #c7f0d2; }
    .status.failed { background:#fff0f0; color:#9b2a2a; border:1px solid #f5c6c6; }
    .right { text-align:right; }
    .logo { width: 60px; height: 60px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px; }
    .company-info { display: flex; align-items: center; gap: 15px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center; color: #666; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div class="company-info">
        <div class="logo">CB</div>
        <div>
          <div class="brand">CashIn Bot</div>
          <div class="small">Voucher Purchase Invoice</div>
        </div>
      </div>
      <div class="meta">
        <div>Invoice #: <strong>${invoiceNumber}</strong></div>
        <div>Txn ID: <strong>${txnid}</strong></div>
        <div>Created: <strong>${new Date(createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</strong></div>
        <div class="small">Updated: ${new Date(updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
      </div>
    </div>

    <div>
      <span class="section-title">Payment Status</span>
      <div style="margin-top:8px;">
        <span class="status ${statusClass}">${statusText}</span>
        ${paymentLink ? `&nbsp;&nbsp; Payment Link: <a href="${paymentLink}" target="_blank">View Link</a>` : ''}
      </div>
    </div>

    <div class="section-title">Customer & Order Details</div>
    <table>
      <tr>
        <th>Customer Email</th>
        <td>${email}</td>
        <th>User ID</th>
        <td>${userId}</td>
      </tr>
      <tr>
        <th>Username</th>
        <td>${username || 'N/A'}</td>
        <th>Voucher Amount</th>
        <td>₹ ${originalAmount}</td>
      </tr>
      <tr>
        <th>Service Charge (5%)</th>
        <td>₹ ${serviceCharge}</td>
        <th>Total Amount Paid</th>
        <td><strong>₹ ${finalAmount}</strong></td>
      </tr>
      <tr>
        <th>Verification Method</th>
        <td>${verificationMethod}</td>
        <th>Payment Source</th>
        <td>apiIntInvoice</td>
      </tr>
    </table>

    ${webhookData ? `
    <div class="section-title">Payment Gateway Details</div>
    <table>
      <tr>
        <th>Gateway Payment ID</th>
        <td>${webhookData.mihpayid || 'N/A'}</td>
        <th>Gateway Txn ID</th>
        <td>${webhookData.txnid || 'N/A'}</td>
      </tr>
      <tr>
        <th>Payment Mode</th>
        <td>${webhookData.mode || 'N/A'}</td>
        <th>PG Type</th>
        <td>${webhookData.PG_TYPE || 'N/A'}</td>
      </tr>
      <tr>
        <th>Bank Ref No</th>
        <td>${webhookData.bank_ref_no || 'N/A'}</td>
        <th>Bank Code</th>
        <td>${webhookData.field8 || 'N/A'}</td>
      </tr>
      <tr>
        <th>Product Info</th>
        <td colspan="3">${webhookData.productinfo || 'Payment link for voucher'}</td>
      </tr>
      <tr>
        <th>Phone</th>
        <td>${webhookData.phone || 'N/A'}</td>
        <th>Net Amount Debit</th>
        <td>₹ ${webhookData.net_amount_debit || finalAmount}</td>
      </tr>
      <tr>
        <th>Error Code</th>
        <td>${webhookData.error || 'N/A'}</td>
        <th>Error Message</th>
        <td>${webhookData.error_Message || 'N/A'}</td>
      </tr>
    </table>
    ` : ''}

    <div style="margin-top:18px; display:flex; justify-content:space-between; align-items:center;">
      <div class="small">Invoice generated automatically by CashIn Bot system.</div>
      <div class="right">
        <div style="font-size:16px; font-weight:700;">Total Paid: ₹ ${finalAmount}</div>
        <div style="font-size:14px; color:#666;">Voucher Value: ₹ ${originalAmount}</div>
      </div>
    </div>

    <div class="footer">
      <div class="small">
        <strong>CashIn Bot</strong> - Automated Voucher Purchase System<br>
        Generated on: ${currentTime}<br>
        For support, contact: @bot_querry on Telegram
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Upload PDF to Cloudinary
async function uploadPDFToCloudinary(pdfBuffer, fileName) {
    try {
        return new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    resource_type: 'raw',
                    public_id: fileName,
                    folder: 'cashinbot_invoices',
                    format: 'pdf'
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result.secure_url);
                    }
                }
            ).end(pdfBuffer);
        });
    } catch (error) {
        console.error('Cloudinary PDF upload error:', error);
        throw error;
    }
}

// Generate PDF invoice
async function generateInvoicePDF(invoiceData) {
    try {
        console.log(`🔄 Starting PDF generation for invoice: ${invoiceData.invoiceNumber}`);
        
        // Initialize database
        initializeInvoicesDatabase();

        // Generate HTML content
        const htmlContent = generateInvoiceHTML(invoiceData);

        // Launch Puppeteer
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Set content and generate PDF
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });

        await browser.close();
        console.log('✅ PDF generated successfully');

        // Upload to Cloudinary
        const fileName = `invoice_${invoiceData.invoiceNumber}_${Date.now()}`;
        const pdfUrl = await uploadPDFToCloudinary(pdfBuffer, fileName);
        console.log(`✅ PDF uploaded to Cloudinary: ${pdfUrl}`);

        // Save to database
        const invoiceRecord = {
            id: invoiceData.invoiceNumber,
            txnid: invoiceData.txnid,
            userId: invoiceData.userId,
            username: invoiceData.username,
            email: invoiceData.email,
            amount: invoiceData.amount,
            originalAmount: invoiceData.originalAmount,
            serviceCharge: invoiceData.serviceCharge,
            finalAmount: invoiceData.finalAmount,
            status: invoiceData.status,
            pdfUrl: pdfUrl,
            fileName: fileName,
            createdAt: invoiceData.createdAt,
            updatedAt: invoiceData.updatedAt,
            generatedAt: new Date().toISOString(),
            webhookData: invoiceData.webhookData,
            verificationMethod: invoiceData.verificationMethod,
            paymentLink: invoiceData.paymentLink
        };

        const db = loadInvoicesDatabase();
        db.invoices.push(invoiceRecord);
        saveInvoicesDatabase(db);
        console.log('✅ Invoice record saved to database');

        return {
            success: true,
            pdfUrl: pdfUrl,
            pdfBuffer: pdfBuffer, // Return the buffer for direct Telegram sending
            fileName: fileName,
            invoiceRecord: invoiceRecord
        };

    } catch (error) {
        console.error('❌ Error generating invoice PDF:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get invoice by transaction ID
function getInvoiceByTxnId(txnid) {
    try {
        const invoicesDB = loadInvoicesDatabase();
        return invoicesDB.invoices.find(invoice => 
            invoice.txnid === txnid || 
            invoice.invoiceNumber === txnid ||
            invoice.webhookData?.txnid === txnid
        );
    } catch (error) {
        console.error('Error getting invoice:', error);
        return null;
    }
}

// Get all invoices for a user
function getUserInvoices(userId) {
    try {
        const invoicesDB = loadInvoicesDatabase();
        return invoicesDB.invoices.filter(invoice => invoice.userId === userId);
    } catch (error) {
        console.error('Error getting user invoices:', error);
        return [];
    }
}

export {
    generateInvoicePDF,
    getInvoiceByTxnId,
    getUserInvoices,
    loadInvoicesDatabase,
    saveInvoicesDatabase
};