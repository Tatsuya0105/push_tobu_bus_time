# 東武バス接近情報 LINE通知ツール - 仕様書

## 1. プロジェクト概要

東武バスのNAVITIME接近情報ページをスクレイピングし、バスの遅延情報をLINE Messaging APIで通知する自動化ツール。
平日朝の通勤時間帯にGitHub Actionsで定期実行され、設定した閾値以上の遅延が発生しているバスをユーザーに通知する。

## 2. システム構成

```
┌─────────────────────┐     ┌──────────────────────────────┐     ┌───────────────┐
│  GitHub Actions      │────▶│  tobubus-notify (TypeScript) │────▶│  LINE API     │
│  (cron: 5分間隔)     │     │                              │     │  (Push通知)   │
└─────────────────────┘     │  1. NAVITIME スクレイピング    │     └───────────────┘
                            │  2. 遅延フィルタリング         │
                            │  3. 通知送信                  │     ┌───────────────┐
                            │                              │────▶│  Console      │
                            └──────────────────────────────┘     │  (開発用)     │
                                         │                       └───────────────┘
                                         ▼
                            ┌──────────────────────────────┐
                            │  NAVITIME 東武バス             │
                            │  (Webスクレイピング対象)        │
                            └──────────────────────────────┘
```

## 3. 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| 言語 | TypeScript | ^5.3.3 |
| ランタイム | Node.js | >=20.0.0 |
| モジュール | ES Modules (ES2022) | - |
| HTMLパーサー | cheerio | ^1.0.0 |
| 環境変数 | dotenv | ^16.4.7 |
| TS実行 | tsx | ^4.7.0 |
| CI/CD | GitHub Actions | - |

## 4. ディレクトリ構成

```
tobu/
├── .github/workflows/
│   └── bus-notify.yml          # GitHub Actions ワークフロー定義
├── tobubus-notify/
│   ├── src/
│   │   ├── index.ts            # メインエントリーポイント
│   │   ├── types.ts            # 型定義
│   │   ├── scraper.ts          # NAVITIMEスクレイピング
│   │   ├── webhook.ts          # LINE Webhook サーバー (セットアップ用)
│   │   └── notifiers/
│   │       ├── console.ts      # コンソール出力 (開発用)
│   │       └── line.ts         # LINE Messaging API 通知
│   ├── dist/                   # ビルド出力
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                    # ローカル環境変数
│   └── .env.example            # 環境変数テンプレート
└── README.md
```

## 5. データモデル

### 5.1 BusApproach (バス接近情報)

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `routeName` | `string` | バス路線名 |
| `approachStatus` | `string` | 接近ステータス |
| `statusDetail` | `string` | ステータス詳細 |
| `departure.scheduled` | `string` | 出発予定時刻 |
| `departure.scheduledISO` | `string` | 出発予定時刻 (ISO 8601) |
| `departure.delayMinutes` | `number \| null` | 遅延分数 (定刻の場合null) |
| `departure.predicted` | `string \| null` | 出発予測時刻 |
| `departure.predictedISO` | `string \| null` | 出発予測時刻 (ISO 8601) |
| `arrival.scheduled` | `string` | 到着予定時刻 |
| `arrival.scheduledISO` | `string` | 到着予定時刻 (ISO 8601) |
| `arrival.delayMinutes` | `number \| null` | 遅延分数 |
| `arrival.predicted` | `string \| null` | 到着予測時刻 |
| `arrival.predictedISO` | `string \| null` | 到着予測時刻 (ISO 8601) |
| `estimatedTravelTime` | `string` | 所要時間 |
| `vehicleInfo` | `string` | 車両情報 |

### 5.2 Config (設定)

| フィールド | 型 | デフォルト値 | 説明 |
|-----------|-----|-------------|------|
| `departureBusstopId` | `string` | `00310821` | 出発バス停ID |
| `arrivalBusstopId` | `string` | `00310511` | 到着バス停ID |
| `delayThresholdMinutes` | `number` | `3` | 遅延通知閾値 (分) |
| `notification` | `"line" \| "console"` | `console` | 通知先 |
| `lineChannelAccessToken` | `string` | `""` | LINE APIアクセストークン |
| `lineUserIds` | `string[]` | `[]` | LINE ユーザーID (カンマ区切りで複数指定可) |

### 5.3 Notifier (通知インターフェース)

```typescript
interface Notifier {
  notify(approaches: BusApproach[]): Promise<void>;
}
```

## 6. 処理フロー

### 6.1 メイン処理 (`index.ts`)

```
1. dotenvで環境変数をロード
2. loadConfig() で設定を構築 (デフォルト値あり)
3. createNotifier(config) で通知先を決定
   ├─ "line"    → LineNotifier
   └─ "console" → ConsoleNotifier
4. fetchApproaches(departureBusstopId, arrivalBusstopId) でバス情報取得
5. filterByDelay(approaches, thresholdMinutes) で遅延バスを抽出
6. 遅延バスが存在すれば notifier.notify() で通知
7. 遅延バスが0件の場合はログ出力のみ
```

### 6.2 スクレイピング処理 (`scraper.ts`)

