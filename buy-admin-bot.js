import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Buy Admin Bot Configuration
const BUY_ADMIN_BOT_TOKEN = '7918023381:AAGFBRTKTFDjoWMOrtnLocKHtHb4qdnKj0o'; // Using the same token from save.js
const BUY_ADMIN_DB_PATH = path.join(__dirname, 'buy_admin_db.json');

// Initialize Buy Admin Bot
const buyAdminBot = new Telegraf(BUY_ADMIN_BOT_TOKEN);

// Main bot reference for user notifications
let mainBotReference = null;

// Function to set main bot reference
function setMainBotReference(bot) {
    mainBotReference = bot;
}

// Database helper functions
function loadDatabase(dbPath) {
    try {
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error(`Error loading database from ${dbPath}:`, error.message);
        return null;
    }
}

function saveToDatabase(data, dbPath) {
    try {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error saving to database ${dbPath}:`, error.message);
        return false;
    }
}

// Initialize buy admin database
function initializeBuyAdminDatabase() {
    if (!fs.existsSync(BUY_ADMIN_DB_PATH)) {
        fs.writeFileSync(BUY_ADMIN_DB_PATH, JSON.stringify({
            buyAdminChatIds: []
        }, null, 2));
    }
}

// Buy Admin registration
buyAdminBot.command('register', async (ctx) => {
    const adminDb = loadDatabase(BUY_ADMIN_DB_PATH) || { buyAdminChatIds: [] };
    const chatId = ctx.chat.id;

    if (!adminDb.buyAdminChatIds.includes(chatId)) {
        adminDb.buyAdminChatIds.push(chatId);
        saveToDatabase(adminDb, BUY_ADMIN_DB_PATH);
        await ctx.reply('✅ You are now registered as a Buy Admin for voucher purchase notifications.');
    } else {
        await ctx.reply('ℹ️ You are already registered as a Buy Admin.');
    }
});

// Buy Admin unregistration
buyAdminBot.command('unregister', async (ctx) => {
    const adminDb = loadDatabase(BUY_ADMIN_DB_PATH) || { buyAdminChatIds: [] };
    const chatId = ctx.chat.id;

    const index = adminDb.buyAdminChatIds.indexOf(chatId);
    if (index !== -1) {
        adminDb.buyAdminChatIds.splice(index, 1);
        saveToDatabase(adminDb, BUY_ADMIN_DB_PATH);
        await ctx.reply('❌ You have been unregistered as a Buy Admin.');
    } else {
        await ctx.reply('ℹ️ You were not registered as a Buy Admin.');
    }
});

// Buy Admin help command
buyAdminBot.command('help', async (ctx) => {
    await ctx.reply(
        '💼 *Buy Admin Bot Commands*\n\n' +
        '/register - Register as buy admin\n' +
        '/unregister - Remove yourself as buy admin\n' +
        '/help - Show this help message\n' +
        '/stats - Show buy statistics\n\n' +
        'As a buy admin, you will receive notifications for:\n' +
        '• New voucher purchase requests\n' +
        '• Payment successful confirmations\n' +
        '• Voucher delivery confirmations\n' +
        '• Payment failures',
        { parse_mode: 'Markdown' }
    );
});

// Buy Admin stats command
buyAdminBot.command('stats', async (ctx) => {
    const adminDb = loadDatabase(BUY_ADMIN_DB_PATH) || { buyAdminChatIds: [] };
    
    await ctx.reply(
        `📊 *Buy Admin Statistics*\n\n` +
        `👥 Registered Buy Admins: ${adminDb.buyAdminChatIds.length}\n` +
        `🤖 Bot Status: Active\n` +
        `📅 Last Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        { parse_mode: 'Markdown' }
    );
});

