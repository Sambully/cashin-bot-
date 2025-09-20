//const { Telegraf, Markup } = require('telegraf');
//const axios = require('axios');
//const { authenticator } = require('otplib');
//const fs = require('fs');
//const path = require('path');
//const crypto = require('crypto');
//const qrcode = require('qrcode');
//const qs = require('querystring');
//const { v4: uuidv4 } = require('uuid');
//const express = require('express');
//const { broadcastBuyTransaction, calculateTotalWithCommission } = require('./buy-admin-bot.js');



// ccc.js (ESM version)
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { authenticator } from 'otplib';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import qrcode from 'qrcode';
import qs from 'querystring';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import { broadcastBuyTransaction, calculateTotalWithCommission } from './buy-admin-bot.js';

import { fileURLToPath } from 'url';
//import path from 'path';

// Add at the top of your file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);





// --- Payout API Configuration (from pay.js) ---
const PAYOUT_API_TOKEN = 'u9BAwSw8YQzs0wSzXTnYWmeiMGHyqkRchhftAtLQs92EianPeLpSX7d4SnpT';
const PAYOUT_CLIENT_ID = 'yashhhshhahaha'; // TODO: User needs to replace this
axios.defaults.timeout = 20000; // 20 seconds timeout for payout API
// --- End Payout API Configuration ---

//const BOT_TOKEN = '7892399402:AAFbZfJAGbkoMmI-kI37Hj7gor16J2PYFiA';
//const SELL_ADMIN = '7793867325:AAGaDUdMQ6-4GxLHirsn0uOj9qOEysanm7U';



//for testing 
const BOT_TOKEN = '7961037186:AAGUH8ts_WzvX9zwIOhimhqqIiq8urTKO4k';
const SELL_ADMIN = '7548678315:AAE9l-Te_SX4HNFVnSRik35ezc-3aM7Mfd8';
const UPI_TRANSACTION_LIMIT = 10000;

const CUSTOMER_CARE_NUMBER = '9102450063';
const CUSTOMER_CARE_TELEGRAM = '@bot\\_querry';
const ERROR_SUFFIX = `\n\nFor help message or call our customer care on whatsapp 
${CUSTOMER_CARE_NUMBER}
Telegram 
${CUSTOMER_CARE_TELEGRAM}`;


const SECRET_KEY = 'WMWMHAI5WPEHOKSAM3FELH4B5BOD4KSN';

const DB_FILE_PATH = path.join(__dirname, 'vouchers_db.json');
const USERS_DB_PATH = path.join(__dirname, 'users_db.json');
const RATE_LIMIT_DB_PATH = path.join(__dirname, 'rate_limit_db.json');
const PAYMENTS_DB_PATH = path.join(__dirname, 'payments_db.json');
const ADMIN_DB_PATH = path.join(__dirname, 'admin_db.json');

const BANNED_USERS_DB_PATH = path.join(__dirname, 'banned_users_db.json');

const RATE_LIMIT = {
    windowMs: 60 * 1000,
    maxRequests: 3,
};
authenticator.options = {
    digits: 6,
    period: 30
};
const bot = new Telegraf(BOT_TOKEN);
const ongoingOperations = new Map();
const userStates = new Map();

function initializeDatabase() {
    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(DB_FILE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Initialize each database file with proper error handling
        const databases = [
            { path: DB_FILE_PATH, defaultData: { usedVouchers: [] } },
            { path: USERS_DB_PATH, defaultData: { users: [], admins: [] } },
            { path: RATE_LIMIT_DB_PATH, defaultData: { requests: {} } },
            { path: PAYMENTS_DB_PATH, defaultData: { pendingPayments: [], completedPayments: [] } },
            { path: ADMIN_DB_PATH, defaultData: { adminChatIds: [] } },
            { path: BANNED_USERS_DB_PATH, defaultData: { bannedUsers: [] } }
        ];

        for (const db of databases) {
            if (!fs.existsSync(db.path)) {
                fs.writeFileSync(db.path, JSON.stringify(db.defaultData, null, 2), 'utf8');
                console.log(`Created database file: ${db.path}`);
            }
        }

        console.log('All databases initialized successfully');
    } catch (error) {
        console.error('Error initializing databases:', error);
        // Don't throw the error, just log it and continue
    }
}

// Load database with better error handling
function loadDatabase(dbPath) {
    try {
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            return JSON.parse(data);
        }
        // If file doesn't exist, return default data
        return null;
    } catch (error) {
        console.error(`Error loading database from ${dbPath}:`, error.message);
        return null;
    }
}

// Save to database with better error handling
function saveToDatabase(data, dbPath) {
    try {
        // Create directory if it doesn't exist
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

// Check if voucher has been used
function isVoucherUsed(voucherCode) {
    const db = loadDatabase(DB_FILE_PATH) || { usedVouchers: [] };
    return db.usedVouchers.some(voucher => voucher.code === voucherCode);
}

// Mark voucher as used
function markVoucherAsUsed(voucherCode, cardInfo) {
    const db = loadDatabase(DB_FILE_PATH) || { usedVouchers: [] };
    db.usedVouchers.push({
        code: voucherCode,
        usedAt: new Date().toISOString(),
        cardId: cardInfo.card_id,
        amount: cardInfo.balance,
        currency: cardInfo.currency
    });
    return saveToDatabase(db, DB_FILE_PATH);
}

// Rate limiter
function isRateLimited(userId) {
    const rateDB = loadDatabase(RATE_LIMIT_DB_PATH) || { requests: {} };
    const now = Date.now();

    // Clean up old entries
    Object.keys(rateDB.requests).forEach(id => {
        rateDB.requests[id] = rateDB.requests[id].filter(
            time => time > now - RATE_LIMIT.windowMs
        );
        if (rateDB.requests[id].length === 0) {
            delete rateDB.requests[id];
        }
    });

    // Check current user's rate limit
    if (!rateDB.requests[userId]) {
        rateDB.requests[userId] = [];
    }

    if (rateDB.requests[userId].length >= RATE_LIMIT.maxRequests) {
        saveToDatabase(rateDB, RATE_LIMIT_DB_PATH);
        return true;
    }

    // Add current request
    rateDB.requests[userId].push(now);
    saveToDatabase(rateDB, RATE_LIMIT_DB_PATH);
    return false;
}

// Log user activity
function logUserActivity(userId, username, action, result) {
    const usersDB = loadDatabase(USERS_DB_PATH) || { users: [], admins: [] };

    // Find or create user
    let user = usersDB.users.find(u => u.id === userId);
    if (!user) {
        user = {
            id: userId,
            username: username || `user_${userId}`,
            firstSeen: new Date().toISOString(),
            activities: []
        };
        usersDB.users.push(user);
    }

    // Log activity
    user.activities.push({
        action,
        result,
        timestamp: new Date().toISOString()
    });

    // Limit activity history to last 100 entries
    if (user.activities.length > 100) {
        user.activities = user.activities.slice(-100);
    }

    saveToDatabase(usersDB, USERS_DB_PATH);
}

// Check if a user is banned
function isUserBanned(userId) {
    const db = loadDatabase(BANNED_USERS_DB_PATH) || { bannedUsers: [] };
    return db.bannedUsers.some(user => user.id === userId);
}

// Ban a user
function banUser(userId, username) {
    const db = loadDatabase(BANNED_USERS_DB_PATH) || { bannedUsers: [] };
    if (!db.bannedUsers.some(user => user.id === userId)) {
        db.bannedUsers.push({ id: userId, username: username, bannedAt: new Date().toISOString() });
        return saveToDatabase(db, BANNED_USERS_DB_PATH);
    }
    return false;
}

// Unban a user
function unbanUser(userId) {
    const db = loadDatabase(BANNED_USERS_DB_PATH) || { bannedUsers: [] };
    const initialLength = db.bannedUsers.length;
    db.bannedUsers = db.bannedUsers.filter(user => user.id !== userId);
    if (db.bannedUsers.length < initialLength) {
        return saveToDatabase(db, BANNED_USERS_DB_PATH);
    }
    return false;
}

// Generate current TOTP code
const generateMFACode = () => {
    const code = authenticator.generate(SECRET_KEY);
    console.log('Generated MFA code:', code);
    return code;
};

// Common headers used in all requests
const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Platform': 'WEB_ANDROID',
    'Origin': 'https://panel.icash.one',
    'Referer': 'https://panel.icash.one/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36'
});

