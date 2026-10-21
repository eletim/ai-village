# 最初の実動版：実環境検証

実施日時：2026-10-21 23:46〜2026-10-22 00:04 JST。コアはWSL2 Ubuntu 22.04、Node v24.22.1、Codex CLI 0.163.0。工房は`ssh E-ryzen`で接続し、PurpleMux 0.5.6（8022）とCodex CLI 0.163.0を使用した。

## 実際に実行した依頼

コアで`npm run dev`を起動し、PlaywrightのChromiumから依頼欄へ入力して送信ボタンをクリックした。

> AI村の工房からの便りを表す、小さな日本語の一枚HTMLページ greeting.html を作ってください。ライト配色で「AI村へようこそ」と表示し、ボタンを押すと挨拶が変わるように。外部依存なし。実際に簡単な動作確認をして、成果と確認結果を報告してください。

- job：`e378dee2-0279-467a-956f-610b7c55bd1a`
- 専用workspace：`ws-oKlVAA`（AI村 e378dee2）
- Codex tab：`tab-8S-z_w`（レン · 第一工房）
- Agent session：`01a15ef6-39f3-7793-a6e6-7b98e29381ad`
- 成果物：工房の`/home/eletim/ai-village-workshop/e378dee2-0279-467a-956f-610b7c55bd1a/greeting.html`
- 端末リンク：`http://e-ryzen.tail6bc726.ts.net:8022/?workspace=ws-oKlVAA&tab=tab-8S-z_w`

コアの実際のCodexが日本語の指示を生成し、バックエンドがSSH経由のPurpleMux CLIでworkspace/tabを作成、自然文を送信した。工房のCodexがHTMLを制作し、自然文で報告した。`tab result`の結果を受け取った後、コアの実際のCodexが別の呼び出しで人間向けレポートを生成した。

時刻は以下のように別々に記録された。

- 依頼受付：2026-10-21 23:55:42 JST
- 工房へ送信：23:55:58 JST
- 工房の完了取得：23:57:51 JST
- 秘書のレポート完成：23:57:59 JST

## 確認できたこと

- 初期のレンは待機。実ジョブの`cliState=busy`中に、ChromiumでSVGの`hammering`状態とトンカチの動きを確認。
- 工房終了後はレンが待機へ戻り、秘書の報告作成中を別表示。その後UIの会話欄に実際のCodexによる成果レポートを表示。
- 工房の自然文報告、秘書の指示、両方の完了時刻がUIと`.runtime`に保存される。
- 詳細のリンクに上記workspace/tabが設定され、クリックでPurpleMuxの別ウィンドウへ遷移する。
- CLIのworkspace/tab一覧、および指定URL上の`/api/cli/workspaces`でも、作成したworkspaceの存在を確認。
- 工房の制作物をSSHで確認し、コアへコピーした同じHTMLをChromiumで開いて見出し、ボタンによる挨拶の変化、4回で一巡、390px幅で横スクロールが出ないことを確認。JavaScriptの例外なし。
- 工房のAgent自身からもChromeでの表示・ボタン・スマートフォン幅の確認済み報告を受け取った。
- 実ジョブ完了後のブラウザ再読込でもレポートを表示し、レンは待機。バックエンド再起動後の保存結果の復元も確認。
- UIの模擬APIテストでは旧デモの全時間を超えて時計を進めても、実状態とレポートが上書きされないことを確認。

ブラウザ確認中に作業中の村民のクリックがSVG内で外れる問題を発見し、透明なクリック領域を追加した。作業中の直接クリック、工房内のレン選択、完了後の直接クリックを再確認した。

## 未確認と制限

PurpleMuxのブラウザは未ログイン状態で、リンク先から`/login`へ戻った。CLIの既存認証はAPIには利用できたが、稼働中のPurpleMuxのページ表示には利用できなかった。パスワードや認証設定は変更していない。したがって、**通常ブラウザでログイン後に対象tabの実端末が表示されることは未確認**。リンク形式はPurpleMuxソースの`use-deep-link.ts`と照合済み。ログイン後に村のリンクをもう一度開く手順をREADMEに記載した。

Windows上のブラウザでの操作は未確認。ブラウザの実行はコア側のヘッドレスChromiumで行った。WindowsからはWSLのlocalhost転送を使い`http://localhost:5173`を開く。

## 既存セッションへの配慮

探索時には専用workspace`ws-ExW7-c`（ai-village-live-validation）の専用tab`tab-E0Sh22`で`probe.txt`の生成を確認した。本番のUI依頼には別の新規workspaceを使用した。既存セッションの停止・再起動・削除や、PurpleMuxソース・設定の変更は行っていない。検証で作成したworkspaceと成果は追跡用に残している。

スクリーンショット、取得済みHTML、実ジョブの生の記録はコアの`.runtime/`に保存した（git対象外）。
