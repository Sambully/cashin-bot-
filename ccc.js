import { Telegraf, Markup, Input } from 'telegraf';
import { generatePaymentLink } from './link.js';
import { getPaymentByTxnId, setBotNotificationCallback } from './api.js';
import { sendVoucher, processCashIn, userStates } from './voucher.js';
import { generateInvoicePDF } from './invoice-generator.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import axios from 'axios';

import {
    notifyNewVoucherRequest,
    notifyPaymentSuccessful,
    notifyVoucherDelivered,
    notifyPaymentFailed,
    notifyVoucherDeliveryFailed,
    notifyUserRegistration
} from './buy-admin-bot.js';

import {
    createPayoutRequest,
    setMainBotReference
} from './sell-admin-bot.js';

// Configure Cloudinary
cloudinary.config({
    cloud_name: 'dzdn1ny95', // Replace with your Cloudinary cloud name
    api_key: '343133224449982',       // Replace with your Cloudinary API key
    api_secret: '5nAoz8rh0MxCb3vvstLP9bKyTFg'  // Replace with your Cloudinary API secret
});

// Replace 'YOUR_BOT_TOKEN' with your actual bot token from BotFather
const bot = new Telegraf('7961037186:AAGUH8ts_WzvX9zwIOhimhqqIiq8urTKO4k');

// Set main bot reference for sell admin bot
setMainBotReference(bot);

// Store user sessions
const userSessions = new Map();

// Database file paths
const REGISTERED_USERS_DB = './registered_users_db.json';
const PENDING_APPROVALS_DB = './pending_approvals_db.json';
const INVOICES_DB = './invoices_db.json';
const PENDING_PAYMENTS_DB = './data.json';
const BUY_ADMIN_DB = './buy_admin_db.json';
const SELL_ADMIN_DB = './sell_admin_db.json';

// Initialize database files
function initializeDatabases() {
    if (!fs.existsSync(REGISTERED_USERS_DB)) {
        fs.writeFileSync(REGISTERED_USERS_DB, JSON.stringify({ users: [] }, null, 2));
    }
    if (!fs.existsSync(PENDING_APPROVALS_DB)) {
        fs.writeFileSync(PENDING_APPROVALS_DB, JSON.stringify({ pending: [] }, null, 2));
    }
}

// Load database
function loadDatabase(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading database ${filePath}:`, error);
        return { users: [], pending: [] };
    }
}

// Save database
function saveDatabase(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error saving database ${filePath}:`, error);
    }
}

// Check if user is registered and approved
function isUserRegistered(userId) {
    const db = loadDatabase(REGISTERED_USERS_DB);
    return db.users.find(user => user.userId === userId && user.status === 'approved');
}

// Check if user has pending registration
function hasPendingRegistration(userId) {
    const db = loadDatabase(PENDING_APPROVALS_DB);
    return db.pending.find(user => user.userId === userId);
}

// Get user email from registered users database
function getUserEmail(userId) {
    const db = loadDatabase(REGISTERED_USERS_DB);
    const user = db.users.find(user => user.userId === userId && user.status === 'approved');
    return user ? user.email : null;
}

function getUserPhoneNumber(userId) {
    const db = loadDatabase(REGISTERED_USERS_DB);
    const user = db.users.find(user => user.userId === userId && user.status === 'approved');
    return user ? user.mobile : null;
}

// Upload image to Cloudinary
async function uploadToCloudinary(imageBuffer, fileName) {
    try {
        return new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    resource_type: 'image',
                    public_id: fileName,
                    folder: 'cashinbot_documents'
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result.secure_url);
                    }
                }
            ).end(imageBuffer);
        });
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw error;
    }
}

