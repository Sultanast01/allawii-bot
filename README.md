# Allawii Telegram bot

Run: npm install, copy .env.bot.example to .env, fill TELEGRAM_BOT_TOKEN, then node index.js
The bot starts in mock mode (USE_MOCK=true). To go live: set USE_MOCK=false,
API_BASE and BOT_API_KEY in .env, then implement these endpoints.
Only api.js talks to the backend. All endpoints require: Authorization: Bearer <BOT_API_KEY>
(server-to-server secret, never in the frontend).

POST /api/bot/link  {code, chatId}  -> {userId}
   The app shows the user a 6-digit one-time code; this exchanges it for their userId.
GET  /api/bot/users/:id/summary -> {
   balance, daysLeft, safeToSpendToday, streak,
   budgets: { food: {limit, spent}, transport: {...}, data: {...}, entertainment: {...} },
   goals: [ {id, name, saved, target} ] }
POST /api/bot/users/:id/expenses {amount, category} -> updated summary
POST /api/bot/users/:id/goals/:goalId/contribute {amount} -> updated summary
POST /api/bot/users/:id/budgets/transfer {from, to, amount} -> updated summary

Rules: amounts are whole naira. Use the SAME functions the app uses to write data,
so the app and bot never disagree. Compute safeToSpendToday on the server.
Return the updated summary from every write endpoint.