// Process voucher cash-in
async function processCashIn(voucherCode, ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;

    try {
        // Check if voucher is already being processed by this user
        if (ongoingOperations.has(userId)) {
            await ctx.reply('⚠️ You already have an ongoing voucher process. Please wait for it to complete.' + ERROR_SUFFIX);
            return;
        }

        // Mark operation as ongoing
        ongoingOperations.set(userId, voucherCode);

        // Check if voucher has already been used
        if (isVoucherUsed(voucherCode)) {
            await ctx.reply('❌ Error: This voucher has already been used and is expired.' + ERROR_SUFFIX);
            logUserActivity(userId, username, 'verify_voucher', 'already_used');
            ongoingOperations.delete(userId);
            return;
        }

        // Show loading message
        const loadingMsg = await ctx.reply('⏳ Processing... Please wait');

        try {
            // Step 1: Initial login
            const loginResponse = await axios.post('https://rb.icash.one/v1/resellers/login', {
                user_name: "icashvouchercashin@gmail.com",
                password: "Automation@880880"
            }, {
                headers: getHeaders()
            });

            const { reseller_id, hash_jwt } = loginResponse.data;

            // Step 2: MFA Verification
            const mfaCode = generateMFACode();

            const mfaResponse = await axios.post('https://rb.icash.one/v1/resellers/login/mfa', {
                mfa_code: mfaCode,
                reseller_id: reseller_id,
                hash_jwt: hash_jwt
            }, {
                headers: getHeaders()
            });

            // Save cookies for subsequent requests
            const cookies = mfaResponse.headers['set-cookie'];
            const sessionToken = cookies.find(cookie => cookie.startsWith('SESSION_TOKEN=')).split(';')[0];

            // Add session token to headers for subsequent requests
            const authHeaders = {
                ...getHeaders(),
                Cookie: sessionToken
            };

            // Step 3: Get reseller info
            const resellerResponse = await axios.get('https://rb.icash.one/v1/resellers', {
                headers: authHeaders
            });

            const resellerInfo = resellerResponse.data;
            const initialBalance = `${resellerInfo.balance_list[0].balance} ${resellerInfo.balance_list[0].currency}`;

            // Step 4: Verify voucher code
            const verifyResponse = await axios.post('https://rb.icash.one/v1/resellers/cards/cashIn/verify/code', {
                code: voucherCode,
                reseller_id: reseller_id
            }, {
                headers: authHeaders
            });

            const cardInfo = verifyResponse.data;

            // Step 5: Complete cash-in process
            const newMfaCode = generateMFACode();

            const cashInResponse = await axios.post('https://rb.icash.one/v1/resellers/cards/cashIn/code', {
                code: voucherCode,
                reseller_id: reseller_id,
                mfa_code: newMfaCode
            }, {
                headers: authHeaders
            });

            const cashInResult = cashInResponse.data;

            markVoucherAsUsed(voucherCode, cardInfo);
            await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id);
            const successMessage = `✅ Cash-in Successful!\n\n` +
                `💰 Voucher Amount: ${cashInResult.card_amount} ${cashInResult.card_currency}\n` +
                `💼 Credited Amount: ${cashInResult.reseller_amount} ${cashInResult.reseller_currency}\n` +
                `💬 Message: ${cashInResult.message}\n` +
                `🙏 Thank you for using our service!`;

            await ctx.reply(successMessage);
            logUserActivity(userId, username, 'cash_in', 'success');
            
            // Start payout flow instead of payment collection
            userStates.set(userId, {
                stage: 'payout_upi_id',
                voucherDetails: cardInfo,
                payoutDetails: {}
            });
            await ctx.reply('💸 To complete the transaction, please enter your UPI ID:');


        } catch (verifyError) {

            await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id);

            let errorMessage = '❌ Error verifying voucher code:\n';
            if (verifyError.response && verifyError.response.data) {
                errorMessage += `- ${verifyError.response.data.message}\n`;
                errorMessage += `- Error code: ${verifyError.response.data.error}`;
            } else {
                errorMessage += verifyError.message;
            }

            await ctx.reply(errorMessage + ERROR_SUFFIX);
            logUserActivity(userId, username, 'verify_voucher', 'failed');
        }

    } catch (error) {
        console.error('❌ Error processing voucher:', {
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            userId,
            username,
            voucherCode
        });
        
        let errorMessage = '❌ Error during processing:\n';

        if (error.response) {
            errorMessage += `- Status: ${error.response.status}\n`;
            if (error.response.data && error.response.data.message) {
                errorMessage += `- ${error.response.data.message}`;
            }
        } else {
            errorMessage += error.message;
        }

        await ctx.reply(errorMessage + ERROR_SUFFIX);
        logUserActivity(userId, username, 'process_voucher', 'error');
    } finally {
        // Mark operation as complete
        console.log("🧹 Cleaning up ongoing operation for user:", userId);
        ongoingOperations.delete(userId);
    }
}

// Initialize databases
initializeDatabase();

// Welcome message
bot.command('start', async (ctx) => {
    const userId = ctx.from.id;

    if (isUserBanned(userId)) {
        return ctx.reply('❌ You are banned from using this bot.');
    }

    const username = ctx.from.username;

    // Log user activity
    logUserActivity(userId, username, 'start_bot', 'success');

    const welcomeMessage = `👋 Welcome to the iCash Voucher Bot!\n\n` +
        `Please select an option:`;

    await ctx.reply(welcomeMessage, Markup.inlineKeyboard([
        [Markup.button.callback('💸 Sell Voucher', 'action:sell')],
        [Markup.button.callback('💰 Buy Voucher', 'action:buy')]
    ]));
});

bot.command('buyhelp', async (ctx) => {
    const buyHelpMessage = `*How to Buy a Voucher*\n\n` +
        `1. Start by selecting "Buy Voucher".\n` +
        `2. Enter the desired voucher amount in INR.\n` +
        `3. Provide your email address to receive the voucher.\n` +
        `4. You will see a summary of your order, including any service charges.\n` +
        `5. Click the payment link to complete your purchase.\n` +
        `6. Once the payment is successful, the voucher will be sent to your email.\n\n` +
        `For further assistance, please contact our customer care:\nWhatsApp: ${CUSTOMER_CARE_NUMBER}\nTelegram: ${CUSTOMER_CARE_TELEGRAM}`;
    await ctx.replyWithMarkdown(buyHelpMessage);
});