// Download image from Telegram
async function downloadTelegramImage(fileId) {
    try {
        const fileInfo = await bot.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${fileInfo.file_path}`;

        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (error) {
        console.error('Error downloading image from Telegram:', error);
        throw error;
    }
}

// Function to send payment status update to user
async function sendPaymentStatusToUser(userId, status, txnid, amount = null) {
    try {
        let message;

        if (status === 'success') {
            // Get payment details from database to get original amount and email
            const payment = getPaymentByTxnId(txnid);

            if (payment) {
                try {
                    // Calculate original amount (without service charge)
                    // Service charge is 5%, so original = final / 1.05
                    const finalAmount = payment.amount || amount;
                    const originalAmount = Math.round((finalAmount / 1.05) * 100) / 100;
                    const email = payment.email;

                    console.log(`🎫 Sending voucher for payment ${txnid}:
                    - Final Amount: ₹${finalAmount}
                    - Original Amount: ₹${originalAmount}
                    - Email: ${email}`);

                    // Notify admins about successful payment
                    await notifyPaymentSuccessful(
                        userId,
                        originalAmount,
                        email,
                        payment.id || txnid,
                        txnid,
                        payment.username
                    );

                    // Send initial success message
                    const initialMessage = `✅ Payment Successful!\n\n` +
                        `🎉 Your payment has been completed successfully.\n` +
                        `💰 Amount Paid: ₹${finalAmount}\n` +
                        `🎫 Voucher Amount: ₹${originalAmount}\n` +
                        `📝 Transaction ID: ${txnid}\n\n` +
                        `⏳ Sending voucher to your email...`;

                    await bot.telegram.sendMessage(userId, initialMessage);

                    // Send voucher with original amount
                    const voucherResult = await sendVoucher(originalAmount, email);

                    // Notify admins about successful voucher delivery
                    await notifyVoucherDelivered(
                        userId,
                        originalAmount,
                        email,
                        payment.id || txnid,
                        txnid,
                        payment.username
                    );

                    // Generate and send invoice PDF after successful voucher delivery
                    try {
                        console.log('📄 Generating invoice PDF...');
                        
                        const invoiceData = {
                            invoiceNumber: payment.id || txnid,
                            txnid: txnid,
                            userId: userId,
                            username: payment.username,
                            email: email,
                            amount: finalAmount,
                            originalAmount: originalAmount,
                            serviceCharge: Math.round((finalAmount - originalAmount) * 100) / 100,
                            finalAmount: finalAmount,
                            status: 'success',
                            createdAt: payment.createdAt || new Date().toISOString(),
                            updatedAt: payment.updatedAt || new Date().toISOString(),
                            webhookData: payment.webhookData,
                            verificationMethod: payment.verificationMethod || 'payment_success',
                            paymentLink: payment.paymentLink
                        };

                        const invoiceResult = await generateInvoicePDF(invoiceData);

                        if (invoiceResult.success) {
                            console.log('✅ Invoice PDF generated successfully');

                            // Send invoice PDF to user - save to temp file first
                            try {
                                // Save PDF buffer to temporary file
                                const tempFileName = `temp_invoice_${txnid}_${Date.now()}.pdf`;
                                const tempFilePath = `./${tempFileName}`;
                                
                                fs.writeFileSync(tempFilePath, invoiceResult.pdfBuffer);
                                
                                await bot.telegram.sendDocument(userId, {
                                    source: tempFilePath,
                                    filename: `Invoice_${txnid}.pdf`
                                }, {
                                    caption: `📄 Your Invoice\n\n` +
                                        `Transaction ID: ${txnid}\n` +
                                        `Amount: ₹${finalAmount}\n` +
                                        `Voucher Value: ₹${originalAmount}\n\n` +
                                        `Thank you for using CashIn Bot!`
                                });

                                // Clean up temporary file after successful send
                                try {
                                    fs.unlinkSync(tempFilePath);
                                    console.log(`🗑️ Temporary invoice file deleted: ${tempFileName}`);
                                } catch (deleteError) {
                                    console.error('⚠️ Warning: Could not delete temporary file:', deleteError);
                                }

                                console.log('✅ Invoice PDF sent to user successfully');
                            } catch (telegramError) {
                                console.error('❌ Error sending invoice PDF to user:', telegramError);
                                
                                // Clean up temporary file even if sending failed
                                const tempFileName = `temp_invoice_${txnid}_${Date.now()}.pdf`;
                                const tempFilePath = `./${tempFileName}`;
                                try {
                                    if (fs.existsSync(tempFilePath)) {
                                        fs.unlinkSync(tempFilePath);
                                        console.log(`🗑️ Temporary invoice file deleted after error: ${tempFileName}`);
                                    }
                                } catch (deleteError) {
                                    console.error('⚠️ Warning: Could not delete temporary file after error:', deleteError);
                                }
                                
                                // Fallback: send the Cloudinary URL as a link
                                await bot.telegram.sendMessage(userId, 
                                    `📄 Your Invoice\n\n` +
                                    `Transaction ID: ${txnid}\n` +
                                    `Amount: ₹${finalAmount}\n` +
                                    `Voucher Value: ₹${originalAmount}\n\n` +
                                    `📎 Download Invoice: ${invoiceResult.pdfUrl}\n\n` +
                                    `Thank you for using CashIn Bot!`
                                );
                            }

                            // Send invoice to admins as well
                            await notifyAdminsWithInvoice(userId, invoiceResult.pdfUrl, invoiceData);

                            console.log('✅ Invoice sent to user and admins');
                        } else {
                            console.error('❌ Failed to generate invoice PDF:', invoiceResult.error);
                        }
                    } catch (invoiceError) {
                        console.error('❌ Error generating/sending invoice:', invoiceError);
                        // Don't fail the main flow if invoice generation fails
                    }

                    message = `✅ Payment Successful!\n\n` +
                        `🎉 Your payment has been completed successfully.\n` +
                        `💰 Amount Paid: ₹${finalAmount}\n` +
                        `🎫 Voucher Amount: ₹${originalAmount}\n` +
                        `📝 Transaction ID: ${txnid}\n\n` +
                        `🎁 Voucher has been sent to your email: ${email}\n` +
                        `📧 Please check your inbox for the voucher details.\n` +
                        `📄 Invoice has been sent above.\n\n` +
                        `Thank you for using CashIn Bot!`;

                    console.log(`✅ Voucher sent successfully for payment ${txnid}`);

                } catch (voucherError) {
                    console.error('❌ Error sending voucher:', voucherError);

                    // Notify admins about voucher delivery failure
                    await notifyVoucherDeliveryFailed(
                        userId,
                        originalAmount,
                        email,
                        payment.id || txnid,
                        txnid,
                        voucherError.message,
                        payment.username
                    );

                    message = `✅ Payment Successful!\n\n` +
                        `🎉 Your payment has been completed successfully.\n` +
                        `💰: ₹${amount || 'N/A'}\n` +
                        `📝 Transaction ID: ${txnid}\n\n` +
                        `⚠️ There was an issue sending your voucher.\n` +
                        `Please contact support with your transaction ID.\n\n` +
                        `Thank you for using CashIn Bot!`;
                }
            } else {
                // Fallback if payment not found in database
                message = `✅ Payment Successful!\n\n` +
                    `🎉 Your payment has been completed successfully.\n` +
                    `💰 Amount: ₹${amount || 'N/A'}\n` +
                    `📝 Transaction ID: ${txnid}\n\n` +
                    `🎫 Your voucher is being processed.\n` +
                    `Please contact support if you don't receive it soon.\n\n` +
                    `Thank you for using CashIn Bot!`;
            }
        } else {
            // Get payment details for failed payment notification
            const payment = getPaymentByTxnId(txnid);
            if (payment) {
                const originalAmount = Math.round((payment.amount / 1.05) * 100) / 100;

                // Notify admins about payment failure
                await notifyPaymentFailed(
                    userId,
                    originalAmount,
                    payment.email,
                    payment.id || txnid,
                    txnid,
                    payment.username,
                    payment.webhookData?.error_Message || 'Payment gateway error'
                );
            }

            message = `❌ Payment Failed!\n\n` +
                `😔 Your payment could not be processed.\n` +
                `💰 Amount: ₹${amount || 'N/A'}\n` +
                `📝 Transaction ID: ${txnid}\n\n` +
                `Please try again or contact support.`;
        }

        bot.telegram.sendMessage(userId, message);

        // Clear user session after payment completion
        userSessions.delete(userId);

        console.log(`Payment status sent to user ${userId}: ${status}`);

    } catch (error) {
        console.error('Error sending payment status to user:', error);
    }
}

