// File: api/bot.js

const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios'); // API calls ke liye zaroori
const util = require('util');

// 'util.promisify' ka use karke 'setTimeout' ko Promise-based banate hain
// Taa-ki hum 'await sleep(milliseconds)' use kar saken
const sleep = util.promisify(setTimeout);

const app = express();
app.use(express.json());

// ******* IMPORTANT *******
// Apna Telegram BOT_TOKEN yahan ya Environment Variables mein set karein.
const bot = new Telegraf(process.env.BOT_TOKEN);

// Base API URL
const BASE_URL = 'https://yabes-api.pages.dev/api/ai/video/v2';

// In-memory store to track tasks (Production use ke liye Redis/Database use karna chahiye)
// Chat ID -> { taskId: string, prompt: string }
const activeTasks = new Map();

// ============ Bot Handlers ============

// /start command - Welcome message aur Prompt mange
bot.start(async (ctx) => {
  const welcomeMessage = 
    `👋 *Welcome to Veo3 Video Generator Bot!*
  
    Main aapke prompt se shandaar videos bana sakta hoon.
    
    Video generate karne ke liye, *veo3* likhein aur uske baad apna prompt dein.
    
    *Example:*
    \`veo3 A cinematic shot of a lion roaring in the savanna during sunset.\``;
    
  await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Main message handler for video generation
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const chatId = ctx.chat.id;

  // Check agar user ne 'veo3' prefix use kiya hai
  if (text.toLowerCase().startsWith('veo3')) {
    const prompt = text.substring(4).trim(); // Remove 'veo3' and spaces

    if (prompt.length < 10) {
      return ctx.reply("Prompt bahut chhota hai. Please thoda detail mein likhein (minimum 10 characters).");
    }

    if (activeTasks.has(chatId)) {
      return ctx.reply("Aapka ek video pehle se generate ho raha hai. Please wait karen.");
    }
    
    // 1. Task Creation API (API 1)
    try {
      // User ko turant feedback dein
      await ctx.reply(`Generating video for: *${prompt}*`, { parse_mode: 'Markdown' });
      await ctx.reply(`*Please wait 2 minutes.* Yeh process asynchronous hai. Main aapko video bhej dunga jab yeh ready ho jayegi. ⏳`, { parse_mode: 'Markdown' });

      const createUrl = `${BASE_URL}?action=create&prompt=${encodeURIComponent(prompt)}`;
      const createResponse = await axios.get(createUrl);
      
      const taskId = createResponse.data.taskId;

      if (!taskId) {
         return ctx.reply('Video task shuru nahi ho paya. API se koi Task ID nahi mili.');
      }
      
      // Task ko track karen
      activeTasks.set(chatId, { taskId, prompt, startTime: Date.now() });

      // 2. Wait for 2 minutes (120000 milliseconds)
      await sleep(120000); 

      // 3. Task Status API (API 2) - Check output
      const statusUrl = `${BASE_URL}?action=status&taskId=${taskId}`;
      let videoUrl = null;
      let checkAttempts = 0;
      const MAX_ATTEMPTS = 5; // Agar 2 minute mein video ready na ho toh kuch aur baar check karen (every 30 seconds)

      while (!videoUrl && checkAttempts < MAX_ATTEMPTS) {
          try {
              const statusResponse = await axios.get(statusUrl);
              videoUrl = statusResponse.data.output;

              if (videoUrl) {
                  break; // Video mil gayi, loop se bahar nikle
              }
              
              // Agar video abhi bhi ready nahi hai, toh 30 seconds wait karen
              if (checkAttempts < MAX_ATTEMPTS - 1) {
                  await sleep(30000); 
              }
              checkAttempts++;

          } catch (e) {
              console.error(`Status check failed for ${taskId}:`, e.message);
              // Agar koi error aaye, toh 30 seconds wait karen aur phir try karen
              await sleep(30000); 
              checkAttempts++;
          }
      }


      // 4. Send the result
      if (videoUrl) {
        // Video file bhejein
        await ctx.replyWithVideo(videoUrl, { caption: `✅ *Your Veo3 Video is ready!* \nPrompt: _${prompt}_`, parse_mode: 'Markdown' });
      } else {
        // Agar video nahi mili (time out ya failure)
        await ctx.reply(`😔 Sorry, video generation for "${prompt}" fail ho gaya ya bahut zyada time lag gaya. Please thodi der baad dobara try karen.`);
      }

    } catch (err) {
      console.error('Video generation error:', err.message);
      await ctx.reply('❌ Maaf kijiyega, API call mein koi error aa gaya. Please developers se contact karen.');
    } finally {
      // Task complete hone par use remove karen
      activeTasks.delete(chatId);
    }
  } else {
    // Default response agar 'veo3' prefix nahi hai
    await ctx.reply("Aapne koi command use nahi kiya. Video banane ke liye *veo3* likhein aur uske baad prompt dein. Example: `veo3 space ship landing on mars`");
  }
});

// ============ Webhook ============

app.post('/api/bot', async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Error handling update:', err);
    res.sendStatus(500);
  }
});

app.get('/api/bot', (req, res) => {
  res.send('Veo3 Video Generator bot is running.');
});

module.exports = app;
