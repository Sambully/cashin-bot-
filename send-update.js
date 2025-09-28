import { Telegraf } from 'telegraf';

// Replace with your bot token
const bot = new Telegraf('7892399402:AAFbZfJAGbkoMmI-kI37Hj7gor16J2PYFiA');

// Chat IDs to send the update message to
const CHAT_IDS = [
    1990640970, 7338261352, 8027629682, 5868659301, 5621511565, 839959546, 5269305211, 5257223751, 8185677242, 6072308083, 5790182077, 5822360617, 6095420056, 1365036490, 6785830527, 5120073793, 2032077226, 6209624460, 5962869231, 6837579185, 1021195755, 6001846112, 1777656499, 6457030549, 1869611803, 7361068821, 1468419933, 7005195040, 5867264710, 7859158469, 1855701819, 6374510878, 6578879911, 1408693870, 6223100361, 8084068338, 6121191057, 5842585966, 1695548753, 6678256910, 7307329661, 5761090914, 7403083789, 7909141428, 6366870875, 1356200400, 712483519, 6115559189, 7005265362, 1659509030, 7050434195, 1750681308, 7473330051, 5182200199, 6645045693, 6800351948, 6178435701, 5553544232, 5647663814, 6288334585, 5781069087, 844485406, 7725901812, 1167810951, 1356595402, 1350668484, 1551142575, 1465355846, 837207230, 5114238901, 5965157587, 6676486554, 2034374966, 1160520609, 5763343113, 6627541621, 1108489245, 6883296615, 6320029716, 7270898362, 1008354885, 7464674529, 7487899746, 7352556680, 8019139468, 1509816305, 2110354652, 1038646826, 1668699986, 6857619567, 5878584020
];

// Update message in English
const UPDATE_MESSAGE = `🚀 *Bot Update Notification*

Great news! Our bot has been updated with new features and the user registration feature has been significantly optimized!

✨ *What's New:*
• Enhanced user registration system
• Improved performance and reliability  
• Better user experience
• Optimized backend processes

The bot is now running more efficiently than ever before. Thank you for your continued support!

🤖 *CashIn Bot Team*`;

// Function to send update message to all chat IDs
async function sendUpdateNotification() {
    console.log(`🚀 Starting to send update notifications to ${CHAT_IDS.length} chat IDs...`);
    console.log('⏳ Please wait while messages are being sent...\n');

    let successCount = 0;
    let failureCount = 0;
    const failedChatIds = [];

    for (let i = 0; i < CHAT_IDS.length; i++) {
        const chatId = CHAT_IDS[i];
        try {
            await bot.telegram.sendMessage(chatId, UPDATE_MESSAGE, {
                parse_mode: 'Markdown'
            });
            console.log(`✅ [${i + 1}/${CHAT_IDS.length}] Message sent successfully to chat ID: ${chatId}`);
            successCount++;

            // Add a small delay to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
            console.error(`❌ [${i + 1}/${CHAT_IDS.length}] Failed to send message to chat ID ${chatId}: ${error.message}`);
            failureCount++;
            failedChatIds.push(chatId);
        }
    }

    console.log(`\n📊 *Final Summary:*`);
    console.log(`✅ Successfully sent: ${successCount}`);
    console.log(`❌ Failed to send: ${failureCount}`);
    console.log(`📱 Total chat IDs: ${CHAT_IDS.length}`);
    console.log(`📈 Success rate: ${((successCount / CHAT_IDS.length) * 100).toFixed(2)}%`);

    if (failedChatIds.length > 0) {
        console.log(`\n❌ Failed Chat IDs: ${failedChatIds.join(', ')}`);
    }

    console.log('\n🎉 Update notification process completed!');
}

// Main execution
async function main() {
    try {
        console.log('🤖 Initializing Telegram bot...');
        await sendUpdateNotification();
    } catch (error) {
        console.error('💥 Error occurred:', error);
    } finally {
        process.exit(0);
    }
}

// Run the script
main();