// Function to notify admins with invoice
async function notifyAdminsWithInvoice(userId, invoicePdfUrl, invoiceData) {
    try {
        // Import the admin notification function
        const { notifyAdminsWithInvoice: notifyAdmins } = await import('./buy-admin-bot.js');
        
        if (notifyAdmins) {
            await notifyAdmins(userId, invoicePdfUrl, invoiceData);
        } else {
            console.log('⚠️ Admin notification function not available');
        }
    } catch (error) {
        console.error('❌ Error notifying admins with invoice:', error);
    }
}

// Register the notification callback with API
setBotNotificationCallback(sendPaymentStatusToUser);

// Initialize databases
initializeDatabases();

// Clean up old temporary files on startup
cleanupOldTempFiles();

bot.start((ctx) => {
    const userId = ctx.from.id;

    // Check if user is already registered and approved
    if (isUserRegistered(userId)) {
        const welcomeMessage = 'Welcome back to CashIn Bot! 🤖\n\nPlease choose an option:';

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('💰 Buy Voucher', 'buy_voucher')],
            [Markup.button.callback('💸 Sell Voucher', 'sell_voucher')]
        ]);

        ctx.reply(welcomeMessage, keyboard);
        return;
    }

    // Check if user has pending registration
    if (hasPendingRegistration(userId)) {
        ctx.reply('⏳ Your registration is under review.\n\nPlease wait 5 minutes for approval.');
        return;
    }

    // New user - start registration process
    const welcomeMessage = 'Welcome to CashIn Bot! 🤖\n\n' +
        'You need to register first to use this bot.\n\n' +
        'Please enter your full name:';

    // Initialize registration session
    userSessions.set(userId, {
        step: 'waiting_name',
        registrationData: {}
    });

    ctx.reply(welcomeMessage);
});

