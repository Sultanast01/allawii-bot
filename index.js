require('dotenv').config();
const fs = require('fs');
const pkg = require('node-telegram-bot-api');
const TelegramBot = pkg.default || pkg.TelegramBot || pkg;
const api = require('./api');

const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!token) { console.error('Missing TELEGRAM_BOT_TOKEN in .env'); process.exit(1); }
const AUTO_LINK = process.env.USE_MOCK !== 'false';

const bot = new TelegramBot(token, { polling: true });
bot.on('polling_error', (e) => console.log('polling_error', e.code, e.message));

const naira = (n) => '₦' + Math.round(n).toLocaleString('en-NG');
const FILE = 'links.json'; // chatId -> userId (gitignored)
const links = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};
const saveLinks = () => fs.writeFileSync(FILE, JSON.stringify(links));

const kb = (pairs) => ({ reply_markup: { inline_keyboard: [pairs.map(([text, data]) => ({ text, callback_data: data }))] } });
const menu = { reply_markup: { keyboard: [
  ["What's my safe spend today?", "What's my balance?"],
  ['How are my budgets?', 'My savings goals'],
], resize_keyboard: true } };

async function withUser(chatId, fn) {
  let uid = links[chatId];
  if (!uid && AUTO_LINK) { uid = (await api.linkAccount('demo', chatId)).userId; links[chatId] = uid; saveLinks(); }
  if (!uid) return bot.sendMessage(chatId, 'Link your account first: open Allawii, copy your code, then send /link 123456');
  try { await fn(uid); }
  catch (e) { console.error(e.message); bot.sendMessage(chatId, "I'm having trouble reaching Allawii right now. Please try again in a moment."); }
}

const parseAmount = (t) => {
  const m = t.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?\b(?!\s*days?)/i);
  return m ? Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1)) : null;
};
const guessCategory = (t) =>
  /(rice|lunch|dinner|suya|food|snack|eat)/.test(t) ? 'food' :
  /(bolt|uber|bus|keke|transport|ride)/.test(t) ? 'transport' :
  /(data|airtime)/.test(t) ? 'data' :
  /(movie|game|party|fun|entertainment)/.test(t) ? 'entertainment' : 'other';

function nudge(chatId, cat, b) {
  if (b && b.limit > 0 && b.spent / b.limit >= 0.8)
    bot.sendMessage(chatId, `Your ${cat} budget is getting close to its limit. Want a simple adjustment?`,
      kb([['Show suggestion', 'sugg:' + cat], ['Not now', 'dismiss']]));
}

bot.onText(/\/start/, (m) => bot.sendMessage(m.chat.id,
  "Hi, I'm Allawii. Ask about your money, or say things like \"I spent 1500 on lunch\", \"save 2000\" or \"can I afford 6000?\"", menu));

bot.onText(/\/link (\d+)/, async (m, match) => {
  try {
    const { userId } = await api.linkAccount(match[1], m.chat.id);
    links[m.chat.id] = userId; saveLinks();
    bot.sendMessage(m.chat.id, 'Linked! Ask me about your balance or safe spend.', menu);
  } catch { bot.sendMessage(m.chat.id, 'That code did not work. Get a new one in the app.'); }
});

bot.onText(/\/demo_nudge/, (m) => withUser(m.chat.id, async (uid) => {
  const s = await api.getSummary(uid); nudge(m.chat.id, 'food', s.budgets.food);
}));

