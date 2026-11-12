# Web読取と人間操作のアクセス境界

## 公開Web専用の読取

`web read URL` の通常HTTP(S)読取は、リダイレクトの各段でDNSの全回答を検査し、
一つでも非公開アドレスが含まれれば接続しない。検査済みのIPをNode HTTP(S)のlookupへ固定する。
元のホスト名はHost/SNI/証明書照合に使い、接続時のDNS再解決・接続プール・暗黙の転送・環境プロキシは使わない。
GitHub URLの専用読取も、実際に接続するapi.github.comを同じ方式で検査・固定する。
通常WebにはCookie/Authorizationを渡さない。既存のGitHub認証は固定GitHub APIだけで使う。

IPv4の拒否範囲:
`0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24,
203.0.113/24, 224/4, 240/4`。
IPv6は2000::/3内のみを候補にし、2001::/23、2001:db8::/32、2002::/16、3fff::/20をさらに拒否する。
loopback、ULA、link-local、multicast、IPv4射影、NAT64等は候補外。

[IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
と[IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/)
を参照した保守的な範囲指定。特殊用途範囲内の公開anycast例外も許可しない。
許可リストは設けていない。内部サービスは専用API等を利用し、Web読取の制限を回避しない。

限界: 範囲表は将来の割当て変更に追従が必要。複数DNS回答のうち一部が非公開の場合や特殊用途の公開例外も拒否する。
公開IPへの独自ルーティング/NAT、公開サイト自体の代理取得機能までは判定しない。
既存の本文上限・転送回数上限・タイムアウトは維持する。

## 人間専用操作の誤操作防止

`/api/direct/human/*` は、既存のHost・Origin・VPN peer・Basic認証の検査に加え、次をすべて要求する。

- 画面HTML配信時に発行した、サーバープロセスの秘密鍵で署名されたCookie。
  HttpOnly / SameSite=Strict / Path=/api/direct/human/、有効期限12時間。
  設定されたHTTPS公開OriginではSecureも付ける。HTTP VPNではSecureを付けない。
- UIの同一Origin fetchが付ける `X-Village-Human-UI: 1`。
- 正確に一致するOrigin。Sec-Fetch-Siteがあればsame-originのみ。
  非セキュアHTTPのVPN接続ではSec-Fetch-Siteが省略されるので、必須にはしない。

手掛かりが欠ける場合は403と短い説明を返す。期限切れ・サーバー再起動後は画面の再読み込みで更新する。
Agentのdelegate/finish/get/resultsなどにはこのCookie・ヘッダを要求しない。
人間専用のretry/resume/cancel/complete/cancel-queuedはCLI操作一覧・Agent向け規則に追加しない。

**これは人間の認証やAgentに対するセキュリティ境界ではなく、誤操作防止である。**
同じOSユーザーのAgentはファイル操作ができ、HTMLを取得してCookieやヘッダを再現することもできる。
curl等が手掛かりを意図的に再現することも防げない。既存のVPN・Basic認証は引き続き必要であり、この仕組みで置き換えない。

## 検証

内部IP直指定（IPv4/IPv6・IPv4の非標準表記を含む）、内部DNS・公開/内部混在回答、内部への転送を拒否。
公開IPの許可、接続lookupの固定、GitHub APIへの認証情報送信前の拒否をテスト。
HTTP loopback・HTTP VPN・HTTPS公開Originの判定、Cookie/ヘッダ/Origin欠落、改ざん・期限切れをテスト。

隔離サーバー・模擬Agentの実データを使い、PC幅、スマホ相当のタッチ環境、Basic認証付きローカルHTTPSプロキシで
実画面から完了扱い・取り下げ・再試行・送信待ち取消が200になることを確認。
同じブラウザコンテキストでもUIヘッダ/Originを付けないAPI要求は403、Agent用getは200。
既存のHTTPテストでdelegate/finish・通知・再起動・再試行の冪等性も検証する。
実端末・実VPN回線の試験は行っていない（VPNアドレスとpeerの判定は単体テスト）。
公開Webのネットワーク成功例は決定的なモックで検証し、外部サイトの稼働状況には依存しない。

HTTPSプロキシは既存の構成同様にHost/Origin/Authorizationを保持し、さらにCookieと
X-Village-Human-UIヘッダを転送する必要がある。Sec-Fetch-Siteを除去してもCookie・Origin・専用ヘッダの検査は残る。
