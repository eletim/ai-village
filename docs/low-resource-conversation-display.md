# 通常UIの初回会話読み込み改善

対象base: `226873e969fdfb62a2f0fc5409c17f6312362413`（作業開始時のintegration/event-driven-requestsと稼働checkoutが一致）。relay復旧、秘書追記、宛先変更の未承認branchを取り込んでいない。性能改善の実装担当による検証であり、独立レビューは依頼元で別途実施する。PRまで。秘書の明示反映指示まで統合・本番反映を保留する。

## 実測から選んだ変更

1. 通常UIのJS/CSS/module/HTMLを既存workspace JSONと同じgzip negotiationで配信する。従来は静的ファイルが未圧縮だった。本文・MIME・認証・HTMLの人間UI cookie・no-storeを維持し、Accept-EncodingをVaryに指定する。gzip拒否/非対応では元のbytesを返す。静的HEADは従来どおり404（新しい対応を追加しない）。圧縮は非同期zlibで、要求ごとの同期CPU圧縮ではない。同期/非同期の実行、通知、SQLite保存形式に変更はない。
2. `#agent-UUID`の初回はそのAgentの本文を最初のworkspace要求に含める。概要→本文の直列往復をなくす。存在・終了状態は応答の現行名簿で判定し、不明IDは通常表示、終了Agentは既存の履歴dialogへ戻る。概要だけの応答を「会話が空」と扱わない。hashのない全体/Project表示は従来どおり名簿から対象を決める。
3. 初回Agent選択を最初の描画前に確定する。本文を描画してから同じ選択のために再描画しない。scope切替では非表示になるAgentの古い本文を再解析せずDOMを解放する。データ/過去取得境界/スクロール保存/下書きは維持し、再表示時は現行snapshotから構築する。非表示の表示更新だけでは本文を取得しない。読み込み済み空・未取得を分ける。

本文・履歴・最初の100件という表示件数は削っていない。スケルトンや再訪cacheだけの改善ではない。役割や実行状態、正常終端、既読revision、成果採否、通知規則を変更していない。

## 方法と比較条件

`node scripts/performance/low-resource-probe.mjs`。専用port15810、毎回mkdtemp状態、HOME/CODEX_HOMEも一時directory、通知OFF、偽PurpleMux CLI（外部実行せずexit 1）。生成データのみ。3 Agent、各300履歴（短履歴は10）、1出力40行、半分は内部/折り畳み。秘書はconversation、リーダー/工房は過去の通常run履歴。これは実モデル/実仕事の受付試験ではない。

毎回新server/state、listen後2秒待機、presentation cacheを同じ読取でwarm化、新Context＋HTTP cache無効。サーバー起動coldは表示時間に混ぜない。既読ケースだけ事前viewを実行する。これらは全て隔離stateの操作。ブラウザChromium、1440×1000または390×1000。低性能条件はCDPでdown1.6Mbps/up750kbps、latency150ms、CPU4xを設定したemulation。物理スマホ/実回線ではない。サーバーCPUは制限していない。

薄い7条件で支配要因を調べ、最終の詳細比較は役割ごとの通常条件と重い秘書代表に絞った。通常・通信のみ・CPUのみ・併用、全体表示、短履歴、既読済みを計測。新Context初回後、未取得の次Agentへのhash切替も測定。既存204/32試行や全suiteを再演していない。

- firstText: 選択可視panelの実際の会話本文がDOMに存在し、loading=falseになったMutationObserver時刻。スケルトンは除外。
- paintedText: その後2rAF。実デバイスの画面走査完了を保証する指標ではない。
- interactive: 同2rAF後、表示中の入力欄をfocusして生成下書きを編集できた時刻。送信処理時間の指標ではない。偽CLIのため実Agentへの送信は行わない。
- background: 最初の表示後500ms観測窓に含まれる最後のworkspace応答終了。SSEは常時接続なので「永続的に同期完了」を意味しない。表示はこの後続同期を待たない。
- encoded/decodedはResource Timingの**応答body bytes**。HTTP headers/TLSを含む総線路bytesではない。CDP emulationのTTFB値は付加latency全体を表さない場合があるためresponse durationも保存。

