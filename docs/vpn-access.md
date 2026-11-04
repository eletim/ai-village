# VPN内の別端末から使う

2026-11-04、現在の村長PC E-ryzen の `tailscale0` に Tailscale IPv4 `100.87.176.23` が割り当てられていることを確認した。以前のコアWSLの `100.78.154.38` とは異なる。現在の接続先:

- 村長PC: http://127.0.0.1:5173/agents
- 同じVPNの端末・直接操作: http://100.87.176.23:5173/agents
- 同じVPNの端末・村: http://100.87.176.23:5173/
- 同じVPNの端末・執務室: http://100.87.176.23:5173/office

## 起動

```bash
VILLAGE_VPN_ADDRESS=100.87.176.23 npm run dev
```

localhostと指定したVPNアドレスだけで待ち受ける。VPNアドレスは実際にこのPCへ割り当てられたTailscale IPv4でなければ起動しない。アドレスが変わったら実環境を確認して指定を更新する。通常の `npm run dev` はlocalhost限定のまま。

従来の `npm run dev -- --host 0.0.0.0` も互換入口として使える。全インターフェースへ公開するのではなく、割当済みTailscale IPv4が1つの場合だけ、そのアドレスとlocalhostへ個別にbindする。VPNアドレスが不明・複数なら明示設定を求めて停止する。LANやインターネットのインターフェースにはbindしない。

VPN側はsocketの実接続元もTailscale IPv4範囲であることを確認し、HostとOriginの完全一致を検証する。転送ヘッダーは信用しない。直接接続ではTailscaleのネットワーク認証・暗号化とACLを利用するため、この村を操作できるメンバーだけのVPNとして運用する。別のログイン画面は追加しない。現在はIPv4のIP URLで確認しており、任意のDNS名やVPN IPv6の直接接続は対象外。

## 既存のHTTPSプロキシ方式

既存の `VILLAGE_PUBLIC_ORIGIN=https://実際のDNS名:ポート` と `VILLAGE_AUTH_FILE=私有ファイル` によるHTTPSプロキシ・Basic認証のモードも残る。こちらはバックエンドをlocalhost限定で起動し、VPN限定のHTTPSプロキシを別途構成する場合の選択肢であり、直接VPN接続の必須条件ではない。認証ファイルは `user:20文字以上のpassword`、Git対象外に置く。このモードのプロキシ・TLS証明書は今回配置していない。

## 確認と通知

`ss -ltnp 'sport = :5173'` でlocalhostとVPNアドレスだけのlistenを確認する。別端末E-frontierからVPN URLの `/`、`/office`、`/agents`、JS/CSS、`/api/health`、`/api/direct` のHTTP 200を実測した。同じOriginのAPI取得は200、外部Originは403。村長PCの実ChromeでもVPN URLから工房・Agent一覧の描画を確認した。通常のWeb UI・API・画像は同じoriginの相対URLなので、接続した端末のURLがそのまま使われる。

通知クリック先をVPN URLにしたい場合は起動環境の `VILLAGE_OFFICE_URL=http://100.87.176.23:5173/office` を設定する。通知のトークンや認証の問題は別であり、この設定だけで通知送信済みにはならない。CLIや変更反映のhealth確認は引き続きlocalhostを使う。

Windows実ブラウザや村長のスマートフォンでの到達は未観察。Tailscale ACL・OSファイアウォール・WSL設定は変更していない。

## 稼働中サービスへの適用（2026-11-04）

`~/.config/systemd/user/ai-village-direct.service.d/vpn.conf` に次を設定して、daemon-reloadとサービス再起動を実施した。

```ini
[Service]
Environment=VILLAGE_VPN_ADDRESS=100.87.176.23
```

実測したNodeのlistenは `127.0.0.1:5173` と `100.87.176.23:5173` の2つ。LAN/wildcardでは待ち受けない。設定はサービス再起動後も有効。

変更前はTailscale ServeのHTTP 5173がVPN側ポートを占有し、VPN IP URLは404だった。`tailscale serve --http=5173 off` でこの設定だけ解除し、既存AI村の直接VPN bindへ切り替えた。8443のTCP転送とHTTPSの既存path設定は保持。変更前のServe設定は `.runtime/validation/tailscale-serve-before-vpn.json` に保存した。

通知対応は保留。Notify設定と通知クリック先は変更していない。

## ページ構成

- `/` は既存の村の俯瞰画面。村の地図、秘書との会話、旧job系の工房状況を表示する。
- `/office` は既存の執務室。`/` と同じ `index.html` / `src/main.js` を使い、pathnameに応じて執務室表示へ切り替える。秘書に相談・依頼する操作経路。
- `/agents` は独立した `agents.html` / `src/direct.js` の直接操作画面。工房・Agent・実行履歴を `/api/direct` から取得し、秘書を呼ばず操作する。旧jobの画面とは別の状態モデルで、直接操作のAgentは旧村の地図へ自動追加されない。

3ページとも同じバックエンド・ポートで提供する。村のヘッダーの「工房とAgent」から `/agents`、直接操作画面の「執務室へ」から `/office` へ移動できる。
