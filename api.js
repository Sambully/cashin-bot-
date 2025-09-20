import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import qs from 'querystring';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
const DATA_FILE_PATH = path.join(process.cwd(), 'data.json');
const dataFilePath = path.join(process.cwd(), 'api_data.json');

// PayU Configuration for Payment Links API
const PAYU_CONFIG = {
    client_id: '33b63154a3f3eab9f8de3d4c4b4cc84208e73186585d65f208a23e1f1f430488',
    client_secret: '27c8cb27b000bf4b523f38a707445038eb444c6bc7df987b205c8c2b1978e7ba',
    scope: 'create_payment_links',
    grant_type: 'client_credentials'
};

const MERCHANT_ID = '12632859';
const NOTIFICATION_URL = 'https://4f930feeeb88.ngrok-free.app';

// Bot notification callback - will be set by bot module
let botNotificationCallback = null;

// Function to set bot notification callback
export function setBotNotificationCallback(callback) {
    botNotificationCallback = callback;
    console.log('✅ Bot notification callback registered');
}

// Database functions (merged from database.js)

// Initialize database file if it doesn't exist
function initializeDatabase() {
    if (!fs.existsSync(DATA_FILE_PATH)) {
        const initialData = {
            pendingPayments: [],
            completedPayments: [],
            failedPayments: []
        };
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(initialData, null, 2));
        console.log('Database initialized at:', DATA_FILE_PATH);
    }
}

// Read data from database
function readDatabase() {
    try {
        initializeDatabase();
        const data = fs.readFileSync(DATA_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        return {
            pendingPayments: [],
            completedPayments: [],
            failedPayments: []
        };
    }
}

// Write data to database
function writeDatabase(data) {
    try {
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(data, null, 2));
        console.log('Database updated successfully');
        return true;
    } catch (error) {
        console.error('Error writing to database:', error);
        return false;
    }
}