// Function to escape Markdown special characters
function escapeMarkdown(text) {
    if (!text) return text;
    return text.toString().replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// Function to broadcast messages to all registered buy admins
async function broadcastToBuyAdmins(message, options = {}) {
    const adminDb = loadDatabase(BUY_ADMIN_DB_PATH) || { buyAdminChatIds: [] };
    
    if (adminDb.buyAdminChatIds && adminDb.buyAdminChatIds.length > 0) {
        console.log(`📢 Broadcasting to ${adminDb.buyAdminChatIds.length} buy admins.`);
        
        const results = [];
        for (const chatId of adminDb.buyAdminChatIds) {
            try {
                // Remove parse_mode to avoid Markdown parsing errors
                await buyAdminBot.telegram.sendMessage(chatId, message, { 
                    ...options 
                });
                results.push({ chatId, success: true });
            } catch (error) {
                console.error(`❌ Failed to send message to buy admin ${chatId}:`, error.message);
                results.push({ chatId, success: false, error: error.message });
            }
        }
        return results;
    } else {
        console.log('⚠️ No buy admins registered for notifications.');
        return [];
    }
}

// 1. New Voucher Purchase Request
async function notifyNewVoucherRequest(userId, amount, email, paymentId, username = null) {
    const userDisplay = username ? `@${username} (${userId})` : `user_${userId}`;
    const serviceCharge = Math.round(amount * 0.05 * 100) / 100;
    const totalAmount = Math.round((amount + serviceCharge) * 100) / 100;
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

    const message = `🆕 NEW VOUCHER PURCHASE REQUEST\n\n` +
                   `👤 User: ${userDisplay}\n` +
                   `💰 Voucher Amount: ₹${amount}\n` +
                   `📊 Commission (5%): ₹${serviceCharge}\n` +
                   `💳 Total Amount: ₹${totalAmount}\n` +
                   `📧 Email: ${email}\n` +
                   `🕐 Time: ${currentTime}\n` +
                   `🆔 Payment ID: ${paymentId}\n\n` +
                   `⏳ Status: Payment Link Generated\n` +
                   `💳 Method: PayU Payment Gateway`;

    return await broadcastToBuyAdmins(message);
}

// 2. Payment Successful
async function notifyPaymentSuccessful(userId, amount, email, paymentId, txnid, username = null) {
    const userDisplay = username ? `@${username} (${userId})` : `user_${userId}`;
    const serviceCharge = Math.round(amount * 0.05 * 100) / 100;
    const totalPaid = Math.round((amount + serviceCharge) * 100) / 100;
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

    const message = `✅ PAYMENT SUCCESSFUL\n\n` +
                   `👤 User: ${userDisplay}\n` +
                   `💰 Voucher Amount: ₹${amount}\n` +
                   `📊 Commission (5%): ₹${serviceCharge}\n` +
                   `💳 Total Paid: ₹${totalPaid}\n` +
                   `📧 Email: ${email}\n` +
                   `🕐 Completed: ${currentTime}\n` +
                   `🆔 Payment ID: ${paymentId}\n` +
                   `📝 Transaction ID: ${txnid}\n\n` +
                   `📨 Status: Voucher being generated and sent to email`;

    return await broadcastToBuyAdmins(message);
}

// 3. Voucher Delivered
async function notifyVoucherDelivered(userId, amount, email, paymentId, txnid, username = null) {
    const userDisplay = username ? `@${username} (${userId})` : `user_${userId}`;
    const serviceCharge = Math.round(amount * 0.05 * 100) / 100;
    const totalReceived = Math.round((amount + serviceCharge) * 100) / 100;
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

    const message = `📨 VOUCHER DELIVERED\n\n` +
                   `👤 User: ${userDisplay}\n` +
                   `💰 Voucher Amount: ₹${amount}\n` +
                   `📊 Commission Earned: ₹${serviceCharge} (5%)\n` +
                   `💳 Total Received: ₹${totalReceived}\n` +
                   `📧 Email: ${email}\n` +
                   `🕐 Delivered: ${currentTime}\n` +
                   `🆔 Payment ID: ${paymentId}\n` +
                   `📝 Transaction ID: ${txnid}\n\n` +
                   `✅ Status: Voucher successfully sent to user's email`;

    return await broadcastToBuyAdmins(message);
}

// 4. Payment Failed
async function notifyPaymentFailed(userId, amount, email, paymentId, txnid, username = null, errorReason = null) {
    const userDisplay = username ? `@${username} (${userId})` : `user_${userId}`;
    const serviceCharge = Math.round(amount * 0.05 * 100) / 100;
    const totalAmount = Math.round((amount + serviceCharge) * 100) / 100;
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

    const message = `❌ PAYMENT FAILED\n\n` +
                   `👤 User: ${userDisplay}\n` +
                   `💰 Voucher Amount: ₹${amount}\n` +
                   `📊 Commission (5%): ₹${serviceCharge}\n` +
                   `💳 Total Amount: ₹${totalAmount}\n` +
                   `📧 Email: ${email}\n` +
                   `🕐 Failed: ${currentTime}\n` +
                   `🆔 Payment ID: ${paymentId}\n` +
                   `📝 Transaction ID: ${txnid}\n\n` +
                   `❌ Status: Payment failed${errorReason ? `\n🔍 Reason: ${errorReason}` : ''}`;

    return await broadcastToBuyAdmins(message);
}

// 5. Voucher Delivery Failed
async function notifyVoucherDeliveryFailed(userId, amount, email, paymentId, txnid, errorReason, username = null) {
    const userDisplay = username ? `@${username} (${userId})` : `user_${userId}`;
    const serviceCharge = Math.round(amount * 0.05 * 100) / 100;
    const totalReceived = Math.round((amount + serviceCharge) * 100) / 100;
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

    const message = `⚠️ VOUCHER DELIVERY FAILED\n\n` +
                   `👤 User: ${userDisplay}\n` +
                   `💰 Voucher Amount: ₹${amount}\n` +
                   `📊 Commission: ₹${serviceCharge} (5%)\n` +
                   `💳 Total Received: ₹${totalReceived}\n` +
                   `📧 Email: ${email}\n` +
                   `🕐 Failed: ${currentTime}\n` +
                   `🆔 Payment ID: ${paymentId}\n` +
                   `📝 Transaction ID: ${txnid}\n\n` +
                   `❌ Status: Voucher delivery failed\n` +
                   `🔍 Reason: ${errorReason}\n\n` +
                   `⚠️ Action Required: Manual voucher delivery needed`;

    return await broadcastToBuyAdmins(message);
}

// Function to notify admins with invoice
async function notifyAdminsWithInvoice(userId, invoicePdfUrl, invoiceData) {
    try {
        const message = `📄 Invoice Generated\n\n` +
            `👤 User ID: ${userId}\n` +
            `👤 Username: ${invoiceData.username || 'N/A'}\n` +
            `📧 Email: ${invoiceData.email}\n` +
            `💰 Voucher Amount: ₹${invoiceData.originalAmount}\n` +
            `💳 Service Charge: ₹${invoiceData.serviceCharge}\n` +
            `💵 Final Amount: ₹${invoiceData.finalAmount}\n` +
            `📝 Transaction ID: ${invoiceData.txnid}\n` +
            `📄 Invoice Number: ${invoiceData.invoiceNumber}\n` +
            `⏰ Generated: ${new Date(invoiceData.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n` +
            `✅ Status: Payment Successful & Voucher Delivered`;

        await broadcastToBuyAdmins(message);

        // Send the invoice URL in a separate message to avoid parsing issues
        await broadcastToBuyAdmins(`📎 Invoice URL: ${invoicePdfUrl}`);

        console.log('✅ Invoice notification sent to all buy admins');
    } catch (error) {
        console.error('❌ Error notifying admins with invoice:', error);
        throw error;
    }
}

// Initialize database
initializeBuyAdminDatabase();

// Start buy admin bot
buyAdminBot.launch();

console.log('🤖 Buy Admin Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => buyAdminBot.stop('SIGINT'));
process.once('SIGTERM', () => buyAdminBot.stop('SIGTERM'));

// User approval handlers
buyAdminBot.action(/^approve_user_(.+)$/, async (ctx) => {
    try {
        const userId = ctx.match[1];
        await approveUser(userId);
        
        ctx.answerCbQuery('User approved successfully!');
        ctx.editMessageText(ctx.callbackQuery.message.text + '\n\nAPPROVED');
        
        // Notify user about approval using main bot reference
        if (mainBotReference) {
            await mainBotReference.telegram.sendMessage(userId, 
                'Congratulations! Your registration has been approved.\n\n' +
                'You can now use CashIn Bot. Press /start to continue.'
            );
        }
        
    } catch (error) {
        console.error('Error approving user:', error);
        ctx.answerCbQuery('Error approving user');
    }
});

buyAdminBot.action(/^reject_user_(.+)$/, async (ctx) => {
    try {
        const userId = ctx.match[1];
        await rejectUser(userId);
        
        ctx.answerCbQuery('User rejected');
        ctx.editMessageText(ctx.callbackQuery.message.text + '\n\nREJECTED');
        
        // Notify user about rejection using main bot reference
        if (mainBotReference) {
            await mainBotReference.telegram.sendMessage(userId, 
                'Sorry, your registration has been rejected.\n\n' +
                'Please register again with correct documents. Press /start to try again.'
            );
        }
        
    } catch (error) {
        console.error('Error rejecting user:', error);
        ctx.answerCbQuery('Error rejecting user');
    }
});

// Helper functions for user approval
async function approveUser(userId) {
    try {
        const registeredUsersPath = path.join(__dirname, 'registered_users_db.json');
        const pendingApprovalsPath = path.join(__dirname, 'pending_approvals_db.json');
        
        // Load databases
        const registeredUsers = loadDatabase(registeredUsersPath) || { users: [] };
        const pendingApprovals = loadDatabase(pendingApprovalsPath) || { pending: [] };
        
        // Find user in pending approvals
        const userIndex = pendingApprovals.pending.findIndex(user => user.userId.toString() === userId.toString());
        
        if (userIndex !== -1) {
            const user = pendingApprovals.pending[userIndex];
            user.status = 'approved';
            user.approvedAt = new Date().toISOString();
            
            // Move to registered users
            registeredUsers.users.push(user);
            
            // Remove from pending
            pendingApprovals.pending.splice(userIndex, 1);
            
            // Save databases
            saveToDatabase(registeredUsers, registeredUsersPath);
            saveToDatabase(pendingApprovals, pendingApprovalsPath);
            
            console.log(`User ${userId} approved successfully`);
        }
    } catch (error) {
        console.error('Error approving user:', error);
        throw error;
    }
}

async function rejectUser(userId) {
    try {
        const pendingApprovalsPath = path.join(__dirname, 'pending_approvals_db.json');
        const pendingApprovals = loadDatabase(pendingApprovalsPath) || { pending: [] };
        
        // Remove user from pending approvals
        const userIndex = pendingApprovals.pending.findIndex(user => user.userId.toString() === userId.toString());
        
        if (userIndex !== -1) {
            pendingApprovals.pending.splice(userIndex, 1);
            saveToDatabase(pendingApprovals, pendingApprovalsPath);
            console.log(`User ${userId} rejected successfully`);
        }
    } catch (error) {
        console.error('Error rejecting user:', error);
        throw error;
    }
}

// User registration notification function
async function notifyUserRegistration(registrationData) {
    const { userId, username, name, mobile, email, documentType, documentUrls } = registrationData;
    
    try {
        // First send the text message with user details
        const message = `NEW USER REGISTRATION\n\n` +
                       `Name: ${name}\n` +
                       `Mobile: ${mobile}\n` +
                       `Email: ${email}\n` +
                       `User ID: ${userId}\n` +
                       `Username: @${username || 'N/A'}\n\n` +
                       `Document Type: ${documentType.toUpperCase()}\n\n` +
                       `Submitted: ${new Date(registrationData.submittedAt).toLocaleString('en-IN')}`;
        
        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('Approve', `approve_user_${userId}`),
                Markup.button.callback('Reject', `reject_user_${userId}`)
            ]
        ]);
        
        // Send the main message first
        await broadcastToBuyAdmins(message, { reply_markup: keyboard.reply_markup });
        
        // Debug logging
        console.log(`Processing registration for user ${userId}, document type: ${documentType}`);
        console.log('Document URLs:', JSON.stringify(documentUrls, null, 2));
        
        // Then send the document images
        if (documentType === 'aadhar') {
            // Send Aadhar front image
            if (documentUrls.front) {
                await sendImageToAdmins(documentUrls.front, `Aadhar Front - ${name} (${userId})`);
            }
            
            // Send Aadhar back image
            if (documentUrls.back) {
                await sendImageToAdmins(documentUrls.back, `Aadhar Back - ${name} (${userId})`);
            }
        } else if (documentType === 'pan') {
            // Send PAN image
            if (documentUrls.front) {
                await sendImageToAdmins(documentUrls.front, `PAN Card - ${name} (${userId})`);
            }
        } else if (documentType === 'dl') {
            // Send DL image
            if (documentUrls.front) {
                await sendImageToAdmins(documentUrls.front, `Driving License - ${name} (${userId})`);
            }
        }
        
    } catch (error) {
        console.error('Error sending registration notification:', error);
        
        // Send fallback message if image sending fails
        const fallbackMessage = `NEW USER REGISTRATION\n\n` +
                               `Name: ${name}\n` +
                               `Mobile: ${mobile}\n` +
                               `Email: ${email}\n` +
                               `User ID: ${userId}\n` +
                               `Username: @${username || 'N/A'}\n\n` +
                               `Document: ${documentType}\n` +
                               `Error loading images - check manually\n\n` +
                               `Submitted: ${new Date(registrationData.submittedAt).toLocaleString('en-IN')}`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('Approve', `approve_user_${userId}`),
                Markup.button.callback('Reject', `reject_user_${userId}`)
            ]
        ]);
        
        await broadcastToBuyAdmins(fallbackMessage, { reply_markup: keyboard.reply_markup });
    }
}