再現例（baselineはbaseの別checkoutに同じprobe/instrumentをコピーしvendor生成後実行）:

```sh
PERF_PORT=15810 PERF_OUT=/tmp/low-example PERF_REPEATS=3 \
LOW_CASES='[{"role":0,"mode":"both","width":1440}]' \
node scripts/performance/low-resource-probe.mjs
```

## 結果

最終コード・長い秘書代表・併用PC・各3試行（非計装）:

| 指標 | base中央値 [範囲] | 修正後中央値 [範囲] |
|---|---:|---:|
| 実本文DOM | 3621.5 [3599.5–3622.6] ms | 2775.1 [2757.3–2831.6] ms |
| 2rAF | 3660.9 [3636.8–3663.4] ms | 2832.1 [2817.8–2897.0] ms |
| 入力欄操作 | 3664.1 [3639.6–3666.3] ms | 2835.2 [2820.9–2901.0] ms |
| 次Agent切替2rAF | 778.8 [762.0–809.3] ms | 729.6 [728.1–794.9] ms |

実本文は約23%短縮。切替差は小さく範囲も重なるので、大幅な切替改善とは主張しない。各3試行とも可視100件のtextContent SHA256が `7876c965413928c78a01056adddc5c81e8145b13b447696c5237fed356fba7c8` で一致。

代表trial0: 静的resource53要求、encoded313,369→119,330 bytes、decoded313,369→314,917 bytes。コード追加でdecodedは少し増えるが転送body約62%減。選択本文までのworkspace要求は2→1。API自体は従来からgzipで、body約526KB decoded/約20KB encoded。不要な他Agentの全履歴は要求しない。旧概要1,549/6,400 bytesの単純削減以上に直列待ちを削減した。API開始2697→2038ms、観測窓内の後続同期応答終了3967→3141ms。最初の本文はその前に使える。

薄い詳細matrix（各1試行、hidden本文skipの直前コードまで。**最終3試行と区別**）firstText:

| 条件 | base ms | 圧縮＋初回focus/描画整理 ms |
|---|---:|---:|
| 秘書 通常 PC | 252.7 | 193.7 |
| リーダー 通常 PC | 228.7 | 197.9 |
| 工房 通常 PC | 235.6 | 197.4 |
| 秘書 通信のみ PC | 3238.9 | 2385.1 |
| 秘書 CPUのみ PC | 678.3 | 660.6 |
| 秘書 併用 PC | 3588.5 | 2837.5 |
| 秘書 併用 390幅 | 3656.0 | 2886.7 |
| 全体3Agent 併用PC | 4576.2 | 3891.1 |
| 短履歴 併用PC | 3233.8 | 2365.4 |
| 既読済み 併用PC | 3665.4 | 2798.0 |

CPUだけでは安定した大きな改善を確認していない。第1段階（圧縮＋先行focusだけ）はCPU条件で708→877msと悪化し、初回重複描画を整理した。この失敗/中間結果も保存した。

## 内訳と限界

計装は各1試行の別群。計装値を非計装の主結果と混ぜない。

