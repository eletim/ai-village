# 別ホストのリーダー・工房から村への接続

## 原因と変更

従来は全Agentの固定起動契約に、村サーバーの`villageUrl`（dev.mjsではloopback）と、サーバー上の`resolve('scripts/village.mjs')`を入れていた。`direct.rules`は`notifier.status().officeUrl`で上書きしようとするが、現在のstatusにそのfieldはなく、fallbackが使われる。通知クリックURLをAPI到達先として公開する変更では解決しない。別ホストからはlocalhostが自分自身を指し、同じ絶対パスにCLIがある保証もない。登録済み別ホストの読取調査でも、従来のCLIパスが存在しなかった。

新規SSH Agentだけ、工房の`villageConnection`から実行ホスト上の接続を解決する。URL省略時は既存`VILLAGE_PUBLIC_ORIGIN`、または実際にlistenする既存VPN IPv4/portを使う。ブラウザOrigin/Hostや通知リンク、PurpleMux URLからは推測しない。HTTPS originまたはTailscale範囲IPv4のHTTP originだけを許可し、loopback、URL内の資格情報、query、pathを拒否する。server/access.mjsの認証・Host・Origin・VPN制約は変更しない。

CLI配置先と認証ファイルはホストごとに違うため明示設定する。認証ファイルの内容を村へ登録・転送しない。接続コマンドは他の村の認証・Agent selectorをlogin環境から引き継がないよう明示的に環境を設定する。CLIは既存認証ファイルを実行ホストで読み、Authorization headerに使う。HTTP redirectは追わず、接続失敗/HTTP認証エラーを案内し、自動再送しない。

新しいworkspaceを作る前に、登録済みSSH実行経路で生成した`env ... node CLI --connection-check rules get work`を実行する。Node/CLI/依存ファイル/認証/到達先/仕様revisionを読取確認できなければ、Agentやworkspaceを作らず案内する。CLIの接続確認versionと村のrevisionを照合するため、旧CLIの置き忘れも検出する。

接続設定は新runtimeへsnapshotとして保存する。再起動や工房設定変更で既存runtimeの起動契約を差し替えない。ローカルAgentと既存SSH Agentの起動文字列/hashはそのまま。既存runtimeが誤ったlocalhost契約を保持している場合は、自動修復したとは扱わない。`agents instructions AGENT_ID`のconnectionAccessで設定と次回起動条件を確認し、承認された新セッションへの移行が別途必要。runtime adoptionでは接続snapshotと固定読取selectorもruntimeに追従する。

remote CLIのrules読取には`--agent` selectorを自動付加し、サーバー側で接続URL/CLI表示を解決する。共有のpolicy revisionは維持する（接続表示差はpolicy変更ではない）。このselectorはread-onlyな表示指定で、Agent actor権限や操作許可を付与しない。raw rules APIにも`agentId`指定があり、新remote起動契約のURLに含める。

## 設定

既存の認証済み管理経路で`PUT /api/direct/workshops/WORKSHOP_ID`を使う。設定はSQLiteの既存工房レコードに保存される。例の値は実際の登録ホストの管理者が確認した値に置き換える。

```json
{"villageConnection":{"url":"https://village.example","cliPath":"/opt/ai-village/scripts/village.mjs","authFile":"/home/agent/.config/ai-village/auth"}}
```

- CLIにはこの版の`scripts/village.mjs`と相対参照先`src/upload-limits.js`が必要。Nodeは`node`で起動できること。単体コピーなら同じディレクトリ構造を維持する。
- HTTPS/サーバー認証有効時は実行ホスト上の既存認証ファイルが必須。ファイルは実行ユーザーだけが読める権限で管理する。秘密値をJSON、prompt、git、ログへ記載しない。
- URLを省略する場合、村の起動環境で既存PUBLIC_ORIGINまたはVPN listen設定が必要。CLIパスは省略不可。外部公開やVPN設定をこの機能が自動変更することはない。
- 設定は`null`で次回用の設定を解除できる。snapshot済みruntimeは変化しない。
- 工房配置自体は従来から対応済み。conversations.jobの宛先は既存Project.leaderAgentId固定でlocation=workshopを要求する。この宛先選択仕様は変更しない。リーダーの役割はProject設定で決まる。リーダーだけがSSH工房でも同じ経路を使い、ローカル秘書・ローカル工房には変更を要求しない。

