# VPN内の別端末から使う

本変更ではコアへ接続・適用していない。読み取った原本は `scripts/dev.mjs`（既定127.0.0.1）、`scripts/supervise.mjs`、`scripts/village.mjs`、`server/development.mjs`、`server/notifier.mjs`、`village/development.md`、`village/workshops/first-workshop.md`、READMEと過去の検証記録。資料ではコアはWSL2、工房のPurpleMux URLは登録資料にある。工房のURLからコアのVPN種別・アドレスを推測していない。

UIのAPI、画像、資料、移動リンクは同一オリジン相対URL。通知先は `VILLAGE_OFFICE_URL`、工房端末リンクは工房資料の `purplemux_url`。CLIの `VILLAGE_URL`、反映時のhealth、Git逆転送のloopbackはローカルの制御経路で、別端末向けURLへ置き換えるものではない。

## 提供する構成

バックエンドはloopbackのみ（`--host` は127.0.0.1か::1）。外部接続は **確認したVPNアドレスだけで待ち受けるHTTPSプロキシ** を通す。全インターフェース待ち受け、HTTPでの認証情報送信、任意Host/Origin、インターネット公開はしない。プロキシからバックエンドへHostとAuthorizationを維持し、転送ヘッダーを認証根拠にしない。

コアで実アドレス・DNS名・証明書・既存プロキシを確認した後、私有設定を用意する。以下の `REPLACE_*` は実測値で置換する。認証ファイルをGitや資料へ入れない。

```bash
# 作成はコアで行う。既存ファイルを上書きしないこと。
# 私有ファイルには mayor:十分長いランダムパスワード の1行を保存し chmod 600。
export VILLAGE_AUTH_FILE=/REPLACE_PRIVATE_PATH/village-auth
export VILLAGE_PUBLIC_ORIGIN=https://REPLACE_CONFIRMED_VPN_DNS:8443
export VILLAGE_OFFICE_URL="$VILLAGE_PUBLIC_ORIGIN/office"
npm run dev -- --port 5173 --host 127.0.0.1
```

ブラウザはHTTP Basicのログイン画面を表示する。認証はサーバー側で毎要求に検証し、公開Host・localhostともHTML・API・画像すべてに適用。Hostをlocalhostへ書き換えても認証を省略しない。Originは設定したHTTPS originとの完全一致が必要。localhost制御口も同じ認証が必要。CLIと反映ヘルスチェックは同じ環境のVILLAGE_AUTH_FILEから認証を読み、出力には含めない。独立UIテストのサーバーはVPN設定を継承しない。認証ファイルの変更はバックエンド再起動が必要。

同じネットワーク名前空間にあるnginxを使う場合の設定ひな型（配置・起動は未実施）：

```nginx
server {
    listen REPLACE_CONFIRMED_VPN_IP:8443 ssl default_server;
    server_name REPLACE_CONFIRMED_VPN_DNS;
    ssl_certificate /REPLACE_PRIVATE_PATH/fullchain.pem;
    ssl_certificate_key /REPLACE_PRIVATE_PATH/privkey.pem;
    # DNS rebinding / 未登録Hostを拒否。バックエンド側でも再検証する。
    if ($http_host != "REPLACE_CONFIRMED_VPN_DNS:8443") { return 403; }
    client_max_body_size 9m;
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $http_host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Origin $http_origin;
        proxy_read_timeout 120s;
    }
}
```

実際に使うTLS証明書は全クライアントで信頼できるものを既存運用に従って設定する。VPNアドレスがWSLに存在するかWindows側だけに存在するかは未確認。Windows側で終端する場合は、そのVPNアドレス限定の既存プロキシからWSLのlocalhost転送が利用できるか実測する。WSLのNATアドレスを固定と仮定しない。必要な経路が存在しない場合はここで停止し、管理者が構成を判断する。ACL、OSファイアウォール、WSLネットワーク設定、portproxyは本作業で変更していない。

## 適用時の確認

1. コアがこのcommitを取り込み、通常の反映手順で検証する（本工房のPushだけでは反映されない）。
2. 実際のVPN、インターフェース、DNS、証明書、プロキシの有無とlisten先を確認し、ひな型へ実値を設定する。
3. `ss -ltn` 等でバックエンドがloopback、プロキシがVPNの単一アドレスであることを確認する。
4. 未認証で401、無関係なHost/Originで403、認証後に執務室・画像・TODOを利用できることを確認する。既存プロキシがHostを書き換えてローカル認証を迂回しないこと。
5. 同じVPNの別端末でログインし、TODO追加・編集の同期、画像添付、長い会話、通知URLの到達を確認する。工房の端末リンクは別サービスなので、そのログインと到達性も別途確認する。

工房内で実測できるのは独立loopbackポート、実Chrome、認証/Host/OriginのHTTP境界、複数ブラウザ同期まで。コアWSLの実ネットワーク、実VPN経路、別の物理端末、TLSプロキシの適用、通知の実受信は未確認。VPN種別やコアのアドレスは設定済みと主張しない。