bot.command('sellhelp', async (ctx) => {
    const sellHelpMessage = `*How to Sell a Voucher*\n\n` +
        `1. Start by selecting "Sell Voucher".\n` +
        `2. Send your iCash voucher code directly in the chat.\n` +
        `   (Example: iCash_25Q6xFiLPVwgSIkz2WLiODlLz3hvp2Kj)\n` +
        `3. The bot will process the voucher and show you the amount.\n` +
        `4. Enter your UPI ID and mobile number to receive the payment.\n` +
        `5. A 10% service charge and a small payout fee will be deducted.\n` +
        `6. The final amount will be transferred to your UPI.\n\n` +
        `For further assistance, please contact our customer care:\nWhatsApp: ${CUSTOMER_CARE_NUMBER}\nTelegram: ${CUSTOMER_CARE_TELEGRAM}`;
    await ctx.replyWithMarkdown(sellHelpMessage);
});

bot.command('customercare', async (ctx) => {
    const careMessage = `*Customer Care*\n\n` +
        `You can reach us via:\n` +
        `WhatsApp: ${CUSTOMER_CARE_NUMBER}\n` +
        `Telegram: ${CUSTOMER_CARE_TELEGRAM}`;
    await ctx.replyWithMarkdown(careMessage);
});

// Handle action buttons
bot.action(/action:(.+)/, async (ctx) => {
    const userId = ctx.from.id;
    if (isUserBanned(userId)) {
        await ctx.answerCbQuery('❌ You are banned from using this bot.');
        return ctx.reply('❌ You are banned from using this bot.');
    }

    const action = ctx.match[1];

    if (action === 'sell') {
        const sellMessage = `This bot helps you process iCash vouchers quickly and securely.\n\n` +
            `To cash in a voucher, simply send the voucher code directly.\n\n` +
            `Example: iCash_25Q6xFiLPVwgSIkz2WLiODlLz3hvp2Kj\n\n` +
            `After processing your voucher, you'll be able to receive payment via UPI or Bank Transfer.\n\n` +
            `💸 Note: A 10% service charge and a payout fee (₹10 + GST) will be deducted from the voucher amount.\n\n` +
            `Customer care whatsapp no ${CUSTOMER_CARE_NUMBER}`;

        await ctx.editMessageText(sellMessage);
        // Clear any existing user state when switching to sell flow
        userStates.delete(ctx.from.id);
    } else if (action === 'buy') {
        // Store user state for buy flow
        userStates.set(ctx.from.id, {
            stage: 'amount',
            buyDetails: {}
        });

        await ctx.editMessageText('💰 Please enter the amount for the voucher (in INR):');
    }

    await ctx.answerCbQuery();
});

// Help command
bot.command('help', async (ctx) => {
    const helpMessage = `❓ *iCash Voucher Bot Help*\n\n` +
        `To cash in a voucher, simply send the voucher code directly in the chat.\n\n` +
        `*Valid voucher format:* iCash_XXXXXXXXXXXXXXXXXXXXXXXXXX\n\n` +
        `*Payment Process:*\n` +
        `1. Submit your voucher code\n` +
        `2. Choose payment method (UPI or Bank Transfer)\n` +
        `3. Provide your payment details\n` +
        `4. Wait for admin approval and payment processing\n\n` +
        `Customer care whatsapp no ${CUSTOMER_CARE_NUMBER}`;

    await ctx.replyWithMarkdown(helpMessage);
});

// Handle text messages
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return; // Skip commands

    const userId = ctx.from.id;

    if (isUserBanned(userId)) {
        return ctx.reply('❌ You are banned from using this bot.');
    }

    const userState = userStates.get(userId);

    // If no user state exists, treat as voucher processing (Sell flow)
    if (!userState) {
        const voucherCode = ctx.message.text.trim();
        if (!voucherCode || !voucherCode.match(/^iCash_[A-Za-z0-9]{32}$/)) {
            if (voucherCode && !voucherCode.startsWith('/')) {
                await ctx.reply('❌ Invalid voucher format. Please send a valid iCash voucher code.' + ERROR_SUFFIX);
            }
            return;
        }

        if (isRateLimited(userId)) {
            await ctx.reply('⚠️ Rate limit exceeded. Please try again in a minute.' + ERROR_SUFFIX);
            logUserActivity(userId, ctx.from.username, 'rate_limited', 'blocked');
            return;
        }

        processCashIn(voucherCode, ctx);
        return;
    }

    // Handle buy flow
    if (userState.stage === 'amount') {
        let amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('❌ Please enter a valid amount greater than 0.' + ERROR_SUFFIX);
            return;
        }
        // If amount is less than 200, add 1000
        if (amount < 2) {
            amount += 1000;
            await ctx.reply(`Entered amount is less than ₹200. ₹1000 has been added. New amount: ₹${amount}`);
        }
        userState.buyDetails.amount = amount;
        userState.stage = 'email';
        userStates.set(userId, userState);

        await ctx.reply('📧 Please enter your email address:');
    }
    else if (userState.stage === 'email') {
        const email = ctx.message.text.trim();
        if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            await ctx.reply('❌ Please enter a valid email address.' + ERROR_SUFFIX);
            return;
        }

        userState.buyDetails.email = email;

        // Calculate commission for this email
        const commissionData = calculateTotalWithCommission(userState.buyDetails.amount, email);

        // Update user state with commission details
        userState.buyDetails.baseAmount = commissionData.baseAmount;
        userState.buyDetails.commissionPercentage = commissionData.commissionPercentage;
        userState.buyDetails.commissionAmount = commissionData.commissionAmount;
        userState.buyDetails.finalAmount = commissionData.totalAmount;

        userStates.set(userId, userState);







        try {
            // Show commission breakdown to user
            let commissionMessage = `💳 Payment Details:\n\n` +
                `📧 Email: ${email}\n` +
                `💰 Voucher Amount: ₹${commissionData.baseAmount}\n`;

            if (commissionData.commissionPercentage > 0) {
                commissionMessage += `📊 Service charge (${commissionData.commissionPercentage}%): ₹${commissionData.commissionAmount.toFixed(2)}\n` +
                    `💳 Total Amount: ₹${commissionData.totalAmount.toFixed(2)}\n\n`;
            } else {
                commissionMessage += `💳 Total Amount: ₹${commissionData.totalAmount.toFixed(2)}\n` +
                    `🎉 No service charge applicable for your email!\n\n`;
            }

            // Generate payment link with final amount
            const token = await getPayUToken();
            const invoiceNumber = uuidv4();
            const paymentLink = await createPaymentLink(
                token,
                commissionData.totalAmount,
                invoiceNumber,
                userId
            );

            if (!paymentLink) {
                throw new Error('Failed to generate payment link');
            }

            // Create payment record for buy transaction with commission details
            const payment = createPaymentRecord(
                userId,
                ctx.from.username,
                {
                    balance: commissionData.totalAmount,
                    currency: 'INR',
                    baseAmount: commissionData.baseAmount,
                    commissionPercentage: commissionData.commissionPercentage,
                    commissionAmount: commissionData.commissionAmount
                },
                {
                    method: 'payu',
                    invoiceNumber,
                    email: userState.buyDetails.email
                }
            );

            console.log('Payment record created with commission:', payment);

            // Store payment ID in user state
            userState.buyDetails.paymentId = payment.id;
            userState.buyDetails.invoiceNumber = invoiceNumber;
            userState.buyDetails.paymentLink = paymentLink;
            userStates.set(userId, userState);

            commissionMessage += `Click the link below to make the payment:\n` +
                `${paymentLink}\n\n` +
                `After successful payment, your voucher will be sent to your email.`;

            await ctx.reply(commissionMessage);

        } catch (error) {
            console.error('Error in buy flow:', error);
            await ctx.reply('❌ An error occurred while processing your request. Please try again later.' + ERROR_SUFFIX);
            userStates.delete(userId);
        }
    }
    // Handle payout flow for sell transactions
    else if (userState.stage === 'payout_upi_id') {
        const upiId = ctx.message.text.trim();
        if (!upiId.match(/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+$/)) {
            await ctx.reply('❌ Invalid UPI ID format. Please enter a valid UPI ID (e.g., yourname@upi):' + ERROR_SUFFIX);
            return;
        }
        userState.payoutDetails.upi_id = upiId;
        userState.stage = 'payout_mobile_number';
        userStates.set(userId, userState);
        await ctx.reply('📱 Please enter your 10-digit mobile number to receive the payment:');
    }
    else if (userState.stage === 'payout_mobile_number') {
        const mobileNumber = ctx.message.text.trim();
        if (!mobileNumber.match(/^\d{10}$/)) {
            await ctx.reply('❌ Invalid mobile number. Please enter a valid 10-digit mobile number.' + ERROR_SUFFIX);
            return;
        }
        userState.payoutDetails.mobile_number = mobileNumber;
        userStates.set(userId, userState);
        await handlePayout(ctx);
    }
     else if (userState.stage === 'payout_registration') {
        const text = ctx.message.text.trim();
        const step = userState.payoutDetails.registrationStep;

        userState.payoutDetails[step] = text;

        const nextStep = {
            'first_name': 'last_name',
            'last_name': 'pin_code',
            'pin_code': 'address'
        };

        if (nextStep[step]) {
            userState.payoutDetails.registrationStep = nextStep[step];
            userStates.set(userId, userState);
            await ctx.reply(`Please enter your ${nextStep[step].replace('_', ' ')}:`);
        } else {
            // All details collected, now register
            await registerAndInitiatePayout(ctx);
        }
    }
    else if (userState.stage === 'payout_otp') {
        const otp = ctx.message.text.trim();
        await confirmSenderAndPayout(ctx, otp);
    }
});