## 検証

開始base `78e952421ece54329341473dd4ba3cb4443bb1fa`。作業中に既存PR171が統合されたため、最終base `a0e267af0a572ed5e62a68e39e31a1ce155fe3a2`へ今回の変更だけをrebaseし再検証。専用clone、通知OFF。依頼元が独立レビューを行うため、この検証は実装担当の検証であり独立レビュー済みではない。

- 新規境界6テスト：不正/loopback/資格情報URL、設定欠落、読取失敗時にworkspace未作成、remote起動文字列、scoped rulesとrevision、永続化・工房更新後snapshot保持、既存契約hash維持、runtime移動後selector、shell特殊文字、実HTTP CLI認証/401/接続不能/redirect拒否/秘密非出力。
- 既存関連を含む最終44/44成功。
- 全体単体（偽通知専用を除外）944成功・1skip・0失敗。fake notifierは環境変数解除の単独実行で7/7。最後の追加診断とloopback境界強化後に関連44件を再実行。最新base上で全単体を再実行し958成功・1skip・0失敗。
- 全Chromiumブラウザ256/256成功（隔離15682、既存ローカル/remote UI・会話・既読・通知・runtime migration表示を含む）。UI実装変更なし。最新base上では追加入力回帰も含め257/257成功。
- build、型、構文、diffチェック成功。buildと単体は逐次。
- 実別ホスト：正式名簿の登録済SSHホストを照合し、使い捨てディレクトリへCLIと依存1ファイルを配置。専用15681で生成fixtureの村を既存VPN IPv4にlistenし、既存accessPolicyを通して生成コマンドによるrules読取2回成功。connection-checkとremote用leader規則のCLIパス・revision一致を確認。実モデル/Agent/workspaceは起動せず、既存Agentの停止/交換なし。村の本番APIにテスト入力・既読操作・故障注入なし。

## 失敗履歴・限界

初回関連38件は旧remote fixtureが接続設定未指定のため30失敗、8成功。fixtureへ接続設定と読取受付を追加し38/38成功。初回全体単体はvendor未生成と通知OFFにより843成功・44失敗・1skip。build後に全単体を成功、偽通知は単独7件成功。失敗を隠して最初から成功した扱いにしない。

実別ホストはVPN HTTP読取のみ。実HTTPS reverse proxy/TLS/認証配置のend-to-endと実モデルの新規起動は未実施。HTTPS/認証失敗・secret非露出はfixture。既存Agentが保持する誤契約の交換は今回実施していない。別ホストのNodeやCLI配置・認証を管理者が用意する必要は残る。

## 反映・バックアップ・戻し方（未実施）

PRの固定headと独立レビュー結果を秘書へ提出し、明示反映指示を待つ。統合/mainマージ、本番反映、サービス再起動、runtime交換は未実施。

反映担当は既存の正式手順でSQLite online backupと整合確認、現行commit・service環境・工房接続設定を記録する。認証ファイルの秘密値はPRや報告に写さず、管理者の既存安全保管を使う。固定headを統合後、許可された手順で配信・稼働確認する。既存Agentの起動hashを維持し、新remote作成は設定確認後だけ行う。

コードを戻す場合は反映前commitへ戻す。新しい接続契約で起動したAgentがあると旧コードはその契約hashを理解できないため、単にコードを戻してそのAgentを継続利用できるとは扱わない。勝手な停止/交換をせず、該当runtimeの追跡と未完了仕事を確認して別途判断する。履歴を失うためDBを古いbackupへ機械的に巻き戻さない。設定変更だけなら工房の元設定へ戻す（既存runtime snapshotには影響しない）。

追加指示9090a22c/9af15575は全文を確認し本資料へ反映。Issueを仕様・操作許可として採用せず、人間の要望と実コードを根拠にした。通知URL責務、固定宛先、既存runtime無操作の境界を保持。
