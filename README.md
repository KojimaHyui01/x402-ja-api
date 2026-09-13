# x402-ja-api

日本語テキストを「構造化」して返すAPI群。AIエージェントが **x402** プロトコルで1コールごとにUSDCを払って使う。

| Endpoint | 価格 | 何をするか |
|---|---|---|
| `GET /v1/holidays?country=DE&year=2026&region=BY` | $0.005 | **200カ国以上**の祝日（州・地域別、英語名＋現地名、振替フラグ）。`date-holidays` データ |
| `GET /v1/business-day?country=SA&date=&add=` | $0.005 | 任意の国の営業日計算（その国の週末＝金土/金/土 も考慮） |
| `GET /v1/holidays/countries[?country=US]` | 無料 | 対応国一覧／地域コード一覧 |
| `GET /v1/jp/holidays?year=2026` | $0.005 | 国民の祝日一覧（振替休日・国民の休日込み、内閣府公式CSV、1955〜） |
| `GET /v1/jp/business-day?date=&add=&calendar=` | $0.005 | 営業日判定・N営業日後・月末営業日（`calendar=bank` で12/31〜1/3も休業扱い） |
| `GET /v1/jp/bank/resolve?bank=&branch=` | $0.02 | 銀行名・支店名の揺れ→金融機関コード・支店コード（候補＋確信度、全銀用半角カナ付き。zengin-code 1,146機関/29,000支店） |
| `GET /v1/jp/bank/lookup?bankCode=&branchCode=` | $0.005 | コード→正式名・カナ・半角カナ・種別 |
| `GET /v1/jp/name/parse?name=&kana=` | $0.02 | 姓名分割（辞書12k姓/76k名、分割99.7%）＋読み候補（確信度付き）＋パスポート式ローマ字。`kana` を渡せば決定的 |
| `GET /v1/jp/name/romaji?kana=` | $0.005 | かな→ヘボン式（外務省パスポート規則：長音省略・ン→M・促音・CH前T）＋OH式・マクロン・厳密表記 |
| `POST /v1/address/normalize` | $0.02 | 住所の表記揺れを吸収し pref/city/town/addr + 緯度経度を返す（デジタル庁アドレス・ベース・レジストリ / Geolonia） |
| `POST /v1/text/normalize` | $0.01 | 全角→半角、和暦→ISO日付、電話番号(E.164)/郵便番号/メール抽出 |
| `POST /v1/company/resolve` | $0.03 | 社名の揺れ→法人番号・正式商号・本店所在地・インボイス番号形式（国税庁 法人番号Web-API） |

無料で読めるもの: `GET /` `GET /health` `GET /openapi.json` `GET /.well-known/x402`

## 動かす

```bash
cp .env.example .env      # PAY_TO_ADDRESS を自分のウォレットに
npm install
npm run dev               # http://localhost:4021
npm run doctor            # 発見用ドキュメントと402応答の自己診断
npm run check             # 型チェック + テスト
```

未払いで叩くと `402` と `PAYMENT-REQUIRED` ヘッダ（base64 JSON）が返る:

```bash
curl -i -X POST localhost:4021/v1/text/normalize \
  -H 'Content-Type: application/json' \
  -d '{"text":"令和５年４月１日 ＴＥＬ ０３－１２３４－５６７８"}'
```

支払いを含むE2E（テストネット・買い手用の別ウォレットが必要）:

```bash
# Base Sepolia の USDC を https://faucet.circle.com で受け取っておく
BUYER_PRIVATE_KEY=0x... npm run probe -- http://localhost:4021 /v1/text/normalize
```

## 本番に出す手順

1. **ウォレット**: 受取専用のEVMアドレスを新規作成し `PAY_TO_ADDRESS` に設定（秘密鍵はサーバーに置かない。受け取るだけなので不要）
2. **Coinbase CDP**: https://portal.cdp.coinbase.com でAPIキーを発行 → `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`、`X402_NETWORK=base`
   （facilitator手数料: 1,000件まで無料、以降 $0.001/件。ガス代はfacilitator負担）
