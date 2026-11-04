# Jojo 自動私訊程式（自己的 ManyChat）

IG 有人留言、回覆限動、或私訊打到關鍵字 → 自動私訊資料（可加按鈕、可先送「點我拿資料」按鈕），也可以在留言底下公開回一句。
三個帳號（jojotarot、jojodiy_1413、1413_lyz）共用一個後台。

- 跑在 Vercel（免費），資料存在 Neon（免費），不用在自己電腦開任何程式
- 後台：網站首頁，用 ADMIN_PASSWORD 登入
- IG 通知網址：/api/webhook；IG 授權回呼：/api/instagram/callback
- 每天自動更新 IG 授權（/api/cron/refresh）

## 環境變數
DATABASE_URL、INSTAGRAM_APP_ID、INSTAGRAM_APP_SECRET、FACEBOOK_APP_SECRET（選填）、WEBHOOK_VERIFY_TOKEN、ENCRYPTION_KEY、CRON_SECRET、NEXTAUTH_SECRET 或 SESSION_SECRET、ADMIN_PASSWORD、META_GRAPH_API_VERSION（選填，預設 v25.0）

## 測試
npm install && npm test