bot.on('message', (m) => {
  const t = (m.text || '').toLowerCase();
  if (!t || t.startsWith('/')) return;
  const id = m.chat.id, amt = parseAmount(t);

  withUser(id, async (uid) => {
    const s = await api.getSummary(uid);

    if (/afford/.test(t) && amt) {
      const ok = amt <= s.safeToSpendToday;
      return bot.sendMessage(id,
        ok ? `Yes, ${naira(amt)} fits today's safe amount of ${naira(s.safeToSpendToday)}.`
           : `${naira(amt)} is above today's safe amount of ${naira(s.safeToSpendToday)}. It could leave you short before payday.`,
        kb([['Buy it', 'buy:' + amt], ['Save it instead', 'goal:' + amt]]));
    }
    if (/\bsave\b/.test(t) && amt) {
      const g = s.goals[0]; if (!g) return bot.sendMessage(id, 'You have no savings goal yet. Create one in the app.');
      const n = await api.addToGoal(uid, g.id, amt), ng = n.goals.find((x) => x.id === g.id) || n.goals[0];
      return bot.sendMessage(id, `Saved ${naira(amt)} toward ${ng.name}: ${naira(ng.saved)} / ${naira(ng.target)}.`);
    }
    if (/(spent|paid|bought)/.test(t) && amt) {
      const cat = guessCategory(t), n = await api.logExpense(uid, { amount: amt, category: cat });
      await bot.sendMessage(id, `Logged ${naira(amt)} on ${cat}.\nBalance: ${naira(n.balance)}\nSafe to spend today: ${naira(n.safeToSpendToday)}`);
      return nudge(id, cat, n.budgets[cat]);
    }
    if (/safe|spend today/.test(t))
      return bot.sendMessage(id, `Your safe spending guide is ${naira(s.safeToSpendToday)} today. You have ${naira(s.balance)} available and ${s.daysLeft} days until your next allowance.`);
    if (/balance|how much.*(have|left)/.test(t))
      return bot.sendMessage(id, `You have ${naira(s.balance)} available with ${s.daysLeft} days to go.`);
    if (/budget/.test(t))
      return bot.sendMessage(id, Object.entries(s.budgets).map(([c, b]) => `${c}: ${naira(b.spent)} / ${naira(b.limit)}`).join('\n'));
    if (/goal|saving/.test(t))
      return bot.sendMessage(id, s.goals.map((g) => `${g.name}: ${naira(g.saved)} / ${naira(g.target)}`).join('\n') || 'No goals yet.');
    if (/streak/.test(t)) return bot.sendMessage(id, `Your streak is ${s.streak} days. Keep it going!`);
    bot.sendMessage(id, 'I can help with your balance, safe spend, budgets and goals, or log things like "I spent 1500 on lunch".', menu);
  });
});

bot.on('callback_query', (q) => {
  const id = q.message.chat.id;
  const [act, a, b, c] = q.data.split(':');
  bot.answerCallbackQuery(q.id);
  if (act === 'dismiss') return bot.sendMessage(id, 'No problem. I will keep an eye on it.');
  withUser(id, async (uid) => {
    if (act === 'buy') { const n = await api.logExpense(uid, { amount: +a, category: 'other' }); return bot.sendMessage(id, `Logged ${naira(+a)}. Balance: ${naira(n.balance)}.`); }
    if (act === 'goal') {
      const s = await api.getSummary(uid), n = await api.addToGoal(uid, s.goals[0].id, +a);
      return bot.sendMessage(id, `Saved ${naira(+a)}. ${n.goals[0].name}: ${naira(n.goals[0].saved)} / ${naira(n.goals[0].target)}.`);
    }
    if (act === 'sugg') {
      const s = await api.getSummary(uid);
      const from = Object.entries(s.budgets).filter(([k]) => k !== a)
        .sort((x, y) => (y[1].limit - y[1].spent) - (x[1].limit - x[1].spent))[0];
      const room = from[1].limit - from[1].spent, amount = Math.min(2000, room);
      return bot.sendMessage(id, `Move ${naira(amount)} from ${from[0]} to ${a}? ${from[0]} has ${naira(room)} unused.`,
        kb([['Apply', `apply:${from[0]}:${a}:${amount}`], ['Skip', 'dismiss']]));
    }
    if (act === 'apply') { await api.transferBudget(uid, a, b, +c); return bot.sendMessage(id, `Done. ${naira(+c)} moved from ${a} to ${b}.`); }
  });
});

// Proactive nudges (every 10 min, once per day per category)
const sent = new Set();
setInterval(async () => {
  const day = new Date().toDateString();
  for (const [chatId, uid] of Object.entries(links)) {
    try {
      const s = await api.getSummary(uid);
      for (const [cat, b] of Object.entries(s.budgets || {})) {
        const k = `${uid}:${cat}:${day}`;
        if (b.limit > 0 && b.spent / b.limit >= 0.9 && !sent.has(k)) { sent.add(k); nudge(chatId, cat, b); }
      }
    } catch (e) { console.log('nudge check failed', e.message); }
  }
}, 10 * 60 * 1000);

console.log('Allawii bot running' + (AUTO_LINK ? ' (mock mode)' : ''));