- 大きなJSON.parseはbase2.8ms/修正後4.3ms。JSON parseがこのfixtureの主因ではない。
- cache warmのpresentationは初回要求約0.03ms、既読後更新8.96→12.68ms。初期warm化18ms程度はナビゲーション外。
- 初回view保存: save準備12.59→12.44ms、commit1.13→1.20ms、directSave17.16→16.03ms。保存形式やlockを変更していない。baseでは本文要求とviewが重なり、修正後は本文先行・表示後にviewとなる。巨大実stateの保存競合を解消した証拠ではない。
- Layout/UpdateLayoutTree合計400.9→442.9ms（最初の表示後500ms観測窓を含む）。Layout改善を証明する値ではなく、残るCPU負荷。静的53moduleの取得/評価と遅いCPUでの100件描画が残る。
- server event-loop最大は全計測区間（起動含む）81.9/79.7ms。実native索引再構築や本番の共有lock競合は再現していない。専用fixtureであり、一般の本番10〜13秒の全原因を解消したとは言わない。
- 生成本文は反復が多く圧縮率が高い。実データの圧縮率/履歴量/同時Agent数/ネットワーク経路は異なる。弱い環境の保証値ではない。
- hashなしの全体・Project初回は概要→本文の2段階を維持。任意IDを前提にした並べ替えや所属の再実装は行わない。切替時の保存/描画、より大きい履歴の段階描画は残る検討点。

## 回帰と失敗履歴

- build、型チェック成功。通知OFFで関連単体/HTTP43件成功（gzip・identity、workspace delta/lazy body、履歴paging、readJSON、表示、access）。
- 関連ブラウザ30件成功: 初回focus/宛先/unknown/遅延古応答、scope切替・過去取得・下書き・再接続、scroll pending restoration/実wheel/破棄、画像wheel/pinch/close後preview、秘書previewのsession/run境界・1440/390、実HTTP会話完了/既読、slow HTTP retry。
- 追加した初回保存scroll400と終了Agent履歴/取得済み空を含む専用8件成功（前の6件を含む）。補足条件の実static gzip拒否/HEAD維持と別Project fallbackを2件で確認（1件追加、合計unique33）。本番入力・既読代行・外部通知・本番Agent操作なし。
- 最初の計測は新cloneのvendor未生成で起動失敗。build後に成功。
- 通常workshop履歴へfixtureを分けた際、conversationのrequestIdを残してmodel検証に失敗。次の試行は空IDのnewRun生成で失敗。生成過去runの正規モデル整合を直して成功。製品のエラーとして扱わず失敗履歴に保持。初回stdoutファイルは再実行で上書きしたため、端末に返ったエラーを `/tmp/low-resource-failure-history.txt` に別記した（元の全stdout保存ではない）。
- product回帰テストの失敗は今回なし。全suite/実モデル/物理端末/本番負荷試験は未実施。

## 証拠

- 集計: `docs/evidence/low-resource-display-summary.json`（各要求のURL/encoded/decoded/TTFB/duration、DOM時刻、試行数、計装群を含む）。
- 生データ: `/tmp/low-resource-{base,stage1,stage2,final-base,final-after,repeat-base,repeat-after,instrument-base,instrument-after}/`。
- ログ: 同名`.log`、`/tmp/low-resource-regression-unit.log`、`/tmp/low-resource-regression-browser.log`、`/tmp/low-resource-final-browser.log`、`/tmp/low-resource-supplement-browser.log`、build/type logs。
- baseline checkout `/tmp/low-resource-base-checkout`。作業clone `/home/eletim/ai-village-low-resource-display`。

## 反映前確認・backup・戻し方案

このPRでは反映しない。依頼元の独立レビュー→重要指摘修正→固定head/差分/この証拠を秘書へ提出し、明示反映指示を待つ。

許可後の担当者は、その時点の統合head・working tree・既存runtime識別を記録し、既存正式手順でSQLite整合backupと配信コードを保存する。設定/schema migrationはない。承認済み固定headだけを取り込み、生成vendor/buildと配信コードを確認する。新規通常閲覧でgzip/identity双方、cookie、初回本文/過去履歴/scroll/既読/画像を確認する。本番故障注入や既存Agentの停止/交換は不要。

戻す必要があれば、このPRの差分だけを統合branch上でrevertし、既存配信手順で前のfrontend/serverを配信する。SQLiteを古いbackupへ巻き戻して反映後の会話を消さない。backupは障害時の正式復旧用。no-storeなので旧ブラウザは通常再読込で整合する。mainマージは未許可。
