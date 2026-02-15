import "dotenv/config";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const PORT = parseInt(process.env.WEBHOOK_PORT ?? "3000", 10);
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? "";

function verifySignature(body: string, signature: string): boolean {
  if (!CHANNEL_SECRET) {
    console.warn("[WARN] LINE_CHANNEL_SECRET が未設定のため署名検証をスキップします");
    return true;
  }
  const hash = createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

interface LineEvent {
  type: string;
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken?: string;
  timestamp: number;
}

interface WebhookBody {
  destination: string;
  events: LineEvent[];
}

const server = createServer((req, res) => {
  // ヘルスチェック用
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("LINE Webhook Server is running");
    return;
  }

  // LINE Webhook エンドポイント
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      const signature = req.headers["x-line-signature"] as string | undefined;

      if (signature && !verifySignature(body, signature)) {
        console.error("[ERROR] 署名検証に失敗しました");
        res.writeHead(403);
        res.end("Invalid signature");
        return;
      }

      try {
        const webhook: WebhookBody = JSON.parse(body);

        for (const event of webhook.events) {
          console.log(`\n--- イベント受信 ---`);
          console.log(`  種類: ${event.type}`);
          console.log(`  タイムスタンプ: ${new Date(event.timestamp).toISOString()}`);

          if (event.type === "follow") {
            const userId = event.source.userId;
            console.log(`\n  ★ 友達追加されました！`);
            console.log(`  ユーザーID: ${userId}`);
            console.log(`\n  → .env の LINE_USER_ID にこの値を設定してください:`);
            console.log(`    LINE_USER_ID=${userId}`);
          } else if (event.type === "unfollow") {
            console.log(`  ブロックされました: ${event.source.userId}`);
          } else if (event.type === "message") {
            console.log(`  メッセージ送信者: ${event.source.userId}`);
          } else {
            console.log(`  ソース: ${JSON.stringify(event.source)}`);
          }
        }
      } catch (err) {
        console.error("[ERROR] リクエストの解析に失敗:", err);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });

    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`LINE Webhook サーバーを起動しました: http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log("");
  console.log("--- 手順 ---");
  console.log("1. ngrok http 3000 を別ターミナルで実行");
  console.log("2. ngrok の HTTPS URL をコピー");
  console.log("3. LINE Developers コンソール → Messaging API → Webhook URL に設定");
  console.log("   例: https://xxxx.ngrok-free.app/webhook");
  console.log("4. 「検証」ボタンで疎通確認");
  console.log("5. LINE Bot を友達追加すると、ここにユーザーIDが表示されます");
  console.log("");
  console.log("待機中...");
});
