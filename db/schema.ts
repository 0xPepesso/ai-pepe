export const schema = {
  quotas: ['bucket TEXT PRIMARY KEY','used INTEGER NOT NULL','expires_at INTEGER NOT NULL'],
  reportCache: ['cache_key TEXT PRIMARY KEY','body TEXT NOT NULL','expires_at INTEGER NOT NULL'],
  snapshots: ['id INTEGER PRIMARY KEY AUTOINCREMENT','address TEXT NOT NULL','observed_day TEXT NOT NULL','observed_at TEXT NOT NULL','block INTEGER NOT NULL','market_cap_usd REAL','holder_count INTEGER','holder_count_exact INTEGER NOT NULL DEFAULT 0','top10_pct REAL','depth_usd REAL','risk_score INTEGER','lens_coverage INTEGER','body TEXT NOT NULL','UNIQUE(address,observed_day)'],
} as const;