// New function to send images to all admins
async function sendImageToAdmins(imageUrl, caption) {
    try {
        console.log(`Attempting to send image: ${imageUrl}`);
        console.log(`Caption: ${caption}`);
        
        const adminData = loadDatabase(BUY_ADMIN_DB_PATH);
        const admins = adminData.buyAdminChatIds || [];
        
        console.log(`Found ${admins.length} admins to send image to`);
        
        if (admins.length === 0) {
            console.log('No admins found in database');
            return;
        }
        
        for (const adminId of admins) {
            try {
                console.log(`Sending image to admin ${adminId}`);
                await buyAdminBot.telegram.sendPhoto(adminId, imageUrl, {
                    caption: caption
                });
                console.log(`Successfully sent image to admin ${adminId}`);
            } catch (error) {
                console.error(`Failed to send image to admin ${adminId}:`, error.message);
                console.error('Full error:', error);
            }
        }
    } catch (error) {
        console.error('Error sending images to admins:', error);
    }
}

export {
    notifyNewVoucherRequest,
    notifyPaymentSuccessful,
    notifyVoucherDelivered,
    notifyPaymentFailed,
    notifyVoucherDeliveryFailed,
    notifyUserRegistration,
    notifyAdminsWithInvoice,
    broadcastToBuyAdmins,
    setMainBotReference
};