// Buy Voucher button handler
bot.action('buy_voucher', (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id;

    // Check if user is registered
    if (!isUserRegistered(userId)) {
        ctx.reply('❌ You need to register first. Please press /start');
        return;
    }

    // Initialize user session
    userSessions.set(userId, { step: 'waiting_amount' });

    ctx.reply('💰 Please enter the voucher amount (in ₹):');
});

// Sell Voucher button handler
bot.action('sell_voucher', (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id;

    // Check if user is registered
    if (!isUserRegistered(userId)) {
        ctx.reply('❌ You need to register first. Please press /start');
        return;
    }

    // Initialize user session for voucher code input
    userSessions.set(userId, { step: 'waiting_voucher_code' });

    ctx.reply('💸 Please enter your voucher code to cash in:');
});

// Document type selection handlers
bot.action('doc_aadhar', (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (session && session.step === 'waiting_document_type') {
        session.registrationData.documentType = 'aadhar';
        session.step = 'waiting_aadhar_front';
        userSessions.set(userId, session);

        ctx.reply('📄 Please upload the front side of your Aadhar Card:');
    }
});

bot.action('doc_pan', (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (session && session.step === 'waiting_document_type') {
        session.registrationData.documentType = 'pan';
        session.step = 'waiting_pan_image';
        userSessions.set(userId, session);

        ctx.reply('📄 Please upload your PAN Card photo:');
    }
});

bot.action('doc_dl', (ctx) => {
    ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions.get(userId);

    if (session && session.step === 'waiting_document_type') {
        session.registrationData.documentType = 'dl';
        session.step = 'waiting_dl_image';
        userSessions.set(userId, session);

        ctx.reply('📄 Please upload your Driving License photo:');
    }
});