// Save pending payment to database
function savePendingPayment(paymentData) {
    try {
        const db = readDatabase();
        
        const pendingPayment = {
            id: paymentData.invoiceNumber,
            txnid: paymentData.invoiceNumber,
            userId: paymentData.userId,
            email: paymentData.email,
            amount: paymentData.amount,
            originalAmount: paymentData.originalAmount,
            serviceCharge: paymentData.serviceCharge,
            finalAmount: paymentData.finalAmount,
            paymentLink: paymentData.paymentLink,
            username: paymentData.username, // Add username field
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        db.pendingPayments.push(pendingPayment);
        
        if (writeDatabase(db)) {
            console.log('✅ Pending payment saved:', pendingPayment.id);
            return pendingPayment;
        }
        return null;
    } catch (error) {
        console.error('❌ Error saving pending payment:', error);
        return null;
    }
}

// Update payment status based on webhook data with UDF verification
function updatePaymentStatus(webhookData) {
    try {
        const db = readDatabase();
        const webhookTxnid = webhookData.txnid;
        const status = webhookData.status;
        const email = webhookData.email;
        const amount = parseFloat(webhookData.amount);
        
        // Extract UDF data for verification
        const udfUserId = webhookData.udf1;
        const udfInvoiceNumber = webhookData.udf2;
        const udfEmail = webhookData.udf3;
        const udfAmount = parseFloat(webhookData.udf4);
        
        console.log(`🔍 Webhook received with UDF data:
        - UDF1 (User ID): ${udfUserId}
        - UDF2 (Invoice Number): ${udfInvoiceNumber}
        - UDF3 (Email): ${udfEmail}
        - UDF4 (Amount): ${udfAmount}
        - Webhook Email: ${email}
        - Webhook Amount: ${amount}`);
        
        let pendingIndex = -1;
        let verificationMethod = '';
        
        // Priority 1: Try to find payment by invoice number from UDF2
        if (udfInvoiceNumber) {
            console.log(`🔍 Searching by UDF invoice number: ${udfInvoiceNumber}`);
            pendingIndex = db.pendingPayments.findIndex(payment => 
                payment.txnid === udfInvoiceNumber || 
                payment.invoiceNumber === udfInvoiceNumber ||
                payment.id === udfInvoiceNumber
            );
            
            if (pendingIndex !== -1) {
                console.log(`✅ Payment found by UDF invoice number: ${udfInvoiceNumber}`);
                verificationMethod = 'udf_invoice_number';
                
                // Additional verification: check if UDF data matches stored payment data
                const foundPayment = db.pendingPayments[pendingIndex];
                const verificationResults = {
                    userIdMatch: !udfUserId || String(foundPayment.userId) === String(udfUserId),
                    emailMatch: !udfEmail || foundPayment.email === udfEmail,
                    amountMatch: !udfAmount || Math.abs(foundPayment.amount - udfAmount) < 0.01
                };
                
                console.log(`🔐 UDF Verification Results:
                - User ID Match: ${verificationResults.userIdMatch}
                - Email Match: ${verificationResults.emailMatch}
                - Amount Match: ${verificationResults.amountMatch}`);
                
                // If any verification fails, log warning but continue (PayU might modify data)
                if (!verificationResults.userIdMatch || !verificationResults.emailMatch || !verificationResults.amountMatch) {
                    console.log(`⚠️ UDF verification mismatch detected but proceeding with payment update`);
                }
            }
        }
        
        // Priority 2: Try to find payment by txnid if not found by invoice number
        if (pendingIndex === -1) {
            console.log(`🔍 Searching by webhook txnid: ${webhookTxnid}`);
            pendingIndex = db.pendingPayments.findIndex(payment => payment.txnid === webhookTxnid);
            
            if (pendingIndex !== -1) {
                console.log(`✅ Payment found by txnid: ${webhookTxnid}`);
                verificationMethod = 'txnid';
            }
        }
        
        // Priority 3: Try to match by email and amount if still not found
        if (pendingIndex === -1) {
            console.log(`🔍 Searching by email and amount: ${email}, ${amount}`);
            pendingIndex = db.pendingPayments.findIndex(payment => 
                payment.email === email && 
                Math.abs(payment.amount - amount) < 0.01 &&
                payment.status === 'pending'
            );
            
            if (pendingIndex !== -1) {
                console.log(`✅ Payment found by email and amount: ${db.pendingPayments[pendingIndex].txnid}`);
                verificationMethod = 'email_amount';
            }
        }
        
        // Priority 4: Try to match by UDF email and amount if available
        if (pendingIndex === -1 && udfEmail && udfAmount) {
            console.log(`🔍 Searching by UDF email and amount: ${udfEmail}, ${udfAmount}`);
            pendingIndex = db.pendingPayments.findIndex(payment => 
                payment.email === udfEmail && 
                Math.abs(payment.amount - udfAmount) < 0.01 &&
                payment.status === 'pending'
            );
            
            if (pendingIndex !== -1) {
                console.log(`✅ Payment found by UDF email and amount: ${db.pendingPayments[pendingIndex].txnid}`);
                verificationMethod = 'udf_email_amount';
            }
        }
        
        if (pendingIndex === -1) {
            console.log('⚠️ Payment not found in pending payments with any verification method');
            
            // Create a new entry for unmatched webhook (for tracking)
            const unmatchedPayment = {
                id: `UNMATCHED_${webhookTxnid}_${Date.now()}`,
                txnid: webhookTxnid,
                webhookTxnid: webhookTxnid,
                email: email,
                amount: amount,
                status: status,
                webhookData: webhookData,
                udfData: {
                    userId: udfUserId,
                    invoiceNumber: udfInvoiceNumber,
                    email: udfEmail,
                    amount: udfAmount
                },
                verificationMethod: 'unmatched',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                note: 'Payment received via webhook but not found in pending payments'
            };
            
            if (status === 'success') {
                db.completedPayments.push(unmatchedPayment);
                console.log('✅ Unmatched successful payment added to completed payments');
            } else {
                db.failedPayments.push(unmatchedPayment);
                console.log('❌ Unmatched failed payment added to failed payments');
            }
            
            // Send notification to user if userId is available from UDF
            if (botNotificationCallback && udfUserId) {
                botNotificationCallback(udfUserId, status, webhookTxnid, amount);
            }
            
            if (writeDatabase(db)) {
                return unmatchedPayment;
            }
            return null;
        }
        
        // Remove from pending payments
        const payment = db.pendingPayments.splice(pendingIndex, 1)[0];
        
        // Update payment with webhook data and verification info
        const updatedPayment = {
            ...payment,
            status: status,
            webhookData: webhookData,
            webhookTxnid: webhookTxnid,
            verificationMethod: verificationMethod,
            udfData: {
                userId: udfUserId,
                invoiceNumber: udfInvoiceNumber,
                email: udfEmail,
                amount: udfAmount
            },
            updatedAt: new Date().toISOString(),
            mihpayid: webhookData.mihpayid,
            mode: webhookData.mode,
            bank_ref_no: webhookData.bank_ref_no,
            error: webhookData.error,
            error_Message: webhookData.error_Message,
            net_amount_debit: webhookData.net_amount_debit
        };
        
        // Move to appropriate array based on status
        if (status === 'success') {
            db.completedPayments.push(updatedPayment);
            console.log(`✅ Payment completed successfully: ${payment.txnid} (verified by: ${verificationMethod})`);
        } else {
            db.failedPayments.push(updatedPayment);
            console.log(`❌ Payment failed: ${payment.txnid} (verified by: ${verificationMethod})`);
        }
        
        // Send notification to user via Telegram bot
        const storedUserId = payment.userId;
        const udfUserIdStr = String(udfUserId);
        
        console.log(`🔍 Debug notification data:
        - Stored userId: ${storedUserId} (type: ${typeof storedUserId})
        - UDF userId: ${udfUserId} (type: ${typeof udfUserId})
        - UDF userId String: ${udfUserIdStr}
        - Bot callback exists: ${!!botNotificationCallback}`);
        
        // Convert storedUserId to string for Telegram API consistency
        const storedUserIdStr = String(storedUserId);
        
        // Enhanced notification logic with retry mechanism
        const sendNotification = (userId, retryCount = 0) => {
            if (botNotificationCallback) {
                console.log(`📤 Sending notification to userId: ${userId}`);
                try {
                    botNotificationCallback(userId, status, payment.txnid, payment.amount);
                    return true;
                } catch (error) {
                    console.error('❌ Error sending notification:', error);
                    return false;
                }
            } else if (retryCount < 3) {
                console.log(`⚠️ Bot callback not available, retrying in ${(retryCount + 1) * 1000}ms...`);
                setTimeout(() => {
                    sendNotification(userId, retryCount + 1);
                }, (retryCount + 1) * 1000);
                return false;
            } else {
                console.log(`❌ Bot callback not available after ${retryCount} retries`);
                return false;
            }
        };
        
        // Try to send notification
        if (storedUserId) {
            sendNotification(storedUserIdStr);
        } else if (udfUserId) {
            sendNotification(udfUserIdStr);
        } else {
            console.log(`⚠️ No userId available for notification - stored: ${storedUserId}, UDF: ${udfUserId}`);
        }
        
        if (writeDatabase(db)) {
            return updatedPayment;
        }
        return null;
    } catch (error) {
        console.error('❌ Error updating payment status:', error);
        return null;
    }
}

// Get payment by transaction ID (searches in all categories)
function getPaymentByTxnId(txnid) {
    try {
        const db = readDatabase();
        
        // Search in all arrays by both txnid and webhookTxnid
        let payment = db.pendingPayments.find(p => p.txnid === txnid || p.webhookTxnid === txnid);
        if (payment) return { ...payment, category: 'pending' };
        
        payment = db.completedPayments.find(p => p.txnid === txnid || p.webhookTxnid === txnid);
        if (payment) return { ...payment, category: 'completed' };
        
        payment = db.failedPayments.find(p => p.txnid === txnid || p.webhookTxnid === txnid);
        if (payment) return { ...payment, category: 'failed' };
        
        return null;
    } catch (error) {
        console.error('Error getting payment:', error);
        return null;
    }
}

// Get all payments for a user
function getUserPayments(userId) {
    try {
        const db = readDatabase();
        
        const userPayments = {
            pending: db.pendingPayments.filter(p => p.userId === userId),
            completed: db.completedPayments.filter(p => p.userId === userId),
            failed: db.failedPayments.filter(p => p.userId === userId)
        };
        
        return userPayments;
    } catch (error) {
        console.error('Error getting user payments:', error);
        return { pending: [], completed: [], failed: [] };
    }
}

// Get database statistics
function getDatabaseStats() {
    try {
        const db = readDatabase();
        
        return {
            totalPending: db.pendingPayments.length,
            totalCompleted: db.completedPayments.length,
            totalFailed: db.failedPayments.length,
            totalPayments: db.pendingPayments.length + db.completedPayments.length + db.failedPayments.length
        };
    } catch (error) {
        console.error('Error getting database stats:', error);
        return { totalPending: 0, totalCompleted: 0, totalFailed: 0, totalPayments: 0 };
    }
}

// API data file functions (existing)
function readDataFromFile() {
    try {
        if (fs.existsSync(dataFilePath)) {
            const data = fs.readFileSync(dataFilePath, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error reading data file:', error);
        return [];
    }
}

function saveDataToFile(newData) {
    try {
        const existingData = readDataFromFile();
        
        const dataWithTimestamp = {
            ...newData,
            timestamp: new Date().toISOString(),
            id: Date.now()
        };
        
        existingData.push(dataWithTimestamp);
        
        fs.writeFileSync(dataFilePath, JSON.stringify(existingData, null, 2));
        console.log('Data saved successfully:', dataWithTimestamp);
        return dataWithTimestamp;
    } catch (error) {
        console.error('Error saving data:', error);
        throw error;
    }
}

// API Routes

// API endpoint to receive and save payload data (webhook handler)
app.post('/api/data', (req, res) => {
    try {
        const payload = req.body;
        
        if (!payload || Object.keys(payload).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Empty payload received'
            });
        }
        
        console.log('📥 Webhook received:', JSON.stringify(payload, null, 2));
        
        // Save webhook data to api_data.json (for backup/logging)
        const savedData = saveDataToFile(payload);
        
        // Update payment status in database if this is a payment webhook
        if (payload.txnid && payload.status) {
            console.log(`🔄 Processing payment update for txnid: ${payload.txnid}, status: ${payload.status}`);
            
            const updatedPayment = updatePaymentStatus(payload);
            
            if (updatedPayment) {
                console.log('✅ Payment status updated in database');
                
                res.status(200).json({
                    success: true,
                    message: 'Webhook processed and payment status updated',
                    data: savedData,
                    paymentUpdate: {
                        txnid: payload.txnid,
                        status: payload.status,
                        updated: true
                    }
                });
            } else {
                console.log('⚠️ Payment not found or failed to update');
                
                res.status(200).json({
                    success: true,
                    message: 'Webhook saved but payment not found in database',
                    data: savedData,
                    paymentUpdate: {
                        txnid: payload.txnid,
                        status: payload.status,
                        updated: false
                    }
                });
            }
        } else {
            // Non-payment webhook
            res.status(200).json({
                success: true,
                message: 'Webhook data saved successfully',
                data: savedData
            });
        }
        
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// API endpoint to get payment status by transaction ID
app.get('/api/payment/:txnid', (req, res) => {
    try {
        const { txnid } = req.params;
        
        if (!txnid) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID is required'
            });
        }
        
        const payment = getPaymentByTxnId(txnid);
        
        if (payment) {
            res.status(200).json({
                success: true,
                payment: payment
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
    } catch (error) {
        console.error('Error getting payment:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// API endpoint to get database statistics
app.get('/api/stats', (req, res) => {
    try {
        const stats = getDatabaseStats();
        
        res.status(200).json({
            success: true,
            stats: stats
        });
        
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// API endpoint to get user payments
app.get('/api/user/:userId/payments', (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        const userPayments = getUserPayments(userId);
        
        res.status(200).json({
            success: true,
            payments: userPayments
        });
        
    } catch (error) {
        console.error('Error getting user payments:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString()
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📈 Stats endpoint: http://localhost:${PORT}/api/stats`);
    console.log(`💾 Database file: ${DATA_FILE_PATH}`);
    console.log(`📁 API data file: ${dataFilePath}`);
    
    // Initialize database on startup
    initializeDatabase();
    
    console.log('✅ Server initialization complete');
});

// Export functions for use in other modules
export { 
    savePendingPayment, 
    updatePaymentStatus, 
    getPaymentByTxnId, 
    getPaymentByInvoiceNumber,
    getUserPayments, 
    getDatabaseStats,
    getPayUAccessToken,
    verifyPaymentWithUDF
};

export default app;

// Get payment by invoice number (searches in all categories)
function getPaymentByInvoiceNumber(invoiceNumber) {
    try {
        const db = readDatabase();
        
        // Search in all arrays by invoice number (which is stored as txnid)
        let payment = db.pendingPayments.find(p => p.txnid === invoiceNumber || p.id === invoiceNumber);
        if (payment) return { ...payment, category: 'pending' };
        
        payment = db.completedPayments.find(p => p.txnid === invoiceNumber || p.id === invoiceNumber);
        if (payment) return { ...payment, category: 'completed' };
        
        payment = db.failedPayments.find(p => p.txnid === invoiceNumber || p.id === invoiceNumber);
        if (payment) return { ...payment, category: 'failed' };
        
        return null;
    } catch (error) {
        console.error('Error getting payment by invoice number:', error);
        return null;
    }
}

// Get PayU access token for payment links API
async function getPayUAccessToken() {
    try {
        const response = await axios.post('https://info.payu.in/merchant/postservice?form=token', 
            qs.stringify(PAYU_CONFIG), 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting PayU access token:', error);
        throw error;
    }
}

// API endpoint to create payment links
app.post('/api/payment-links', async (req, res) => {
    try {
        const { 
            amount, 
            email, 
            phone, 
            firstName = 'Customer', 
            lastName = '', 
            productInfo = 'Payment',
            userId = null
        } = req.body;

        // Validate required fields
        if (!amount || !email) {
            return res.status(400).json({
                success: false,
                message: 'Amount and email are required'
            });
        }

        // Generate unique invoice number
        const invoiceNumber = `INV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Get PayU access token
        const accessToken = await getPayUAccessToken();
        
        // Prepare payment link request
        const paymentLinkData = {
            merchant_id: MERCHANT_ID,
            reference_id: invoiceNumber,
            date_time: new Date().toISOString(),
            redirect_url: `${NOTIFICATION_URL}/payment-success`,
            webhook_url: `${NOTIFICATION_URL}/api/data`,
            purpose: productInfo,
            send_email: true,
            send_sms: phone ? true : false,
            customer_name: `${firstName} ${lastName}`.trim(),
            customer_email: email,
            customer_phone: phone || '',
            amount: parseFloat(amount),
            currency: 'INR',
            accept_partial_payments: false,
            description: `Payment for ${productInfo}`,
            expire_by: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
            reminder_enable: true,
            udf1: userId || '',
            udf2: '',
            udf3: '',
            udf4: '',
            udf5: ''
        };

        // Create payment link
        const paymentLinkResponse = await axios.post(
            'https://info.payu.in/merchant/postservice?form=payment_link_generate',
            paymentLinkData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (paymentLinkResponse.data && paymentLinkResponse.data.payment_link) {
            // Save pending payment to database
            const paymentData = {
                invoiceNumber: invoiceNumber,
                userId: userId,
                email: email,
                amount: parseFloat(amount),
                paymentLink: paymentLinkResponse.data.payment_link,
                firstName: firstName,
                lastName: lastName,
                phone: phone,
                productInfo: productInfo
            };

            const savedPayment = savePendingPayment(paymentData);

            if (savedPayment) {
                res.status(200).json({
                    success: true,
                    message: 'Payment link created successfully',
                    data: {
                        invoiceNumber: invoiceNumber,
                        paymentLink: paymentLinkResponse.data.payment_link,
                        amount: parseFloat(amount),
                        email: email,
                        expiresAt: paymentLinkData.expire_by,
                        payment: savedPayment
                    }
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Payment link created but failed to save to database',
                    data: {
                        invoiceNumber: invoiceNumber,
                        paymentLink: paymentLinkResponse.data.payment_link,
                        amount: parseFloat(amount),
                        email: email
                    }
                });
            }
        } else {
            console.error('PayU API Error:', paymentLinkResponse.data);
            res.status(400).json({
                success: false,
                message: 'Failed to create payment link',
                error: paymentLinkResponse.data
            });
        }

    } catch (error) {
        console.error('Error creating payment link:', error);
        
        if (error.response) {
            console.error('PayU API Response:', error.response.data);
            res.status(error.response.status || 500).json({
                success: false,
                message: 'PayU API error',
                error: error.response.data
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
});

// API endpoint to get payment by invoice number
app.get('/api/payment/invoice/:invoiceNumber', (req, res) => {
    try {
        const { invoiceNumber } = req.params;
        
        if (!invoiceNumber) {
            return res.status(400).json({
                success: false,
                message: 'Invoice number is required'
            });
        }
        
        const payment = getPaymentByInvoiceNumber(invoiceNumber);
        
        if (payment) {
            res.status(200).json({
                success: true,
                payment: payment
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
    } catch (error) {
        console.error('Error getting payment by invoice number:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Verify payment using UDF data
function verifyPaymentWithUDF(udfData) {
    try {
        const db = readDatabase();
        const { userId, invoiceNumber, email, amount } = udfData;
        
        console.log(`🔐 Verifying payment with UDF data:
        - User ID: ${userId}
        - Invoice Number: ${invoiceNumber}
        - Email: ${email}
        - Amount: ${amount}`);
        
        // Search in all payment arrays
        const allPayments = [
            ...db.pendingPayments.map(p => ({ ...p, category: 'pending' })),
            ...db.completedPayments.map(p => ({ ...p, category: 'completed' })),
            ...db.failedPayments.map(p => ({ ...p, category: 'failed' }))
        ];
        
        // Try to find by invoice number first
        let matchedPayment = allPayments.find(payment => 
            payment.txnid === invoiceNumber || 
            payment.invoiceNumber === invoiceNumber ||
            payment.id === invoiceNumber
        );
        // 
        if (matchedPayment) {
            console.log(`✅ Payment found by invoice number: ${invoiceNumber}`);
            return {
                success: true,
                payment: matchedPayment,
                verificationMethod: 'invoice_number'
            };
        }
        
        // Try to find by user ID, email, and amount combination
        matchedPayment = allPayments.find(payment => 
            payment.userId === userId &&
            payment.email === email &&
            Math.abs(payment.amount - parseFloat(amount)) < 0.01
        );
        
        if (matchedPayment) {
            console.log(`✅ Payment found by user data combination`);
            return {
                success: true,
                payment: matchedPayment,
                verificationMethod: 'user_data_combination'
            };
        }
        
        console.log(`❌ No payment found matching UDF data`);
        return {
            success: false,
            message: 'No matching payment found',
            verificationMethod: 'none'
        };
        
    } catch (error) {
        console.error('❌ Error verifying payment with UDF:', error);
        return {
            success: false,
            error: error.message,
            verificationMethod: 'error'
        };
    }
}