const fs = require('fs');
const path = require('path');

const SPRITE_ROWS = [
  'architect',
  'developer',
  'reviewer',
  'moderator',
  'researcher',
  'analyst',
  'designer',
  'writer',
  'legal',
  'finance',
  'operations',
  'sales',
  'marketing',
  'product_manager',
  'customer_support',
  'qa_auditor'
];

function normalizeName(value) {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
    .toLowerCase();
}

function normalizeToken(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, ' ');
}

function getStableIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function resolveSpriteRow(agent, fallbackIndex) {
  const identity = `${normalizeToken(agent?.name)} ${normalizeToken(agent?.role)}`;
  const matches = (pattern) => pattern.test(identity);

  let result = getStableIndex(agent?.name || '') % SPRITE_ROWS.length;

  if (matches(/\barchitect|architecture|system design\b/)) result = SPRITE_ROWS.indexOf('architect');
  else if (matches(/\bdeveloper|doer|implementer|implementation|coding|software\b/)) result = SPRITE_ROWS.indexOf('developer');
  else if (matches(/\bmoderator|facilitator|room moderator\b/)) result = SPRITE_ROWS.indexOf('moderator');
  else if (matches(/\bdesigner|design|ux|ui\b/)) result = SPRITE_ROWS.indexOf('designer');
  else if (matches(/\bwriter|reporter|editor|documentation|summary|screenwriter|story\b/)) result = SPRITE_ROWS.indexOf('writer');
  else if (matches(/\bproduct|requirements|scope|priorit\b/)) result = SPRITE_ROWS.indexOf('product_manager');
  else if (matches(/\bqa|quality|auditor|test|validation\b/)) result = SPRITE_ROWS.indexOf('qa_auditor');
  else if (matches(/\breviewer|review|critique\b/)) result = SPRITE_ROWS.indexOf('reviewer');
  
  // Specific asset/trading subroles mapped to different sheets for maximum visual variety
  else if (matches(/\bcrypto|bitcoin|blockchain\b/)) result = SPRITE_ROWS.indexOf('finance');
  else if (matches(/\btrader|trade|technical analyst\b/)) result = SPRITE_ROWS.indexOf('sales');
  else if (matches(/\bfx|forex|commodit|commodity\b/)) result = SPRITE_ROWS.indexOf('operations');
  else if (matches(/\bmacro|strategist\b/)) result = SPRITE_ROWS.indexOf('researcher');
  else if (matches(/\brisk|legal|policy|compliance|contract|security\b/)) result = SPRITE_ROWS.indexOf('legal');
  else if (matches(/\bequity\b/)) result = SPRITE_ROWS.indexOf('analyst');
  
  else if (matches(/\banalyst|analysis|technical|risk manager\b/)) result = SPRITE_ROWS.indexOf('analyst');
  else if (matches(/\bfinance|budget|pricing|forecast|cost\b/)) result = SPRITE_ROWS.indexOf('finance');
  else if (matches(/\boperations|workflow|sop|logistics|producer\b/)) result = SPRITE_ROWS.indexOf('operations');
  else if (matches(/\bresearch|source|citation\b/)) result = SPRITE_ROWS.indexOf('researcher');
  else if (matches(/\bsales|pitch|customer|negotiation\b/)) result = SPRITE_ROWS.indexOf('sales');
  else if (matches(/\bmarketing|campaign|positioning|audience\b/)) result = SPRITE_ROWS.indexOf('marketing');
  else if (matches(/\bsupport|help|ticket|faq\b/)) result = SPRITE_ROWS.indexOf('customer_support');

  return result;
}

// Test case simulations from user log
const simulatedAgents = [
  { name: "Crypto Analyst", role: "Crypto / Digital Asset Analyst" },
  { name: "Equity Analyst", role: "Equity Analyst (Thai and Global)" },
  { name: "Technical Analyst", role: "Technical Analyst / Trader" },
  { name: "FX & Commodities Analyst", role: "FX and Commodities Analyst" },
  { name: "Macro Strategist", role: "Macro Strategist" },
  { name: "Risk Manager", role: "Portfolio Risk Manager" }
];

simulatedAgents.forEach((agent, index) => {
  const spriteIdx = resolveSpriteRow(agent, index);
  console.log(`Agent: ${agent.name} | Role: ${agent.role} | Sprite: ${spriteIdx} (${SPRITE_ROWS[spriteIdx]})`);
});