// Handle text messages
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userSession = userSessions.get(userId);
    
    // Check if user is in voucher payout flow (from voucher.js)
    const voucherState = userStates.get(userId);
    
    if (voucherState && voucherState.stage === 'payout_upi_id') {
        const upiId = ctx.message.text.trim();

        // Basic UPI ID validation
        const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiRegex.test(upiId)) {
            ctx.reply('❌ Please enter a valid UPI ID (e.g., yourname@paytm):');
            return;
        }

        try {
            // Get voucher amount from voucher details
            const voucherAmount = voucherState.voucherDetails.balance || voucherState.voucherDetails.amount;
            
            // Create payout request
            const result = await createPayoutRequest(
                userId,
                voucherAmount,
                upiId,
                ctx.from.username
            );

            if (result.success) {
                const message = `✅ Payout Request Submitted!

💰 Voucher Amount: ₹${voucherAmount}
💸 Payout Amount: ₹${result.paymentAmount}
💳 Service Charge (10%): ₹${result.serviceCharge}
📱 UPI ID: ${upiId}
📝 Request ID: ${result.requestId}

⏳ Your request has been sent to our admin team for approval.
You will receive a notification once it's processed.

Thank you for using CashIn Bot! 🙏`;

                await ctx.reply(message);
                
                // Clear voucher state
                userStates.delete(userId);
            } else {
                await ctx.reply('❌ Failed to create payout request. Please try again.');
            }
        } catch (error) {
            console.error('Error creating payout request:', error);
            await ctx.reply('❌ An error occurred while processing your request. Please try again.');
        }
        return;
    }

    if (!userSession) {
        return;
    }

    try {
        // Registration flow
        if (userSession.step === 'waiting_name') {
            const name = ctx.message.text.trim();

            if (name.length < 2) {
                ctx.reply('❌ Please enter a valid name:');
                return;
            }

            userSession.registrationData.name = name;
            userSession.step = 'waiting_mobile';
            userSessions.set(userId, userSession);

            ctx.reply('📱 Please enter your mobile number:');

        } else if (userSession.step === 'waiting_mobile') {
            const mobile = ctx.message.text.trim();

            // Basic mobile validation
            const mobileRegex = /^[6-9]\d{9}$/;
            if (!mobileRegex.test(mobile)) {
                ctx.reply('❌ Please enter a valid 10-digit mobile number:');
                return;
            }

            userSession.registrationData.mobile = mobile;
            userSession.step = 'waiting_email';
            userSessions.set(userId, userSession);

            ctx.reply(`📧 📧 Please enter your email address: \n\n 
(This is the email address where your voucher will be sent) \n\n
(Yahi email par aapka voucher bheja jayega)
`);

        } else if (userSession.step === 'waiting_email') {
            const email = ctx.message.text.trim();

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                ctx.reply('❌ Please enter a valid email address:');
                return;
            }

            userSession.registrationData.email = email;
            userSession.step = 'waiting_document_type';
            userSessions.set(userId, userSession);

            const message = '📄 Please choose your document type:';
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🆔 Aadhar Card', 'doc_aadhar')],
                [Markup.button.callback('📋 PAN Card', 'doc_pan')],
                [Markup.button.callback('🚗 Driving License', 'doc_dl')]
            ]);

            ctx.reply(message, keyboard);

        }
        // Payment flow (existing code)
        else if (userSession.step === 'waiting_amount') {
            const amount = parseFloat(ctx.message.text);

            if (isNaN(amount) || amount <= 0) {
                ctx.reply('❌ Please enter a valid amount (numbers only):');
                return;
            }

            // Get user email and phone number from database
            const email = getUserEmail(userId);
            const phoneNumber = getUserPhoneNumber(userId);
            
            if (!email) {
                ctx.reply('❌ Unable to find your email. Please contact support.');
                userSessions.delete(userId);
                return;
            }

            if (!phoneNumber) {
                ctx.reply('❌ Unable to find your phone number. Please contact support.');
                userSessions.delete(userId);
                return;
            }

            // Update session with amount, email and phone number
            userSession.amount = amount;
            userSession.email = email;
            userSession.phoneNumber = phoneNumber;
            userSessions.set(userId, userSession);

            ctx.reply('⏳ Generating payment link... Please wait.');

            // Generate payment link
            const paymentResult = await generatePaymentLink(
                userId,
                userSession.amount,
                email,
                ctx.from.username,
                phoneNumber
            );

            if (paymentResult.success) {
                // Notify admins about new voucher request
                await notifyNewVoucherRequest(
                    userId,
                    paymentResult.originalAmount,
                    email,
                    paymentResult.invoiceNumber,
                    ctx.from.username
                );

                const message = `✅ Payment link generated successfully!\n\n` +
                    `💰 Voucher Amount: ₹${paymentResult.originalAmount}\n` +
                    `💳 Service Charge (5%): ₹${paymentResult.serviceCharge}\n` +
                    `💵 Final Amount: ₹${paymentResult.finalAmount}\n\n` +
                    `📧 Email: ${email}\n` +
                    `📱 Phone: ${phoneNumber}\n` +
                    `📝 Invoice Number: ${paymentResult.invoiceNumber}\n\n` +
                    `Click the button below to complete your payment.`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.url('💳 Pay Now', paymentResult.paymentLink)]
                ]);

                ctx.reply(message, keyboard);

                // Store payment details for status tracking
                userSession.invoiceNumber = paymentResult.invoiceNumber;
                userSession.step = 'payment_pending';
                userSessions.set(userId, userSession);

            } else {
                ctx.reply(`❌ Failed to generate payment link: ${paymentResult.error}`);
                // Clear session on error
                userSessions.delete(userId);
            }
        }
        // Voucher cash-in flow
        else if (userSession.step === 'waiting_voucher_code') {
            const voucherCode = ctx.message.text.trim();

            if (voucherCode.length < 5) {
                ctx.reply('❌ Please enter a valid voucher code:');
                return;
            }

            // Clear session as processCashIn will handle the flow
            userSessions.delete(userId);

            // Process the voucher using the function from voucher.js
            await processCashIn(voucherCode, ctx);
        }
        // Remove the extra closing brace and the unnecessary else if block
    } catch (error) {
        console.error('Error in text handler:', error);
        ctx.reply('❌ An error occurred. Please try again.');
        userSessions.delete(userId);
    }
});

