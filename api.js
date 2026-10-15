require('dotenv').config();
const USE_MOCK = process.env.USE_MOCK !== 'false';
const BASE = process.env.API_BASE;
const KEY = process.env.BOT_API_KEY;

// ---------- MOCK (demo data, resets on restart) ----------
const mock = {
  balance: 32500, daysLeft: 12, streak: 12,
  budgets: {
    food: { limit: 12000, spent: 9500 },
    transport: { limit: 6000, spent: 2500 },
    data: { limit: 3000, spent: 1000 },
    entertainment: { limit: 4000, spent: 500 },
  },
  goals: [{ id: 'g1', name: 'Study laptop', saved: 15000, target: 180000 }],
};
const view = () => ({
  balance: mock.balance, daysLeft: mock.daysLeft,
  safeToSpendToday: Math.round(mock.balance / mock.daysLeft),
  streak: mock.streak,
  budgets: structuredClone(mock.budgets), goals: structuredClone(mock.goals),
});
const mockApi = {
  async linkAccount() { return { userId: 'demo-user' }; },
  async getSummary() { return view(); },
  async logExpense(u, { amount, category }) {
    mock.balance -= amount;
    if (mock.budgets[category]) mock.budgets[category].spent += amount;
    return view();
  },
  async addToGoal(u, goalId, amount) {
    const g = mock.goals.find((x) => x.id === goalId) || mock.goals[0];
    mock.balance -= amount; g.saved += amount; return view();
  },
  async transferBudget(u, from, to, amount) {
    mock.budgets[from].limit -= amount; mock.budgets[to].limit += amount; return view();
  },
};

// ---------- REAL (backend dev: make these endpoints exist) ----------
async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
  return r.json();
}
const realApi = {
  linkAccount: (code, chatId) => call('POST', '/api/bot/link', { code, chatId }),
  getSummary: (u) => call('GET', `/api/bot/users/${u}/summary`),
  logExpense: (u, e) => call('POST', `/api/bot/users/${u}/expenses`, e),
  addToGoal: (u, g, a) => call('POST', `/api/bot/users/${u}/goals/${g}/contribute`, { amount: a }),
  transferBudget: (u, f, t, a) => call('POST', `/api/bot/users/${u}/budgets/transfer`, { from: f, to: t, amount: a }),
};

module.exports = USE_MOCK ? mockApi : realApi;