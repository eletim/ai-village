# VPN内の別端末から使う

2026-10-24、コアWSLの実インターフェースにTailscale IPv4 `100.78.154.38` が割り当てられていることを確認した。現在の接続先:

- コアのWindowsブラウザ: http://localhost:5173/office
- 同じVPNの端末: http://100.78.154.38:5173/office

## 起動

```bash
VILLAGE_VPN_ADDRESS=100.78.154.38 npm run dev
```

localhostと指定したVPNアドレスだけで待ち受ける。VPNアドレスは実際にこのPCへ割り当てられたTailscale IPv4でなければ起動しない。アドレスが変わったら実環境を確認して指定を更新する。通常の `npm run dev` はlocalhost限定のまま。

従来の `npm run dev -- --host 0.0.0.0` も互換入口として使える。全インターフェースへ公開するのではなく、割当済みTailscale IPv4が1つの場合だけ、そのアドレスとlocalhostへ個別にbindする。VPNアドレスが不明・複数なら明示設定を求めて停止する。LANやインターネットのインターフェースにはbindしない。

VPN側はsocketの実接続元もTailscale IPv4範囲であることを確認し、HostとOriginの完全一致を検証する。転送ヘッダーは信用しない。直接接続ではTailscaleのネットワーク認証・暗号化とACLを利用するため、この村を操作できるメンバーだけのVPNとして運用する。別のログイン画面は追加しない。現在はIPv4のIP URLで確認しており、任意のDNS名やVPN IPv6の直接接続は対象外。

## 既存のHTTPSプロキシ方式

既存の `VILLAGE_PUBLIC_ORIGIN=https://実際のDNS名:ポート` と `VILLAGE_AUTH_FILE=私有ファイル` によるHTTPSプロキシ・Basic認証のモードも残る。こちらはバックエンドをlocalhost限定で起動し、VPN限定のHTTPSプロキシを別途構成する場合の選択肢であり、直接VPN接続の必須条件ではない。認証ファイルは `user:20文字以上のpassword`、Git対象外に置く。このモードのプロキシ・TLS証明書は今回配置していない。

## 確認と通知

`ss -ltnp 'sport = :5173'` でlocalhostとVPNアドレスだけのlistenを確認する。工房PC E-ryzenからVPN URLのhealthと執務室のHTTP 200を実測した。通常のWeb UI・API・画像は同じoriginの相対URLなので、接続した端末のURLがそのまま使われる。

通知クリック先をVPN URLにしたい場合は起動環境の `VILLAGE_OFFICE_URL=http://100.78.154.38:5173/office` を設定する。通知のトークンや認証の問題は別であり、この設定だけで通知送信済みにはならない。CLIや変更反映のhealth確認は引き続きlocalhostを使う。

Windows実ブラウザや村長のスマートフォンでの到達は未観察。Tailscale ACL・OSファイアウォール・WSL設定は変更していない。