// Handle photo uploads
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const userSession = userSessions.get(userId);

    if (!userSession || !userSession.registrationData) {
        return;
    }

    try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get highest resolution
        const fileId = photo.file_id;

        ctx.reply('⏳ Uploading... Please wait.');

        // Download image from Telegram
        const imageBuffer = await downloadTelegramImage(fileId);

        // Upload to Cloudinary
        const fileName = `${userId}_${userSession.registrationData.documentType}_${Date.now()}`;
        const imageUrl = await uploadToCloudinary(imageBuffer, fileName);

        if (userSession.step === 'waiting_aadhar_front') {
            userSession.registrationData.aadharFrontUrl = imageUrl;
            userSession.step = 'waiting_aadhar_back';
            userSessions.set(userId, userSession);

            ctx.reply('✅ Aadhar Card front uploaded successfully!\n\n📄 Now please upload the back side of your Aadhar Card:');

        } else if (userSession.step === 'waiting_aadhar_back') {
            userSession.registrationData.aadharBackUrl = imageUrl;
            await completeRegistration(ctx, userId, userSession);

        } else if (userSession.step === 'waiting_pan_image') {
            userSession.registrationData.panUrl = imageUrl;
            await completeRegistration(ctx, userId, userSession);

        } else if (userSession.step === 'waiting_dl_image') {
            userSession.registrationData.dlUrl = imageUrl;
            await completeRegistration(ctx, userId, userSession);
        }

    } catch (error) {
        console.error('Error handling photo upload:', error);
        ctx.reply('❌ Photo upload failed. Please try again.');
    }
});

// Complete registration process
async function completeRegistration(ctx, userId, userSession) {
    try {
        const registrationData = {
            userId: userId,
            username: ctx.from.username || 'N/A',
            name: userSession.registrationData.name,
            mobile: userSession.registrationData.mobile,
            email: userSession.registrationData.email,
            documentType: userSession.registrationData.documentType,
            documentUrls: {},
            status: 'pending',
            submittedAt: new Date().toISOString()
        };

        // Add document URLs based on type
        if (userSession.registrationData.documentType === 'aadhar') {
            registrationData.documentUrls = {
                front: userSession.registrationData.aadharFrontUrl,
                back: userSession.registrationData.aadharBackUrl
            };
        } else if (userSession.registrationData.documentType === 'pan') {
            registrationData.documentUrls = {
                image: userSession.registrationData.panUrl
            };
        } else if (userSession.registrationData.documentType === 'dl') {
            registrationData.documentUrls = {
                image: userSession.registrationData.dlUrl
            };
        }

        // Save to pending approvals database
        const pendingDb = loadDatabase(PENDING_APPROVALS_DB);
        pendingDb.pending.push(registrationData);
        saveDatabase(PENDING_APPROVALS_DB, pendingDb);

        // Notify user
        ctx.reply('✅ Registration submitted successfully!\n\n⏳ Your documents are under review. You will be notified once approved (usually within 5 minutes).');

        // Notify admins about new registration
        await notifyUserRegistration(registrationData);

        // Clear session
        userSessions.delete(userId);

    } catch (error) {
        console.error('Error completing registration:', error);
        ctx.reply('❌ Registration failed. Please try again.');
    }
}