3. **法人番号API**: https://www.houjin-bangou.nta.go.jp/webapi/ でアプリケーションIDを申請 → `HOJIN_APP_ID`
   発行まで2〜4週間。届くまで `/v1/company/resolve` は 503 を返す
4. **デプロイ**: 恒久的なドメインが必須（x402scanはngrok等のトンネルを拒否）。Render / Fly.io / Railway の無料〜最小プランで十分。`PUBLIC_BASE_URL` を実URLに
5. **自己診断**: `npm run doctor -- https://your-domain`
6. **登録（発見されるため）**
   - x402scan: `POST https://www.x402scan.com/api/x402/registry/register-origin {"origin":"https://your-domain"}` または UI から
   - CDP Bazaar: 最初の決済が通ると自動索引（`declareDiscoveryExtension` 済み）
   - Circle Agent Marketplace: https://agents.circle.com/services の申請フォーム
   - x402Relay（日本）: https://x402relay.jp 系のカタログに申請

## 構成

```
src/
  config.ts            環境変数の検証（zod）。base 指定時は CDP キー必須
  lib/text.ts          純関数: 半角化 / 和暦 / 電話 / 郵便番号 / メール
  lib/address.ts       Geolonia 住所正規化のラッパー
  lib/csv.ts, hojin.ts 国税庁 Web-API v4 クライアント + CSV パーサ + チェックデジット
  lib/company.ts       名寄せ・ランキング
  lib/calendar.ts      日本の祝日・営業日計算（data/holidays.json を読む）
  lib/world-calendar.ts 世界の祝日・営業日（date-holidays、国別週末テーブル）
  lib/bank.ts          銀行・支店コード解決（zengin-code、表記揺れ・カナ・半角カナ）
  lib/romaji.ts        かな→ヘボン式ローマ字（パスポート規則）
  lib/name.ts          姓名分割・読み候補（data/names/dict.json）
  x402/catalog.ts      売り物の定義（価格・説明・スキーマ）= 唯一の正
  x402/server.ts       facilitator 選択・ルート設定・Bazaar 拡張
  routes/api.ts        有料ハンドラ（zod で入力検証）
  routes/discovery.ts  /openapi.json, /.well-known/x402, /health
  app.ts               Express 組み立て（テストは paywall:false / facilitator スタブ）
scripts/
  update-holidays.ts   内閣府CSV → data/holidays.json（年1回、翌年分が出る2月頃に実行）
  build-name-dict.ts   mecab-ipadic 人名 + MITデータセット → data/names/dict.json
  doctor.ts            デプロイ後の自己診断
  probe.ts             実際に払うクライアント
```

## 注意（法務・税務）

- USDC の受取自体に登録は不要。受け取った対価は円換算で**雑所得**、保有中の為替差損益も雑所得
- 法人番号データ利用時は「このサービスは国税庁法人番号システムWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない」旨の表示が必要（`/` のレスポンスに追加予定）
- 住所データは Geolonia（アドレス・ベース・レジストリ由来）。ライブラリの利用条件に従う
- 祝日データは内閣府「国民の祝日」CSV（政府標準利用規約 v2.0、出典明記）
- 世界の祝日は date-holidays（コードISC、データCC-BY-3.0、出典明記）
- 銀行・支店データは zengin-code（MIT、公開情報から自動収集）。`npm update zengin-code` で追従
- 人名辞書は mecab-ipadic（NAISTライセンス、`data/names/IPADIC-COPYING.txt`）と japanese-personal-name-dataset（MIT）由来

## 次にやること

- [ ] `PAY_TO_ADDRESS` を本物のウォレットに
- [ ] 法人番号 Web-API のアプリケーションID申請（リードタイムが一番長いので最初に）
- [ ] Render/Fly にデプロイ、`doctor` 通す
- [ ] x402scan / Circle / x402Relay に登録
- [ ] 死活監視（落ちたら通知）— 登録済みルートの79%が死んでいる市場なので、生きているだけで上位
- [ ] インボイス登録番号の**有効性検証**（国税庁 適格請求書発行事業者公表システム Web-API、別途ID申請）
