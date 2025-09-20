// voucher.js - Voucher processing functions
import axios from 'axios';
import { authenticator } from 'otplib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const SECRET_KEY = 'WMWMHAI5WPEHOKSAM3FELH4B5BOD4KSN';
const DB_FILE_PATH = path.join(__dirname, 'vouchers_db.json');
const USERS_DB_PATH = path.join(__dirname, 'users_db.json');
const ERROR_SUFFIX = `\n\nFor help message or call our customer care on whatsapp 9102450063\nTelegram @bot_querry`;

// Configure authenticator
authenticator.options = {
    digits: 6,
    period: 30
};

// Global maps for tracking operations and user states
const ongoingOperations = new Map();
const userStates = new Map();

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

// Voucher helper functions
function isVoucherUsed(voucherCode) {
    const db = loadDatabase(DB_FILE_PATH) || { usedVouchers: [] };
    return db.usedVouchers.some(voucher => voucher.code === voucherCode);
}

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

function logUserActivity(userId, username, action, result) {
    const usersDB = loadDatabase(USERS_DB_PATH) || { users: [], admins: [] };

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

    user.activities.push({
        action,
        result,
        timestamp: new Date().toISOString()
    });

    if (user.activities.length > 100) {
        user.activities = user.activities.slice(-100);
    }

    saveToDatabase(usersDB, USERS_DB_PATH);
}

// Generate MFA code
const generateMFACode = () => {
    const code = authenticator.generate(SECRET_KEY);
    console.log('Generated MFA code:', code);
    return code;
};

// Common headers for API requests
const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Platform': 'WEB_ANDROID',
    'Origin': 'https://panel.icash.one',
    'Referer': 'https://panel.icash.one/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36'
});

// Main voucher processing function
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

// Send voucher function
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

// Export functions
export { 
    processCashIn, 
    sendVoucher, 
    getHeaders,
    generateMFACode,
    ongoingOperations,
    userStates
};