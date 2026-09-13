# ja-normalize-mcp

MCP server for [ja-normalize](https://x402-ja-api.onrender.com): worldwide public holidays and business-day math (200+ countries), plus Japanese address / personal-name / bank / company normalization and JPY crypto market data.

- **No setup**: the API gives every client IP a free daily quota, so the tools work out of the box.
- **Optional payments**: set `X402_PRIVATE_KEY` to a Base wallet holding USDC and calls beyond the quota are paid automatically via [x402](https://x402.org) (≈ $0.005–$0.03 per call). The key never leaves your machine.

## Install

Claude Desktop / Claude Code / Cursor — add to your MCP config:

```json
{
  "mcpServers": {
    "ja-normalize": {
      "command": "npx",
      "args": ["-y", "ja-normalize-mcp"],
      "env": { "X402_PRIVATE_KEY": "" }
    }
  }
}
```

Claude Code one-liner:

```bash
claude mcp add ja-normalize -- npx -y ja-normalize-mcp
```

## Tools

| Tool | What it does |
|---|---|
| `holidays` | Public/bank/school holidays for any country + region + year |
| `business_day` | Add/subtract business days in any country (local weekend aware) |
| `holiday_countries` | Supported countries / regions (free) |
| `jp_business_day` | Japanese business days from official 内閣府 data (月末営業日, bank calendar) |
| `jp_bank_resolve` / `jp_bank_lookup` | Bank & branch names ⇄ 金融機関コード / 支店コード, 全銀 half-width kana |
| `jp_name_parse` | Split a Japanese name, reading candidates, passport romaji |
| `jp_name_romaji` | Kana → Hepburn (外務省 passport rules) |
| `jp_address_normalize` | Address normalization + coordinates |
| `jp_text_normalize` | Full-width, 和暦, phone/postal/email extraction |
| `jp_company_resolve` | Company name → 法人番号 (NTA registry) |
| `jp_crypto_ticker` | JPY prices on Japanese exchanges + Japan premium vs USD |

## Env

| Variable | Default | Meaning |
|---|---|---|
| `JA_NORMALIZE_BASE_URL` | `https://x402-ja-api.onrender.com` | API base URL |
| `X402_PRIVATE_KEY` | – | Optional wallet key for paid calls (USDC on Base) |

Source: https://github.com/KojimaHyui01/x402-ja-api (MIT)