**対象URL:**
`https://transfer-cloud.navitime.biz/tobubus/approachings?departure-busstop={出発ID}&arrival-busstop={到着ID}`

**処理内容:**
1. Chrome UA偽装でHTTPリクエスト送信
2. HTMLレスポンスをcheerioでパース
3. `li > button.w-full` セレクタで各バス情報を抽出
4. 路線名: `h3 span` テキスト
5. ステータス: `.text-error` div
6. 時刻情報: `time` 要素の `datetime` 属性 + テキスト
7. 遅延分数: 正規表現 `/約(\d+)分遅れ/` でマッチング
8. 所要時間・車両情報: `dl dd span` テキスト

### 6.3 遅延フィルタリング

```
入力: BusApproach[], 閾値(分)
条件: departure.delayMinutes >= 閾値
出力: 条件を満たすBusApproach[]
```

## 7. 通知仕様

### 7.1 LINE通知 (`notifiers/line.ts`)

| 項目 | 値 |
|------|-----|
| エンドポイント | `https://api.line.me/v2/bot/message/push` |
| メソッド | POST |
| 認証 | Bearer Token (Channel Access Token) |
| メッセージ形式 | テキストメッセージ |
| 複数ユーザー | カンマ区切りIDで並列送信 (`Promise.all`) |

**メッセージフォーマット:**
```
🚌 {路線名}
状態: {ステータス}
出発: {予定時刻} → {予測時刻} (約{N}分遅れ)
到着: {予定時刻} → {予測時刻} (約{N}分遅れ)
所要時間: {所要時間}
```

**エラーハンドリング:**
- トークン・ユーザーID未設定時はコンストラクタでエラー
- API応答がnon-OKの場合はステータスコードとボディをログ出力

### 7.2 コンソール通知 (`notifiers/console.ts`)

- 開発・デバッグ用の標準出力
- 絵文字付きフォーマット (🚌, 🔴, ✅)
- セパレータ区切りで整形表示

## 8. GitHub Actions ワークフロー

### 8.1 トリガー

| トリガー | 条件 |
|---------|------|
| `schedule` | cron: `*/5 22-23 * * 0-4` (UTC) = JST 月〜金 07:00-08:59 / 5分間隔 |
| `workflow_dispatch` | 手動実行 |

### 8.2 ジョブ構成

```yaml
runs-on: ubuntu-latest
node-version: 20
working-directory: tobubus-notify/
```

### 8.3 ステップ

1. `actions/checkout@v4` - リポジトリチェックアウト
2. `actions/setup-node@v4` - Node.js 20 セットアップ (npm cache有効)
3. `npm ci` - 依存関係のクリーンインストール
4. `npx tsx src/index.ts` - メインスクリプト実行

### 8.4 環境変数

| 変数名 | ソース | デフォルト |
|--------|--------|-----------|
| `NOTIFICATION_TYPE` | ハードコード | `line` |
| `LINE_CHANNEL_ACCESS_TOKEN` | GitHub Secrets | - |
| `LINE_USER_ID` | GitHub Secrets | - |
| `DEPARTURE_BUSSTOP_ID` | GitHub Variables | `00310821` |
| `ARRIVAL_BUSSTOP_ID` | GitHub Variables | `00310511` |
| `DELAY_THRESHOLD_MINUTES` | GitHub Variables | `3` |

## 9. Webhookサーバー (`webhook.ts`)

LINE Bot初期セットアップ用のHTTPサーバー。ユーザーIDの取得に使用。

| 項目 | 値 |
|------|-----|
| ポート | 3000 |
| ヘルスチェック | `GET /` → 200 OK |
| Webhook | `POST /webhook` |
| 署名検証 | HMAC-SHA256 (LINE_CHANNEL_SECRET設定時) |

**対応イベント:**
- `follow` - 友だち追加 (ユーザーID取得)
- `unfollow` - ブロック
- `message` - メッセージ受信

## 10. 外部依存関係

| サービス | 用途 | 認証 |
|---------|------|------|
| NAVITIME 東武バス | バス接近情報のスクレイピング | 不要 (公開ページ) |
| LINE Messaging API v2 | プッシュ通知送信 | Channel Access Token |
| GitHub Actions | 定期実行基盤 | - |

## 11. NPMスクリプト

| コマンド | 説明 |
|---------|------|
| `npm start` | tsx で直接実行 (開発用) |
| `npm run build` | TypeScriptコンパイル → dist/ |
| `npm run serve` | コンパイル済みコードを実行 |
| `npm run webhook` | Webhookサーバー起動 |

## 12. 設計パターン

- **Strategy パターン**: Notifierインターフェースによる通知先の切り替え
- **Factory パターン**: `createNotifier()` による通知インスタンス生成
- **環境変数ベース設定**: dotenv + デフォルト値で柔軟な設定管理

## 13. 制約・注意事項

- NAVITIMEのHTML構造変更によりスクレイピングが壊れる可能性がある
- LINE Messaging APIの無料プランではプッシュメッセージ数に制限あり
- GitHub Actionsのcronは正確な実行タイミングが保証されない (数分のずれあり)
- User-Agent偽装によるスクレイピングのため、NAVITIME側のBot対策で遮断される可能性がある
