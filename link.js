import axios from 'axios';
import qs from 'querystring';

import { savePendingPayment } from './api.js';

// PayU Configuration
const config = {
    client_id: '33b63154a3f3eab9f8de3d4c4b4cc84208e73186585d65f208a23e1f1f430488',
    client_secret: '27c8cb27b000bf4b523f38a707445038eb444c6bc7df987b205c8c2b1978e7ba',
    scope: 'create_payment_links',
    grant_type: 'client_credentials'
};

const merchantId = '12632859';
const notificationUrl = 'https://a8c69de1b786.ngrok-free.app';

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
        // console.log('PayU access token:', response.data.access_token);
        return response.data.access_token;
   
    } catch (error) {
        console.error('Error getting PayU token:', error.response?.data || error.message);
        throw error;
    }
}

// Create Payment Link with invoice number verification
async function createPaymentLink(token, amount, invoiceNumber, userId, email, phoneNumber) {
    try {
        const data = {
            invoiceNumber: invoiceNumber,
            subAmount: amount,
            isPartialPaymentAllowed: false,
            description: "Payment link for voucher",
            source: "API",
            currency: "INR",
            notificationUrl: `${notificationUrl}/api/data`,
            successURL: `https://a8c69de1b786.ngrok-free.app/payment-status?userId=${userId}&invoiceNumber=${invoiceNumber}`,
            failureURL: `https://a8c69de1b786.ngrok-free.app/payment-failed?userId=${userId}&invoiceNumber=${invoiceNumber}`,
            customer: {
                name: "Customer", // You can get this from database too
                email: email,
                phone: phoneNumber
            },
            udf: {
                udf1: String(userId),   // User ID
                udf2: invoiceNumber,    // Invoice number
                udf3: email,            // Email
                udf4: String(amount),   // Amount
                udf5: phoneNumber       // Phone number
            },
            viaEmail: false,
            viaSms: false
        };

        // console.log('Payment link data being sent:', JSON.stringify(data, null, 2));

        const response = await axios.post(
            'https://oneapi.payu.in/payment-links', // test env
            data,
            {
                headers: {
                    'mid': merchantId, // Changed from 'merchantId' to 'mid' as per API docs
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            }
        );

        const result = response.data;
        // console.log('PayU response:', JSON.stringify(result, null, 2));
        
        if (result.status === 0) {
            return result.result.paymentLink;
        }
        return null;
    } catch (error) {
        console.error('Error creating payment link:', error.response?.data || error.message);
        throw error;
    }
}


// Main function to generate payment link with invoice number verification
export async function generatePaymentLink(userId, amount, email, username = null, phoneNumber = null) {
    try {
        // Validate inputs
        if (!userId || !amount || !email) {
            throw new Error('userId, amount, and email are required parameters');
        }

        if (amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }

        // Calculate service charge (5%) and final amount
        const originalAmount = parseFloat(amount);
        const serviceCharge = Math.round(originalAmount * 0.05 * 100) / 100; // Round to 2 decimal places
        const finalAmount = Math.round((originalAmount + serviceCharge) * 100) / 100; // Round to 2 decimal places

        // Generate unique invoice number with userId encoded (max 16 chars for PayU)
        const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
        const randomId = Math.random().toString(36).substring(2, 6); // 4 char random string
        const invoiceNumber = `${userId}${timestamp}${randomId}`.substring(0, 16);
        
        // console.log(`Generating payment link for:
        // - User ID: ${userId}
        // - Original Amount: ₹${originalAmount}
        // - Service Charge (5%): ₹${serviceCharge}
        // - Final Amount: ₹${finalAmount}
        // - Email: ${email}
        // - Phone: ${phoneNumber}
        // - Invoice: ${invoiceNumber}`);

        // Get PayU token
        const token = await getPayUToken();
        // console.log('✅ PayU token obtained successfully');

        // Create payment link with final amount (including service charge)
        const paymentLink = await createPaymentLink(token, finalAmount, invoiceNumber, userId, email, phoneNumber);
        
        if (paymentLink) {
            // console.log('✅ Payment link created successfully');
            
            // Print only the payment link
            console.log(paymentLink);
            
            // Prepare payment data for database
            const paymentData = {
                success: true,
                paymentLink: paymentLink,
                invoiceNumber: invoiceNumber,
                originalAmount: originalAmount,
                serviceCharge: serviceCharge,
                finalAmount: finalAmount,
                amount: finalAmount, // Keep this for backward compatibility
                userId: userId,
                email: email,
                phoneNumber: phoneNumber, // Add phone number field
                username: username // Add username field
            };
            
            // Save to database as pending payment
            const savedPayment = savePendingPayment(paymentData);
            
            if (savedPayment) {
                // console.log('✅ Payment data saved to database as pending');
                return {
                    ...paymentData,
                    databaseId: savedPayment.id
                };
            } else {
                // console.log('⚠️ Payment link created but failed to save to database');
                return paymentData;
            }
        } else {
            throw new Error('Failed to create payment link');
        }

    } catch (error) {
        console.error('❌ Error generating payment link:', error.message);
        return {
            success: false,
            error: error.message,
            userId: userId,
            amount: amount,
            email: email,
            phoneNumber: phoneNumber
        };
    }
}

// Helper function to extract userId from txnid
export function extractUserIdFromTxnId(txnid) {
    try {
        // New format: userId + timestamp + random (max 16 chars)
        // Extract userId by finding where the numeric timestamp starts
        const match = txnid.match(/^(\d+)/);
        if (match) {
            return match[1];
        }
        
        // Fallback for old format: INV_userId_timestamp_uuid
        const parts = txnid.split('_');
        if (parts.length >= 2 && parts[0] === 'INV') {
            return parts[1];
        }
        return null;
    } catch (error) {
        console.error('Error extracting userId from txnid:', error);
        return null;
    }
}

// Updated function to handle payment status with invoice number verification
export function handlePaymentStatus(status, txnid, userId = null, invoiceNumber = null) {
    // If userId is not provided, try to extract from txnid
    if (!userId) {
        userId = extractUserIdFromTxnId(txnid);
    }
    
    if (status === 'success') {
        console.log(`✅ Payment successful for transaction ${txnid}, user ${userId}`);
        return {
            success: true,
            message: 'Payment completed successfully!',
            txnid: txnid,
            userId: userId,
            invoiceNumber: invoiceNumber,
            verificationMethod: 'invoice_number'
        };
    } else {
        console.log(`❌ Payment failed for transaction ${txnid}, user ${userId}`);
        return {
            success: false,
            message: 'Payment failed. Please try again.',
            txnid: txnid,
            userId: userId,
            invoiceNumber: invoiceNumber,
            verificationMethod: 'invoice_number'
        };
    }
}

// Function to verify payment using invoice number
export async function verifyPaymentWithInvoiceNumber(invoiceNumber) {
    try {
        const response = await axios.get(`http://localhost:3000/api/payment/invoice/${invoiceNumber}`);
        
        if (response.data.success) {
            console.log('✅ Payment verified successfully with invoice number');
            return response.data.payment;
        } else {
            console.log('❌ Payment verification failed');
            return null;
        }
    } catch (error) {
        console.error('Error verifying payment with invoice number:', error.message);
        return null;
    }
}

// Enhanced function to verify payment using UDF data
export async function verifyPaymentWithUDFData(udfData) {
    try {
        const response = await axios.post('http://localhost:3000/api/verify-payment-udf', udfData);
        
        if (response.data.success) {
            console.log(`✅ Payment verified successfully using ${response.data.verificationMethod}`);
            return {
                success: true,
                payment: response.data.payment,
                verificationMethod: response.data.verificationMethod
            };
        } else {
            console.log('❌ Payment verification failed');
            return {
                success: false,
                message: response.data.message,
                verificationMethod: response.data.verificationMethod
            };
        }
    } catch (error) {
        console.error('Error verifying payment with UDF data:', error.message);
        return {
            success: false,
            error: error.message,
            verificationMethod: 'error'
        };
    }
}

// Enhanced payment status handler with UDF verification
export function handlePaymentStatusWithUDF(webhookData) {
    const { status, txnid, udf1: userId, udf2: invoiceNumber, udf3: email, udf4: amount, udf5: phoneNumber } = webhookData;
    
    console.log(`🔄 Processing payment status with UDF verification:
    - Status: ${status}
    - TxnID: ${txnid}
    - UDF User ID: ${userId}
    - UDF Invoice Number: ${invoiceNumber}
    - UDF Email: ${email}
    - UDF Amount: ${amount}
    - UDF Phone Number: ${phoneNumber}`);
    
    if (status === 'success') {
        console.log(`✅ Payment successful for transaction ${txnid}`);
        return {
            success: true,
            message: 'Payment completed successfully!',
            txnid: txnid,
            userId: userId,
            invoiceNumber: invoiceNumber,
            email: email,
            amount: amount,
            phoneNumber: phoneNumber,
            verificationMethod: 'udf_data',
            udfData: {
                userId,
                invoiceNumber,
                email,
                amount,
                phoneNumber
            }
        };
    } else {
        console.log(`❌ Payment failed for transaction ${txnid}`);
        return {
            success: false,
            message: 'Payment failed. Please try again.',
            txnid: txnid,
            userId: userId,
            invoiceNumber: invoiceNumber,
            email: email,
            amount: amount,
            phoneNumber: phoneNumber,
            verificationMethod: 'udf_data',
            udfData: {
                userId,
                invoiceNumber,
                email,
                amount,
                phoneNumber
            }
        };
    }
}