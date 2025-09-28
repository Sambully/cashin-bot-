import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sell Admin Bot Configuration - You need to create a new bot with @BotFather
const SELL_ADMIN_BOT_TOKEN = '7793867325:AAGaDUdMQ6-4GxLHirsn0uOj9qOEysanm7U'; // Replace with new bot token
const SELL_ADMIN_DB_PATH = path.join(__dirname, 'sell_admin_db.json');
const PAYOUT_REQUESTS_DB_PATH = path.join(__dirname, 'payout_requests_db.json');

// Initialize Sell Admin Bot
const sellAdminBot = new Telegraf(SELL_ADMIN_BOT_TOKEN);

// Store reference to main bot for user notifications
let mainBotInstance = null;

// Database helper functions
function loadDatabase(dbPath) {
    try {
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error(`Error loading database from ${dbPath}:`, error);
        return null;
    }
}

function saveToDatabase(data, dbPath) {
    try {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error saving database to ${dbPath}:`, error);
        return false;
    }
}

// Initialize sell admin database
function initializeSellAdminDatabase() {
    const db = loadDatabase(SELL_ADMIN_DB_PATH);
    if (!db) {
        const initialData = {
            sellAdminChatIds: []
        };
        saveToDatabase(initialData, SELL_ADMIN_DB_PATH);
        console.log('Sell admin database initialized');
    }
}

// Bot commands
sellAdminBot.command('register', async (ctx) => {
    const chatId = ctx.chat.id;
    const db = loadDatabase(SELL_ADMIN_DB_PATH) || { sellAdminChatIds: [] };
    
    if (!db.sellAdminChatIds.includes(chatId)) {
        db.sellAdminChatIds.push(chatId);
        saveToDatabase(db, SELL_ADMIN_DB_PATH);
        await ctx.reply('✅ You have been registered as a sell admin!');
    } else {
        await ctx.reply('ℹ️ You are already registered as a sell admin.');
    }
});

sellAdminBot.command('unregister', async (ctx) => {
    const chatId = ctx.chat.id;
    const db = loadDatabase(SELL_ADMIN_DB_PATH) || { sellAdminChatIds: [] };
    
    const index = db.sellAdminChatIds.indexOf(chatId);
    if (index > -1) {
        db.sellAdminChatIds.splice(index, 1);
        saveToDatabase(db, SELL_ADMIN_DB_PATH);
        await ctx.reply('✅ You have been unregistered from sell admin notifications.');
    } else {
        await ctx.reply('ℹ️ You are not registered as a sell admin.');
    }
});

sellAdminBot.command('help', async (ctx) => {
    const helpMessage = `🤖 *Sell Admin Bot Commands*

/register - Register to receive payout notifications
/unregister - Stop receiving payout notifications  
/stats - View payout statistics
/help - Show this help message

*Payout Management:*
• Receive notifications for new payout requests
• Review UPI QR codes for payments
• Approve or reject payout requests
• Track payment completion status`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

sellAdminBot.command('stats', async (ctx) => {
    const payoutDb = loadDatabase(PAYOUT_REQUESTS_DB_PATH) || { requests: [] };
    
    // Get current date for calculations
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Filter requests by time periods
    const allRequests = payoutDb.requests;
    const todayRequests = allRequests.filter(r => {
        const requestDate = new Date(r.createdAt);
        return requestDate >= today;
    });
    const monthlyRequests = allRequests.filter(r => {
        const requestDate = new Date(r.createdAt);
        return requestDate >= thisMonth;
    });
    
    // Calculate overall statistics
    const total = allRequests.length;
    const pending = allRequests.filter(r => r.status === 'pending').length;
    const completed = allRequests.filter(r => r.status === 'completed').length;
    const rejected = allRequests.filter(r => r.status === 'rejected').length;
    
    // Calculate daily statistics
    const dailyTotal = todayRequests.length;
    const dailyCompleted = todayRequests.filter(r => r.status === 'completed').length;
    const dailyPending = todayRequests.filter(r => r.status === 'pending').length;
    const dailyRejected = todayRequests.filter(r => r.status === 'rejected').length;
    
    // Calculate monthly statistics
    const monthlyTotal = monthlyRequests.length;
    const monthlyCompleted = monthlyRequests.filter(r => r.status === 'completed').length;
    const monthlyPending = monthlyRequests.filter(r => r.status === 'pending').length;
    const monthlyRejected = monthlyRequests.filter(r => r.status === 'rejected').length;
    
    // Calculate profit (service charges from completed transactions)
    const totalProfit = completed > 0 ? allRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.serviceCharge || 0), 0) : 0;
    
    const dailyProfit = dailyCompleted > 0 ? todayRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.serviceCharge || 0), 0) : 0;
    
    const monthlyProfit = monthlyCompleted > 0 ? monthlyRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.serviceCharge || 0), 0) : 0;
    
    // Calculate total sell amounts (voucher amounts from completed transactions)
    const totalSellAmount = completed > 0 ? allRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.voucherAmount || 0), 0) : 0;
    
    const dailySellAmount = dailyCompleted > 0 ? todayRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.voucherAmount || 0), 0) : 0;
    
    const monthlySellAmount = monthlyCompleted > 0 ? monthlyRequests
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.voucherAmount || 0), 0) : 0;

    const statsMessage = `📊 *DETAILED PAYOUT STATISTICS*

🔢 *OVERALL STATS*
Total Requests: ${total}
⏳ Pending: ${pending}
✅ Completed: ${completed}
❌ Rejected: ${rejected}

💰 *PROFIT ANALYSIS*
Total Profit: ₹${totalProfit}
Daily Profit: ₹${dailyProfit}
Monthly Profit: ₹${monthlyProfit}

💸 *SELL VOLUME*
Total Sell: ₹${totalSellAmount}
Daily Sell: ₹${dailySellAmount}
Monthly Sell: ₹${monthlySellAmount}

📅 *TODAY'S STATS*
Total: ${dailyTotal} | Completed: ${dailyCompleted} | Pending: ${dailyPending} | Rejected: ${dailyRejected}

📆 *THIS MONTH'S STATS*
Total: ${monthlyTotal} | Completed: ${monthlyCompleted} | Pending: ${monthlyPending} | Rejected: ${monthlyRejected}

📈 *PERFORMANCE METRICS*
Success Rate: ${total > 0 ? ((completed / total) * 100).toFixed(1) : 0}%
Daily Success Rate: ${dailyTotal > 0 ? ((dailyCompleted / dailyTotal) * 100).toFixed(1) : 0}%
Monthly Success Rate: ${monthlyTotal > 0 ? ((monthlyCompleted / monthlyTotal) * 100).toFixed(1) : 0}%`;

    await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
});

// Broadcast function
async function broadcastToSellAdmins(message, options = {}) {
    const db = loadDatabase(SELL_ADMIN_DB_PATH) || { sellAdminChatIds: [] };
    
    for (const chatId of db.sellAdminChatIds) {
        try {
            await sellAdminBot.telegram.sendMessage(chatId, message, options);
        } catch (error) {
            console.error(`Failed to send message to sell admin ${chatId}:`, error.message);
        }
    }
}

// Function to notify sell admins about new payout request
async function notifyNewPayoutRequest(userId, voucherAmount, paymentAmount, upiId, username = null, requestId) {
    const message = `🆕 NEW PAYOUT REQUEST

👤 User: ${username || `user_${userId}`}
💰 Voucher Amount: ${voucherAmount} INR
💸 Payment Amount: ${paymentAmount} INR
💳 Payment Method: UPI
📱 UPI ID: ${upiId}

Request ID: ${requestId}

💳 Please scan the QR code below to make payment:`;

    // Generate UPI QR code for admin
    const qrCodeUrl = generateUPIQRCode(upiId, paymentAmount);

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Payment Done', `payment_done_${requestId}`),
            Markup.button.callback('❌ Reject', `reject_payout_${requestId}`)
        ]
    ]);

    // Send message with QR code to admins
    const db = loadDatabase(SELL_ADMIN_DB_PATH) || { sellAdminChatIds: [] };
    
    for (const chatId of db.sellAdminChatIds) {
        try {
            await sellAdminBot.telegram.sendMessage(chatId, message);
            await sellAdminBot.telegram.sendPhoto(chatId, qrCodeUrl, {
                caption: `💳 Scan this QR code to pay ₹${paymentAmount} to ${upiId}`,
                reply_markup: keyboard.reply_markup
            });
        } catch (error) {
            console.error(`Failed to send message to sell admin ${chatId}:`, error.message);
        }
    }
}

// Handle payment done action
sellAdminBot.action(/^payment_done_(.+)$/, async (ctx) => {
    const requestId = ctx.match[1];
    
    try {
        // Load payout requests database
        const payoutDb = loadDatabase(PAYOUT_REQUESTS_DB_PATH) || { requests: [] };
        const request = payoutDb.requests.find(r => r.id === requestId);
        
        if (!request) {
            await ctx.answerCbQuery('❌ Request not found!');
            return;
        }
        
        if (request.status !== 'pending') {
            await ctx.answerCbQuery('❌ Request already processed!');
            return;
        }
        
        // Update request status
        request.status = 'completed';
        request.completedBy = ctx.from.id;
        request.completedAt = new Date().toISOString();
        
        saveToDatabase(payoutDb, PAYOUT_REQUESTS_DB_PATH);
        
        // Notify user about successful payment
        await notifyUserPaymentCompleted(request.userId, request.paymentAmount, request.upiId, requestId);
        
        // Create completion message
        const completionMessage = `✅ PAYMENT COMPLETED

👤 User: ${request.username || `user_${request.userId}`}
💰 Voucher Amount: ${request.voucherAmount} INR
💸 Payment Amount: ${request.paymentAmount} INR
📱 UPI ID: ${request.upiId}
📝 Request ID: ${requestId}

✅ Payment done by: ${ctx.from.first_name || ctx.from.username}
⏰ Completed at: ${new Date().toLocaleString()}`;

        // Delete the QR code message and replace with completion message
        try {
            // Delete the current message (QR code with buttons)
            await ctx.deleteMessage();
            
            // Send completion message as a new message
            await ctx.reply(completionMessage);
        } catch (deleteError) {
            console.error('Error deleting QR message:', deleteError);
            // Fallback: try to edit the message if deletion fails
            try {
                await ctx.editMessageText(completionMessage);
            } catch (editError) {
                // If both deletion and editing fail, send a new message
                await ctx.reply(completionMessage);
            }
        }
        
        await ctx.answerCbQuery('✅ Payment marked as completed!');
        
    } catch (error) {
        console.error('Error marking payment as done:', error);
        await ctx.answerCbQuery('❌ Error processing payment completion!');
    }
});

// Function to notify user about payment completion
async function notifyUserPaymentCompleted(userId, amount, upiId, requestId) {
    try {
        if (!mainBotInstance) {
            console.error('Main bot instance not available for user notification');
            return;
        }
        
        const message = `✅ PAYMENT SUCCESSFUL!

🎉 Your payout has been completed successfully!

💰 Amount Received: ₹${amount}
📱 UPI ID: ${upiId}
📝 Request ID: ${requestId}
⏰ Completed at: ${new Date().toLocaleString()}

💰 The money has been transferred to your bank account.
Please check your bank balance.

🙏 Thank you for using CashIn Bot!`;

        await mainBotInstance.telegram.sendMessage(userId, message);
        
    } catch (error) {
        console.error('Error notifying user about payment completion:', error);
    }
}

// Handle reject payout action
sellAdminBot.action(/^reject_payout_(.+)$/, async (ctx) => {
    const requestId = ctx.match[1];
    
    try {
        // Load payout requests database
        const payoutDb = loadDatabase(PAYOUT_REQUESTS_DB_PATH) || { requests: [] };
        const request = payoutDb.requests.find(r => r.id === requestId);
        
        if (!request) {
            await ctx.answerCbQuery('❌ Request not found!');
            return;
        }
        
        if (request.status !== 'pending') {
            await ctx.answerCbQuery('❌ Request already processed!');
            return;
        }
        
        // Update request status
        request.status = 'rejected';
        request.rejectedBy = ctx.from.id;
        request.rejectedAt = new Date().toISOString();
        
        saveToDatabase(payoutDb, PAYOUT_REQUESTS_DB_PATH);
        
        // Notify user about rejection
        await notifyUserPayoutRejected(request.userId, requestId);
        
        // Update admin message
        await ctx.editMessageText(
            `❌ PAYOUT REJECTED\n\n${ctx.callbackQuery.message.text}\n\n❌ Rejected by: ${ctx.from.first_name || ctx.from.username}\n⏰ Rejected at: ${new Date().toLocaleString()}`
        );
        
        await ctx.answerCbQuery('❌ Payout rejected!');
        
    } catch (error) {
        console.error('Error rejecting payout:', error);
        await ctx.answerCbQuery('❌ Error processing rejection!');
    }
});

// Function to notify user about payout rejection
async function notifyUserPayoutRejected(userId, requestId) {
    try {
        if (!mainBotInstance) {
            console.error('Main bot instance not available for user notification');
            return;
        }
        
        const message = `❌ PAYOUT REJECTED

Your payout request has been rejected by the admin.

📝 Request ID: ${requestId}
⏰ Rejected at: ${new Date().toLocaleString()}

Please contact support if you believe this was an error.`;

        await mainBotInstance.telegram.sendMessage(userId, message);
        
    } catch (error) {
        console.error('Error notifying user about payout rejection:', error);
    }
}

// Function to create payout request
async function createPayoutRequest(userId, voucherAmount, upiId, username = null) {
    try {
        // Calculate service charge (10% of voucher amount, minimum ₹1)
        const serviceChargeRate = 0.10;
        const calculatedCharge = voucherAmount * serviceChargeRate;
        const serviceCharge = Math.max(Math.round(calculatedCharge), 1); // Minimum ₹1 service charge
        const paymentAmount = voucherAmount - serviceCharge;
        
        // Generate unique request ID
        const requestId = `payout_${Date.now()}_${userId}`;
        
        // Create payout request object
        const payoutRequest = {
            id: requestId,
            userId: userId,
            username: username,
            voucherAmount: voucherAmount,
            serviceCharge: serviceCharge,
            paymentAmount: paymentAmount,
            upiId: upiId,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        
        // Save to database
        const payoutDb = loadDatabase(PAYOUT_REQUESTS_DB_PATH) || { requests: [] };
        payoutDb.requests.push(payoutRequest);
        saveToDatabase(payoutDb, PAYOUT_REQUESTS_DB_PATH);
        
        // Notify admins
        await notifyNewPayoutRequest(userId, voucherAmount, paymentAmount, upiId, username, requestId);
        
        return {
            success: true,
            requestId: requestId,
            paymentAmount: paymentAmount,
            serviceCharge: payoutRequest.serviceCharge
        };
    } catch (error) {
        console.error('Error creating payout request:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Generate UPI QR code URL
function generateUPIQRCode(upiId, amount) {
    const upiString = `upi://pay?pa=${upiId}&am=${amount}&cu=INR`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiString)}`;
}

// Function to set main bot reference
function setMainBotReference(botInstance) {
    mainBotInstance = botInstance;
}

// Initialize database and start bot
initializeSellAdminDatabase();
sellAdminBot.launch();

console.log('🤖 Sell Admin Bot is running...');

export {
    notifyNewPayoutRequest,
    createPayoutRequest,
    broadcastToSellAdmins,
    setMainBotReference
};