// Function to clean up old temporary files
function cleanupOldTempFiles() {
    try {
        const files = fs.readdirSync('./');
        const tempFiles = files.filter(file => file.startsWith('temp_invoice_'));
        
        tempFiles.forEach(file => {
            try {
                const filePath = `./${file}`;
                const stats = fs.statSync(filePath);
                const now = new Date();
                const fileAge = now - stats.mtime;
                
                // Delete files older than 1 hour (3600000 ms)
                if (fileAge > 3600000) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Cleaned up old temp file: ${file}`);
                }
            } catch (error) {
                console.error(`Error cleaning up file ${file}:`, error);
            }
        });
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

// Check if user is admin (either buy admin or sell admin)
function isAdmin(userId) {
    try {
        // Check buy admin database
        const buyAdminDb = loadDatabase(BUY_ADMIN_DB);
        if (buyAdminDb.buyAdminChatIds && buyAdminDb.buyAdminChatIds.includes(userId)) {
            return true;
        }
        
        // Check sell admin database
        const sellAdminDb = loadDatabase(SELL_ADMIN_DB);
        if (sellAdminDb.sellAdminChatIds && sellAdminDb.sellAdminChatIds.includes(userId)) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

// Get all registered user chat IDs
function getAllUserChatIds() {
    try {
        const registeredUsers = loadDatabase(REGISTERED_USERS_DB);
        const userChatIds = registeredUsers.users
            .filter(user => user.status === 'approved')
            .map(user => user.userId);
        
        console.log(`Found ${userChatIds.length} registered users for broadcast`);
        return userChatIds;
    } catch (error) {
        console.error('Error getting user chat IDs:', error);
        return [];
    }
}

// Broadcast message to all registered users
async function broadcastToAllUsers(message, adminId) {
    const userIds = getAllUserChatIds();
    const results = {
        total: userIds.length,
        successful: 0,
        failed: 0,
        errors: []
    };

    console.log(`📢 Broadcasting message to ${userIds.length} users...`);

    for (const userId of userIds) {
        try {
            await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
            results.successful++;
            console.log(`✅ Message sent to user ${userId}`);
        } catch (error) {
            results.failed++;
            results.errors.push({ userId, error: error.message });
            console.error(`❌ Failed to send message to user ${userId}:`, error.message);
        }
    }

    // Send summary to admin
    const summaryMessage = `📊 *Broadcast Summary*\n\n` +
        `📤 Total Users: ${results.total}\n` +
        `✅ Successful: ${results.successful}\n` +
        `❌ Failed: ${results.failed}\n\n` +
        `📅 Sent at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    try {
        await bot.telegram.sendMessage(adminId, summaryMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error sending summary to admin:', error);
    }

    return results;
}

// Broadcast command handler
bot.command('broadcast', async (ctx) => {
    const userId = ctx.from.id;
    
    console.log(`📢 Broadcast command received from user: ${userId}`);

    // Check if user is admin
    const adminStatus = isAdmin(userId);
    console.log(`👤 User ${userId} admin status: ${adminStatus}`);
    
    if (!adminStatus) {
        console.log(`❌ User ${userId} is not authorized for broadcast`);
        await ctx.reply('❌ You are not authorized to use this command.');
        return;
    }

    console.log(`✅ User ${userId} is authorized as admin`);

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        console.log(`📝 No message provided by user ${userId}`);
        await ctx.reply(
            '📢 *Broadcast Command Usage:*\n\n' +
            '`/broadcast <your message>`\n\n' +
            '*Example:*\n' +
            '`/broadcast Hello everyone! This is an important announcement.`\n\n' +
            'This will send your message to all registered users.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Extract message (everything after "/broadcast ")
    const message = ctx.message.text.substring(11); // Remove "/broadcast "

    if (message.trim().length === 0) {
        console.log(`📝 Empty message provided by user ${userId}`);
        await ctx.reply('❌ Please provide a message to broadcast.');
        return;
    }

    console.log(`📝 Broadcast message: "${message}"`);

    // Get user count
    const userCount = getAllUserChatIds().length;
    console.log(`👥 Total registered users: ${userCount}`);

    // Confirm broadcast
    const confirmMessage = `📢 *Confirm Broadcast*\n\n` +
        `*Message to send:*\n${message}\n\n` +
        `*Recipients:* All registered users (${userCount} users)\n\n` +
        `Are you sure you want to send this broadcast?`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Send Broadcast', `confirm_broadcast_${Date.now()}`),
            Markup.button.callback('❌ Cancel', 'cancel_broadcast')
        ]
    ]);

    // Store the message in user session for confirmation
    userSessions.set(userId, {
        step: 'confirming_broadcast',
        broadcastMessage: message
    });

    console.log(`💾 Session stored for user ${userId}`);

    try {
        await ctx.reply(confirmMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard.reply_markup 
        });
        console.log(`✅ Confirmation message sent to user ${userId}`);
    } catch (error) {
        console.error(`❌ Error sending confirmation to user ${userId}:`, error);
    }
});

// Broadcast confirmation handlers
bot.action(/^confirm_broadcast_(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const userSession = userSessions.get(userId);

    if (!userSession || userSession.step !== 'confirming_broadcast') {
        await ctx.answerCbQuery('❌ Session expired. Please try again.');
        return;
    }

    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ You are not authorized.');
        return;
    }

    await ctx.answerCbQuery('📤 Sending broadcast...');
    await ctx.editMessageText('📤 Broadcasting message to all users...');

    const message = userSession.broadcastMessage;
    
    // Clear session
    userSessions.delete(userId);

    // Send broadcast
    const results = await broadcastToAllUsers(message, userId);

    console.log(`📊 Broadcast completed by admin ${userId}:`, results);
});



bot.action('cancel_broadcast', async (ctx) => {
    const userId = ctx.from.id;
    
    // Clear session
    userSessions.delete(userId);
    
    await ctx.answerCbQuery('❌ Broadcast cancelled.');
    await ctx.editMessageText('❌ Broadcast cancelled.');
});

// Admin help command
bot.command('adminhelp', async (ctx) => {
    const userId = ctx.from.id;

    if (!isAdmin(userId)) {
        await ctx.reply('❌ You are not authorized to use this command.');
        return;
    }

    const helpMessage = `👨‍💼 *Admin Commands*\n\n` +
        `📢 \`/broadcast <message>\` - Send message to all users\n` +
        `📊 \`/stats\` - View bot statistics\n` +
        `🔍 \`/debug\` - Check admin status and debug info\n` +
        `❓ \`/adminhelp\` - Show this help message\n\n` +
        `*Broadcast Usage:*\n` +
        `\`/broadcast Hello everyone!\`\n\n` +
        `*Note:* Only registered admins can use these commands.`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

function generateVoucherStatistics() {
    try {
        // Load databases
        const invoicesData = loadDatabase(INVOICES_DB);
        const pendingData = loadDatabase(PENDING_PAYMENTS_DB);
        
        const invoices = invoicesData.invoices || [];
        const pendingPayments = pendingData.pendingPayments || [];
        
        // Get today's date
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
        
        // Calculate pending purchases
        const pendingCount = pendingPayments.length;
        const pendingAmount = pendingPayments.reduce((sum, payment) => {
            return sum + (parseFloat(payment.finalAmount) || parseFloat(payment.amount) || 0);
        }, 0);
        
        // Calculate completed purchases
        const completedInvoices = invoices.filter(invoice => invoice.status === 'success');
        const completedCount = completedInvoices.length;
        const completedAmount = completedInvoices.reduce((sum, invoice) => {
            return sum + (parseFloat(invoice.finalAmount) || parseFloat(invoice.amount) || 0);
        }, 0);
        
        // Calculate commission (assuming 5% commission rate)
        const commissionRate = 0.05;
        const totalCommission = completedAmount * commissionRate;
        
        // Calculate today's statistics
        const todayInvoices = completedInvoices.filter(invoice => {
            const invoiceDate = new Date(invoice.createdAt).toISOString().split('T')[0];
            return invoiceDate === todayStr;
        });
        
        const todayCount = todayInvoices.length;
        const todayAmount = todayInvoices.reduce((sum, invoice) => {
            return sum + (parseFloat(invoice.finalAmount) || parseFloat(invoice.amount) || 0);
        }, 0);
        const todayCommission = todayAmount * commissionRate;
        
        // Calculate overall revenue
        const overallRevenue = completedAmount;
        
        // Format the statistics message
        const statsMessage = `📊 Voucher Purchase Statistics

⏳ Pending Purchases:
• Count: ${pendingCount}
• Total Amount: ₹${pendingAmount.toFixed(2)}

✅ Completed Purchases:
• Count: ${completedCount}
• Total Amount: ₹${completedAmount.toFixed(2)}
• Commission Earned: ₹${totalCommission.toFixed(2)}

📅 Today's Summary:
• Purchases: ${todayCount}
• Amount: ₹${todayAmount.toFixed(2)}
• Commission: ₹${todayCommission.toFixed(2)}

💰 Overall Revenue: ₹${overallRevenue.toFixed(2)}
💎 Total Commission Earned: ₹${totalCommission.toFixed(2)}`;

        return statsMessage;
        
    } catch (error) {
        console.error('Error generating statistics:', error);
        return '❌ Error generating statistics. Please try again later.';
    }
}

// Stats command for admins
bot.command('stats', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        return ctx.reply('❌ You are not authorized to use this command.');
    }
    
    try {
        const statsMessage = generateVoucherStatistics();
        await ctx.reply(statsMessage);
    } catch (error) {
        console.error('Error in stats command:', error);
        await ctx.reply('❌ Error generating statistics. Please try again later.');
    }
});

// Debug command to check admin status
bot.command('debug', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const buyAdminDb = loadDatabase(BUY_ADMIN_DB);
        const sellAdminDb = loadDatabase(SELL_ADMIN_DB);
        const adminStatus = isAdmin(userId);
        
        const debugMessage = `🔍 *Debug Information*\n\n` +
            `👤 Your User ID: \`${userId}\`\n` +
            `👨‍💼 Admin Status: ${adminStatus ? '✅ Yes' : '❌ No'}\n\n` +
            `📊 Buy Admin IDs: ${JSON.stringify(buyAdminDb.buyAdminChatIds || [])}\n` +
            `💸 Sell Admin IDs: ${JSON.stringify(sellAdminDb.sellAdminChatIds || [])}\n\n` +
            `👥 Total Users: ${getAllUserChatIds().length}`;
        
        await ctx.reply(debugMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Debug command error:', error);
        await ctx.reply(`❌ Debug error: ${error.message}`);
    }
});

bot.launch();

console.log('Bot is running...');

export { sendPaymentStatusToUser, isUserRegistered, loadDatabase, saveDatabase };