bot.catch((err, ctx) => {
    console.error('❌ Bot error:', {
        error: err.message,
        stack: err.stack,
        userId: ctx?.from?.id,
        chatId: ctx?.chat?.id,
        username: ctx?.from?.username
    });
    
    try {
        ctx.reply('❌ An error occurred while processing your request. Please try again later.' + ERROR_SUFFIX);
    } catch (replyError) {
        console.error('❌ Error sending error message to user:', replyError.message);
    }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Bot started! Press Ctrl+C to exit.');

function createPaymentRecord(userId, username, voucherDetails, paymentDetails) {
    const db = loadDatabase(PAYMENTS_DB_PATH) || { pendingPayments: [], completedPayments: [] };

    let voucherAmount, paymentAmount;

    if (paymentDetails.method === 'payu') {
        // For buy transactions: use baseAmount for voucher, total amount for payment
        voucherAmount = parseFloat(voucherDetails.baseAmount || voucherDetails.amount);
        paymentAmount = parseFloat(voucherDetails.balance || voucherDetails.amount);
    } else {
        // For sell transactions: use original logic
        voucherAmount = parseFloat(voucherDetails.balance || voucherDetails.amount);
        paymentAmount = voucherAmount * 0.9;
    }

    const paymentId = crypto.randomUUID();

    const payment = {
        id: paymentId,
        userId: userId.toString(),
        username,
        voucherDetails,
        paymentDetails,
        voucherAmount,
        paymentAmount,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    console.log('Creating payment record:', payment);

    db.pendingPayments.push(payment);
    saveToDatabase(db, PAYMENTS_DB_PATH);

    // Broadcast to buy admin bot if this is a buy transaction
    if (paymentDetails.method === 'payu') {
        console.log('Calling broadcastBuyTransaction for new buy transaction:', payment.id);
        broadcastBuyTransaction(payment, 'new');
    }

    return payment;
}

function updatePaymentStatus(paymentId, status) {
    const db = loadDatabase(PAYMENTS_DB_PATH) || { pendingPayments: [], completedPayments: [] };

    const paymentIndex = db.pendingPayments.findIndex(p => p.id === paymentId);
    if (paymentIndex === -1) return false;

    const payment = db.pendingPayments[paymentIndex];
    payment.status = status;

    if (status === 'completed') {
        payment.completedAt = new Date().toISOString();
        db.completedPayments.push(payment);
        db.pendingPayments.splice(paymentIndex, 1);
    }

    saveToDatabase(db, PAYMENTS_DB_PATH);
    return payment;
}

async function generateUpiQrCode(upiId, amount, description) {
    const upiUrl = `upi://pay?pa=${upiId}&pn=iCashVoucher&am=${amount}&cu=INR&tn=${encodeURIComponent(description)}`;

    try {
        return await qrcode.toDataURL(upiUrl);
    } catch (error) {
        console.error('Error generating QR code:', error);
        return null;
    }
}

// Admin bot setup
const adminBot = new Telegraf(SELL_ADMIN);

// Initialize admin database
function initializeAdminDatabase() {
    if (!fs.existsSync(ADMIN_DB_PATH)) {
        fs.writeFileSync(ADMIN_DB_PATH, JSON.stringify({
            adminChatIds: []
        }, null, 2));
    }
}

// Admin registration
adminBot.command('register', async (ctx) => {
    const adminDb = loadDatabase(ADMIN_DB_PATH) || { adminChatIds: [] };
    const chatId = ctx.chat.id;

    if (!adminDb.adminChatIds.includes(chatId)) {
        adminDb.adminChatIds.push(chatId);
        saveToDatabase(adminDb, ADMIN_DB_PATH);
        await ctx.reply('✅ You are now registered as an admin for payment approvals.');
    } else {
        await ctx.reply('ℹ️ You are already registered as an admin.');
    }
});

// Admin unregistration
adminBot.command('unregister', async (ctx) => {
    const adminDb = loadDatabase(ADMIN_DB_PATH) || { adminChatIds: [] };
    const chatId = ctx.chat.id;

    const index = adminDb.adminChatIds.indexOf(chatId);
    if (index !== -1) {
        adminDb.adminChatIds.splice(index, 1);
        saveToDatabase(adminDb, ADMIN_DB_PATH);
        await ctx.reply('❌ You have been unregistered as an admin.');
    } else {
        await ctx.reply('ℹ️ You were not registered as an admin.');
    }
});

// Admin help command
adminBot.command('help', async (ctx) => {
    await ctx.reply(
        '💼 *Admin Bot Commands*\n\n' +
        '/register - Register as payment admin\n' +
        '/unregister - Remove yourself as admin\n' +
        '/help - Show this help message\n\n' +
        'As an admin, you will receive payment approval requests and can approve payments with the provided buttons.',
        { parse_mode: 'Markdown' }
    );
});

// Helper function to get user ID from username
async function getUserIdByUsername(username) {
    const usersDB = loadDatabase(USERS_DB_PATH) || { users: [] };
    const user = usersDB.users.find(u => u.username === username.replace('@', ''));
    return user ? user.id : null;
}

// Ban command
adminBot.command('ban', async (ctx) => {
    const adminDb = loadDatabase(ADMIN_DB_PATH) || { adminChatIds: [] };
    if (!adminDb.adminChatIds.includes(ctx.chat.id)) {
        return ctx.reply('❌ You are not authorized to use this command.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Usage: /ban <user_id or @username>');
    }

    const target = args[1];
    let targetUserId;
    let targetUsername = 'N/A';

    if (target.startsWith('@')) {
        targetUsername = target.replace('@', '');
        targetUserId = await getUserIdByUsername(targetUsername);
        if (!targetUserId) {
            return ctx.reply(`❌ Could not find user ${target}. They may need to interact with the main bot first.`);
        }
    } else {
        targetUserId = parseInt(target, 10);
        if (isNaN(targetUserId)) {
            return ctx.reply('❌ Invalid user ID.');
        }
    }

    if (banUser(targetUserId, targetUsername)) {
        await ctx.reply(`✅ User ${target} has been banned.`);
    } else {
        await ctx.reply(`ℹ️ User ${target} is already banned.`);
    }
});

// Unban command
adminBot.command('unban', async (ctx) => {
    const adminDb = loadDatabase(ADMIN_DB_PATH) || { adminChatIds: [] };
    if (!adminDb.adminChatIds.includes(ctx.chat.id)) {
        return ctx.reply('❌ You are not authorized to use this command.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Usage: /unban <user_id or @username>');
    }

    const target = args[1];
    let targetUserId;

    if (target.startsWith('@')) {
        const targetUsername = target.replace('@', '');
        targetUserId = await getUserIdByUsername(targetUsername);
        if (!targetUserId) {
            return ctx.reply(`❌ Could not find user ${target}.`);
        }
    } else {
        targetUserId = parseInt(target, 10);
        if (isNaN(targetUserId)) {
            return ctx.reply('❌ Invalid user ID.');
        }
    }

    if (unbanUser(targetUserId)) {
        await ctx.reply(`✅ User ${target} has been unbanned.`);
    } else {
        await ctx.reply(`ℹ️ User ${target} was not found in the banned list.`);
    }
});


// Function to broadcast messages to all registered admins
async function broadcastToSellAdmins(message) {
    const adminDb = loadDatabase(ADMIN_DB_PATH) || { adminChatIds: [] };
    if (adminDb.adminChatIds && adminDb.adminChatIds.length > 0) {
        console.log(`Broadcasting to ${adminDb.adminChatIds.length} sell admins.`);
        for (const chatId of adminDb.adminChatIds) {
            try {
                await adminBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error(`Failed to send message to admin ${chatId}:`, error);
            }
        }
    }
}

// Handle approve button clicks for BUY transactions (No longer for sell)
adminBot.action(/approve:(.+)/, async (ctx) => {
    const paymentId = ctx.match[1];
    const payment = updatePaymentStatus(paymentId, 'completed');

    if (!payment) {
        return ctx.reply('❌ Payment not found or already processed.');
    }

    // This approval is now only for BUY transactions, so we don't notify users here.
    // User notification for BUY happens on webhook success.
    await ctx.editMessageReplyMarkup({
        inline_keyboard: [
            [{ text: '✅ BUY Order Approved', callback_data: `approved:${payment.id}` }]
        ]
    });

    await ctx.answerCbQuery('Buy order payment approved successfully!');
});

// Start admin bot
adminBot.launch();
process.once('SIGINT', () => adminBot.stop('SIGINT'));
process.once('SIGTERM', () => adminBot.stop('SIGTERM'));

// --- Payout API Functions (from pay.js) ---

// Step 1: Check if customer exists
async function payoutCheckCustomer(mobile_number) {
    console.log("🚀 Making API call to check customer...");
    console.log("📋 Customer Check Details:", { mobile_number });
    
    try {
        const res = await axios.post('https://banking.mytpipay.com/api/upi-transfer/v1/get-customer', {
            api_token: PAYOUT_API_TOKEN,
            mobile_number,
            latitude: '28.6139',
            longitude: '77.2090'
        });
        
        console.log("📡 Customer Check API Response:", res.data);
        
        if (res.data.status === 'failure') {
            console.error("❌ Customer Check Failed:", {
                status: res.data.status,
                message: res.data.message
            });
        } else if (res.data.status === 'success') {
            console.log("✅ Customer Check Successful:", {
                status: res.data.status,
                message: res.data.message
            });
        }
        
        return res.data;
    } catch (error) {
        console.error("❌ Customer Check API Error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText,
            code: error.code
        });
        
        if (error.code === 'ECONNABORTED') {
            console.error("⏰ Request timed out");
        }
        
        throw error;
    }
}

// Step 2: Add sender if not exists
async function payoutAddSender(details) {
    console.log("🚀 Making API call to add sender...");
    const { mobile_number, first_name, last_name, pin_code, address } = details;
    
    console.log("📋 Add Sender Details:", {
        mobile_number,
        first_name,
        last_name,
        pin_code,
        address: address ? '***' : 'not provided'
    });
    
    try {
        const res = await axios.post('https://banking.mytpipay.com/api/upi-transfer/v1/add-sender', {
            api_token: PAYOUT_API_TOKEN,
            mobile_number,
            first_name,
            last_name,
            pin_code,
            address,
            latitude: '28.6139',
            longitude: '77.2090'
        });
        
        console.log("📡 Add Sender API Response:", res.data);
        
        if (res.data.status === 'failure') {
            console.error("❌ Add Sender Failed:", {
                status: res.data.status,
                message: res.data.message
            });
        } else if (res.data.status === 'success') {
            console.log("✅ Add Sender Successful:", {
                status: res.data.status,
                message: res.data.message,
                otp: res.data.otp,
                state: res.data.state
            });
        }
        
        return res.data;
    } catch (error) {
        console.error("❌ Add Sender API Error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });
        throw error;
    }
}

// Step 3: Confirm OTP
async function payoutConfirmSender(mobile_number, otp, state) {
    console.log("🚀 Making API call to confirm sender...");
    console.log("📋 Confirm Sender Details:", {
        mobile_number,
        otp: '***',
        state
    });
    
    try {
        const res = await axios.post('https://banking.mytpipay.com/api/upi-transfer/v1/sender-confirmation', {
            api_token: PAYOUT_API_TOKEN,
            mobile_number,
            otp,
            state,
            latitude: '28.6139',
            longitude: '77.2090'
        });
        
        console.log("📡 Confirm Sender API Response:", res.data);
        
        if (res.data.status === 'failure') {
            console.error("❌ Confirm Sender Failed:", {
                status: res.data.status,
                message: res.data.message
            });
        } else if (res.data.status === 'success') {
            console.log("✅ Confirm Sender Successful:", {
                status: res.data.status,
                message: res.data.message
            });
        }
        
        return res.data;
    } catch (error) {
        console.error("❌ Confirm Sender API Error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });
        throw error;
    }
}

// Step 4: Fetch UPI name
async function payoutFetchUpiName(upi_id) {
    console.log("🚀 Making API call to fetch UPI name...");
    console.log("📋 Fetch UPI Details:", { upi_id });
    
    try {
        const res = await axios.post('https://banking.mytpipay.com/api/upi-transfer/v1/fetch-upi', {
            api_token: PAYOUT_API_TOKEN,
            upi_id,
            client_id: PAYOUT_CLIENT_ID
        });
        
        console.log("📡 Fetch UPI API Response:", res.data);
        
        if (res.data.status === 'failure') {
            console.error("❌ Fetch UPI Failed:", {
                status: res.data.status,
                message: res.data.message
            });
        } else if (res.data.status === 'success') {
            console.log("✅ Fetch UPI Successful:", {
                status: res.data.status,
                beneficiary_name: res.data.beneficiary_name,
                message: res.data.message
            });
        }
        
        return res.data;
    } catch (error) {
        console.error("❌ Fetch UPI API Error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });
        throw error;
    }
}

// Step 5: Transfer money
async function payoutTransferMoney(mobile_number, name, upi_id, amount) {
    console.log("🚀 Making API call to transfer money...");
    console.log("📋 Transfer Details:", {
        mobile_number,
        name,
        upi_id,
        amount,
        client_id: PAYOUT_CLIENT_ID
    });
    
    try {
        const res = await axios.post('https://banking.mytpipay.com/api/upi-transfer/v1/transfer', {
            api_token: PAYOUT_API_TOKEN,
            mobile_number,
            name,
            upi_id,
            amount,
            client_id: PAYOUT_CLIENT_ID
        });
        
        console.log("📡 Transfer API Response:", res.data);
        
        if (res.data.status === 'failure') {
            console.error("❌ Transfer Failed:", {
                status: res.data.status,
                message: res.data.message,
                operator_ref: res.data.operator_ref,
                payid: res.data.payid
            });
        } else if (res.data.status === 'success') {
            console.log("✅ Transfer Successful:", {
                status: res.data.status,
                operator_ref: res.data.operator_ref,
                message: res.data.message
            });
        }
        
        return res.data;
    } catch (error) {
        console.error("❌ Transfer API Error:", {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            statusText: error.response?.statusText
        });
        throw error;
    }
}


// --- End Payout API Functions ---

async function handlePayout(ctx) {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);
    const { mobile_number } = userState.payoutDetails;

    console.log("🔄 Starting payout process for user:", userId);
    console.log("📋 Payout Details:", {
        mobile_number,
        stage: userState.stage
    });

    try {
        const customerCheck = await payoutCheckCustomer(mobile_number);

        if (customerCheck.status === 'success') {
            console.log("✅ Customer exists, proceeding to transfer");
            await initiateTransfer(ctx);
        } else {
            console.log("❌ Customer does not exist, starting registration flow");
            // Customer does not exist, start registration flow
            userState.stage = 'payout_registration';
            userState.payoutDetails.registrationStep = 'first_name';
            userStates.set(userId, userState);
            await ctx.reply('You are not registered for payouts. Let\'s set you up.\nPlease enter your first name:');
        }
    } catch (error) {
        console.error('❌ Error during payout customer check:', {
            error: error.message,
            response: error.response?.data,
            userId,
            mobile_number
        });
        await ctx.reply('❌ An error occurred while checking your details. Please try again later.' + ERROR_SUFFIX);
        userStates.delete(userId);
    }
}

async function registerAndInitiatePayout(ctx) {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);

    console.log("🔄 Starting registration process for user:", userId);
    console.log("📋 Registration Details:", {
        mobile_number: userState.payoutDetails.mobile_number,
        first_name: userState.payoutDetails.first_name,
        last_name: userState.payoutDetails.last_name,
        pin_code: userState.payoutDetails.pin_code
    });

    try {
        const senderDetails = await payoutAddSender(userState.payoutDetails);
        console.log('📡 Sender registration response:', senderDetails);

        if (senderDetails.otp === 1) {
            console.log("📱 OTP required for registration, proceeding to OTP verification");
            userState.stage = 'payout_otp';
            userState.payoutDetails.state = senderDetails.state;
            userStates.set(userId, userState);
            await ctx.reply('🔐 Please enter the OTP sent to your mobile to complete registration:');
        } else {
            console.log("✅ Registration completed without OTP, proceeding to transfer");
            // Already registered or no OTP needed
            await initiateTransfer(ctx);
        }
    } catch (error) {
        console.error('❌ Error during sender registration:', {
            error: error.message,
            response: error.response?.data,
            userId,
            mobile_number: userState.payoutDetails.mobile_number
        });
        await ctx.reply('❌ An error occurred during registration. Please check your details and try again.' + ERROR_SUFFIX);
        userStates.delete(userId);
    }
}

async function confirmSenderAndPayout(ctx, otp) {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);
    const { mobile_number, state } = userState.payoutDetails;

    console.log("🔄 Starting OTP confirmation for user:", userId);
    console.log("📋 OTP Details:", {
        mobile_number,
        state,
        otp: '***'
    });

    try {
        const confirmation = await payoutConfirmSender(mobile_number, otp, state);
        console.log('📡 Sender confirmation response:', confirmation);

        if (confirmation.status === 'success') {
            console.log("✅ OTP confirmation successful, proceeding to transfer");
            await ctx.reply('✅ Registration successful!');
            await initiateTransfer(ctx);
        } else {
            console.error("❌ OTP confirmation failed:", {
                status: confirmation.status,
                message: confirmation.message
            });
            await ctx.reply(`❌ OTP confirmation failed: ${confirmation.message}. Please start over.` + ERROR_SUFFIX);
            userStates.delete(userId);
        }
    } catch (error) {
        console.error('❌ Error during OTP confirmation:', {
            error: error.message,
            response: error.response?.data,
            userId,
            mobile_number
        });
        await ctx.reply('❌ An error occurred during OTP confirmation. Please try again.' + ERROR_SUFFIX);
        userStates.delete(userId);
    }
}


async function initiateTransfer(ctx) {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);
    const { upi_id, mobile_number } = userState.payoutDetails;
    const voucherAmount = parseFloat(userState.voucherDetails.balance);

    // Calculate 10% service charge
    const serviceCharge = voucherAmount * 0.10;

    // Calculate payout charge (10rs + 18% GST)
    const payoutFee = 10;
    const gstRate = 0.18; // 18% GST
    const gstOnPayoutFee = payoutFee * gstRate;
    const totalPayoutCharge = payoutFee + gstOnPayoutFee;

    // Calculate final amount
    const finalAmount = voucherAmount - serviceCharge - totalPayoutCharge;

    // Ensure amount is not negative and remove decimal part for the API
    let totalAmountToPay = Math.floor(Math.max(0, finalAmount));


    console.log("🔄 Starting transfer process for user:", userId);
    console.log("📋 Transfer Details:", {
        upi_id,
        mobile_number,
        voucherAmount: voucherAmount.toFixed(2),
        serviceCharge: serviceCharge.toFixed(2),
        payoutCharge: totalPayoutCharge.toFixed(2),
        totalAmountToPay
    });

    const deductionMessage = `💸 Payment Calculation:\n\n` +
        `Voucher Amount: ₹${voucherAmount.toFixed(2)}\n` +
        `Service Charge (10%): -₹${serviceCharge.toFixed(2)}\n` +
        `Payout Fee (₹10 + ${gstRate * 100}% GST): -₹${totalPayoutCharge.toFixed(2)}\n` +
        `----------------------------------\n` +
        `Final Payout Amount: ₹${totalAmountToPay}\n\n` +
        `⏳ Verifying UPI and initiating payment...`;

    await ctx.reply(deductionMessage);

    let allTransactionsSuccessful = true;
    let totalAmountPaid = 0;

    try {
        const upiCheck = await payoutFetchUpiName(upi_id);
        console.log('📡 UPI check response:', upiCheck);

        if (upiCheck.status === 'success') {
            const beneficiaryName = upiCheck.beneficiary_name;
            console.log("✅ UPI ID verified successfully:", beneficiaryName);
            await ctx.reply(`✅ UPI ID verified. Beneficiary: ${beneficiaryName}`);

            // Split payout if it exceeds the limit
            if (totalAmountToPay > UPI_TRANSACTION_LIMIT) {
                const transactions = [];
                let remainingAmount = totalAmountToPay;

                while (remainingAmount > 0) {
                    const amountToSend = Math.min(remainingAmount, UPI_TRANSACTION_LIMIT);
                    transactions.push(amountToSend);
                    remainingAmount -= amountToSend;
                }

                await ctx.reply(`Total payout of ₹${totalAmountToPay} will be split into ${transactions.length} transactions due to UPI limits.`);

                for (let i = 0; i < transactions.length; i++) {
                    const amount = transactions[i];
                    await ctx.reply(`Processing transaction ${i + 1} of ${transactions.length} for ₹${amount}...`);
                    const transfer = await payoutTransferMoney(mobile_number, beneficiaryName, upi_id, amount);

                    if (transfer.status === 'success') {
                        totalAmountPaid += amount;
                        await ctx.reply(`✅ Transaction ${i + 1} successful! ₹${amount} sent. Transaction ID: ${transfer.operator_ref}`);
                        // Optionally log this transaction to admin
                        const partialSuccessMessage = `✅ *Successful Partial Payout (Sell Transaction)*\n\n` +
                            `👤 *User:* ${ctx.from.username ? `@${ctx.from.username}` : userId}\n` +
                            `*Amount Paid:* ₹${amount} (Part ${i + 1}/${transactions.length})\n` +
                            `*Total Paid So Far:* ₹${totalAmountPaid}\n`+
                            `*UPI ID:* \`${upi_id}\`\n` +
                            `*UTR/RRN:* \`${transfer.operator_ref}\``;
                        await broadcastToSellAdmins(partialSuccessMessage);

                    } else {
                        allTransactionsSuccessful = false;
                        await ctx.reply(`❌ Transaction ${i + 1} for ₹${amount} failed: ${transfer.message}. Please contact support for the remaining amount of ₹${totalAmountToPay - totalAmountPaid}.` + ERROR_SUFFIX);
                        const partialFailureMessage = `❌ *Failed Partial Payout (Sell Transaction)*\n\n` +
                            `👤 *User:* ${ctx.from.username ? `@${ctx.from.username}` : userId}\n` +
                            `*Amount Failed:* ₹${amount} (Part ${i + 1}/${transactions.length})\n` +
                             `*Total Paid So Far:* ₹${totalAmountPaid}\n` +
                            `*Total Owed:* ₹${totalAmountToPay}\n` +
                            `*UPI ID:* \`${upi_id}\`\n` +
                           
                        await broadcastToSellAdmins(partialFailureMessage);

                        // Stop further transactions if one fails
                        break;
                    }
                }

            } else {
                // Single transaction
                const transfer = await payoutTransferMoney(mobile_number, beneficiaryName, upi_id, totalAmountToPay);
                console.log('📡 Transfer response:', transfer);

                if (transfer.status === 'success') {
                    totalAmountPaid = totalAmountToPay;
                    console.log("✅ Transfer completed successfully:", {
                        operator_ref: transfer.operator_ref,
                        amount: totalAmountToPay,
                        upi_id
                    });
                    await ctx.reply(
                        `✅ Payment Successful!\n\n` +
                        `₹${totalAmountToPay} has been sent to ${upi_id}.\n` +
                        `Transaction ID: ${transfer.operator_ref}\n\n` +
                        `🙏 Thank you for using our service!`
                    );

                    const { voucherDetails, payoutDetails } = userState;
                    const user = ctx.from;
                    const successMessageForAdmin = `✅ *Successful Payout (Sell Transaction)*\n\n` +
                        `👤 *User:* ${user.username ? `@${user.username}` : user.id}\n\n` +
                        `--- *Voucher Details* ---\n` +
                        `*Voucher Amount:* ${voucherDetails.balance} ${voucherDetails.currency}\n\n` +
                        `--- *Payout Details* ---\n` +
                        `*Amount Paid:* ₹${totalAmountToPay}\n` +
                        `*UPI ID:* \`${payoutDetails.upi_id}\`\n` +
                        `*Mobile:* \`${payoutDetails.mobile_number}\`\n\n` +
                        `--- *Transaction* ---\n` +
                        `*UTR/RRN:* \`${transfer.operator_ref}\`\n` +
                        `*Pay ID:* \`${transfer.payid || 'N/A'}\``;

                    await broadcastToSellAdmins(successMessageForAdmin);
                } else {
                    allTransactionsSuccessful = false;
                    console.error("❌ Transfer failed:", {
                        status: transfer.status,
                        message: transfer.message,
                        operator_ref: transfer.operator_ref,
                        payid: transfer.payid
                    });
                    await ctx.reply(`❌ Payment failed: ${transfer.message}` + ERROR_SUFFIX);
                }
            }
        } else {
            allTransactionsSuccessful = false;
            console.error("❌ UPI verification failed:", {
                status: upiCheck.status,
                message: upiCheck.message
            });
            await ctx.reply(`❌ Could not verify UPI ID: ${upiCheck.message}. Please check the UPI ID and try again.` + ERROR_SUFFIX);
        }
    } catch (error) {
        allTransactionsSuccessful = false;
        console.error('❌ Error initiating transfer:', {
            error: error.message,
            response: error.response?.data,
            userId,
            upi_id,
            mobile_number,
            paymentAmount: totalAmountToPay
        });
        await ctx.reply('❌ An error occurred while processing your payment. Please contact support.' + ERROR_SUFFIX);
    } finally {
        if (allTransactionsSuccessful) {
            console.log("🧹 Cleaning up user state for user (success):", userId);
            userStates.delete(userId);
        } else {
            // For partial success or total failure, we don't delete the state.
            // An admin needs to resolve this.
            userState.stage = 'payout_failed';
            userState.payoutDetails.totalAmountPaid = totalAmountPaid;
            userState.payoutDetails.totalAmountOwed = totalAmountToPay;
            userStates.set(userId, userState);
            
            const remainingAmount = totalAmountToPay - totalAmountPaid;
            if(remainingAmount > 0) {
                await ctx.reply(`ℹ️ Your payout of ₹${totalAmountToPay} could not be fully completed. ₹${totalAmountPaid} was sent successfully. Our team has been notified and will process the remaining amount of ₹${remainingAmount} manually. Please contact support if you have any questions.`);
            }

            console.log("Keeping user state for manual resolution (failure):", userId);
        }
    }
}
// PayU Config
const config = {
    client_id: '33b63154a3f3eab9f8de3d4c4b4cc84208e73186585d65f208a23e1f1f430488',
    client_secret: '27c8cb27b000bf4b523f38a707445038eb444c6bc7df987b205c8c2b1978e7ba',
    scope: 'create_payment_links',
    grant_type: 'client_credentials'
};

const merchantId = '12632859';
const notificationUrl = 'https://4f930feeeb88.ngrok-free.app';

// Get PayU Access Token
async function getPayUToken() {
    try {
        const response = await axios.post(
            'https://accounts.payu.in/oauth/token',
            qs.stringify(config),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting PayU token:', error);
        throw error;
    }
}

// Create Payment Link
async function createPaymentLink(token, amount, invoiceNumber, chatId) {
    try {
        const data = {
            subAmount: amount,
            isPartialPaymentAllowed: false,
            description: "Payment link for voucher",
            source: "API",
            txnid: invoiceNumber,
            notificationUrl: notificationUrl,
            successURL: `https://0447-13-202-51-27.ngrok-free.app/payment-status?chatId=${chatId}`,
            udf1: chatId // Store chatId in udf1 for reference
        };

        const response = await axios.post(
            'https://oneapi.payu.in/payment-links',
            data,
            {
                headers: {
                    'merchantId': merchantId,
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            }
        );

        const result = response.data;
        if (result.status === 0) {
            return result.result.paymentLink;
        }
        return null;
    } catch (error) {
        console.error('Error creating payment link:', error);
        throw error;
    }
}

// Send Voucher
async function sendVoucher(amount, email) {
    try {
        // Step 1: Initial login
        const loginResponse = await axios.post('https://rb.icash.one/v1/resellers/login', {
            user_name: "icashvouchercashin@gmail.com",
            password: "Automation@880880"
        }, {
            headers: getHeaders()
        });

        const { reseller_id, hash_jwt } = loginResponse.data;

        // Step 2: MFA Verification
        const mfaCode = generateMFACode();

        const mfaResponse = await axios.post('https://rb.icash.one/v1/resellers/login/mfa', {
            mfa_code: mfaCode,
            reseller_id: reseller_id,
            hash_jwt: hash_jwt
        }, {
            headers: getHeaders()
        });

        // Save cookies for subsequent requests
        const cookies = mfaResponse.headers['set-cookie'];
        const sessionToken = cookies.find(cookie => cookie.startsWith('SESSION_TOKEN=')).split(';')[0];

        // Add session token to headers for subsequent requests
        const authHeaders = {
            ...getHeaders(),
            Cookie: sessionToken
        };

        // Step 3: Send voucher
        const response = await axios.post('https://rb.icash.one/v1/resellers/funds/cards/assigned', {
            reseller_currency: "INR",
            cards_currency: "INR",
            card_request_list: [
                {
                    amount: amount,
                    quantity: 1
                }
            ],
            email: email,
            not_assigned: false
        }, {
            headers: authHeaders
        });

        console.log('Voucher sent successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending voucher:', error.response?.data || error.message);
        throw error;
    }
}

// Handle payment success webhook
const app = express();

// Configure Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle payment success webhook
app.post('/payment-status', async (req, res) => {
    try {
        console.log('Received payment status webhook:', req.body);

        const { txnid, status, postUrl, mihpayid, amount: paidAmount } = req.body || {};

        if (!txnid) {
            console.error('No transaction ID in webhook payload:', req.body);
            return res.status(400).send('Missing transaction ID');
        }

        // Extract chatId from postUrl
        let targetUserId = null;
        if (postUrl) {
            const url = new URL(postUrl);
            targetUserId = url.searchParams.get('chatId');
        }

        if (!targetUserId) {
            console.error('No user ID found in webhook payload or postUrl');
            return res.status(404).send('User not found');
        }

        console.log('Looking for payment for user:', targetUserId);

        // Load payment from database
        const db = loadDatabase(PAYMENTS_DB_PATH) || { pendingPayments: [], completedPayments: [] };

        // Clean up old pending payments (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const initialCount = db.pendingPayments.length;
        db.pendingPayments = db.pendingPayments.filter(p => new Date(p.createdAt) > oneHourAgo);
        if (db.pendingPayments.length < initialCount) {
            console.log(`Cleaned up ${initialCount - db.pendingPayments.length} old pending payments`);
            saveToDatabase(db, PAYMENTS_DB_PATH);
        }

        // Try to find the best matching payment for this webhook
        let payment = null;
        const userPayments = db.pendingPayments.filter(p => p.userId === targetUserId.toString());

        if (userPayments.length === 1) {
            // If only one pending payment for user, use that
            payment = userPayments[0];
            console.log(`Found single pending payment for user: ${payment.id}`);
        } else if (userPayments.length > 1) {
            // Multiple payments - try to match by amount, otherwise use latest
            if (paidAmount) {
                const amountMatch = userPayments.find(p => Math.abs(p.paymentAmount - parseFloat(paidAmount)) < 0.01);
                if (amountMatch) {
                    payment = amountMatch;
                    console.log(`Found payment by amount match (₹${paidAmount}): ${payment.id}`);
                } else {
                    // Get the most recent payment
                    payment = userPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                    console.log(`Using latest payment for user: ${payment.id}`);
                }
            } else {
                // No amount info, use latest
                payment = userPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                console.log(`Using latest payment for user (no amount): ${payment.id}`);
            }
        }

        if (!payment) {
            console.error('No pending payment found for user:', targetUserId);
            return res.status(404).send('Payment not found');
        }

        console.log('Found payment:', payment);

        if (status === 'success') {
            try {
                // Update payment object with actual paid amount
                if (paidAmount) {
                    payment.paymentAmount = parseFloat(paidAmount);
                }

                // Save the updated payment to the database before broadcasting
                saveToDatabase(db, PAYMENTS_DB_PATH);

                // Broadcast payment success to buy admin
                broadcastBuyTransaction(payment, 'payment_success');

                // Send voucher with the base amount only (excluding service charge)
                let voucherAmount = payment.voucherDetails.baseAmount;

                // If baseAmount is not available, calculate it from total amount and commission
                if (!voucherAmount && payment.voucherDetails.commissionPercentage) {
                    const totalAmount = payment.voucherDetails.balance;
                    const commissionPercentage = payment.voucherDetails.commissionPercentage;
                    voucherAmount = totalAmount / (1 + commissionPercentage / 100);
                }

                // Fallback to other amount fields if still not found
                if (!voucherAmount) {
                    voucherAmount = payment.voucherDetails.amount || payment.voucherDetails.balance;
                }

                console.log(`Sending voucher: ₹${voucherAmount} to ${payment.paymentDetails.email}`);

                if (!voucherAmount || voucherAmount <= 0) {
                    throw new Error(`Invalid voucher amount: ${voucherAmount}. Cannot send voucher.`);
                }

                const voucherResponse = await sendVoucher(
                    voucherAmount,
                    payment.paymentDetails.email
                );

                // Update payment status
                payment.status = 'completed';
                payment.completedAt = new Date().toISOString();
                db.completedPayments.push(payment);
                db.pendingPayments = db.pendingPayments.filter(p => p.id !== payment.id);
                saveToDatabase(db, PAYMENTS_DB_PATH);

                // Broadcast voucher sent notification to buy admin
                broadcastBuyTransaction(payment, 'voucher_sent');

                // Notify user
                await bot.telegram.sendMessage(
                    targetUserId,
                    `✅ Payment Successful!\n\n` +
                    `Your voucher has been sent to ${payment.paymentDetails.email}\n` +
                    `Please check your email for the voucher details.`
                );

                // Clear user state
                userStates.delete(targetUserId);
            } catch (error) {
                console.error('Error processing successful payment:', error);
                // Broadcast payment failure to buy admin
                broadcastBuyTransaction(payment, 'payment_failed');

                await bot.telegram.sendMessage(
                    targetUserId,
                    '❌ There was an error processing your payment. Please contact support.' + ERROR_SUFFIX
                );
            }
        } else if (status === 'failure') {
            // Broadcast payment failure to buy admin
            broadcastBuyTransaction(payment, 'payment_failed');

            await bot.telegram.sendMessage(
                targetUserId,
                '❌ Payment failed. Please try again.' + ERROR_SUFFIX
            );
            userStates.delete(targetUserId);
        }

        res.status(200).send('OK Please return to bot');
    } catch (error) {
        console.error('Error handling payment status:', error);
        res.status(500).send('Error');
    }
});

// Start Express server
const PORT = 3007;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Start the buy admin bot when starting your main application
console.log('Starting Buy Admin Bot...');
import { startBuyAdminBot } from './buy-admin-bot.js';

//import  { startBuyAdminBot } = require('./buy-admin-bot.js');
startBuyAdminBot(); 