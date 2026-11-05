# Agentワークスペース（2026-11-05）

既存の [会話・起動・送信状態の修正](agent-state-and-chat.md) で左右の会話表示、起動入口、再読み込み時の下書き復元、バックエンド共通の送信可否を追加しました。

利用URL: http://100.87.176.23:5173/agents （VPN内）。`ai-village-direct.service` が稼働する開発ブランチの画面。旧3拠点固定の一覧を置き換える。

## 操作（左サイドバーと自動配置）

- 左サイドバー上部の **プロジェクト｜場所** で一覧を切り替える。初期はプロジェクトで、選択した分類だけを表示。**全部表示** は両モード共通の入口として1つ置く。工房は登録データから生成し、追加・編集を定期更新で反映する。
- 中央は最大9枚。デスクトップは4枚2×2、9枚3×3を基本に、利用可能な幅・高さへ適応する。狭幅は読みやすい列数と縦スクロールを優先する。手動分割指定はない。Project・場所・秘書は9人ごとの仮想グループ（名称末尾に(2)等）、全部表示は9枚ごとの前後ページで全員へ到達できる。作成時刻・IDの安定順で、状態の変化で並べ替えない。仮想グループで実所属や接続先を変えない。
- 各Agent右上の **拡大** を押すとそのAgentだけを表示。同じボタンが **一覧に戻る** に変わり、元の場所・一覧スクロールへ戻る。Escapeでも復帰できる。拡大中に別の場所を選ぶと拡大を解除する。拡大したAgentが終了した場合も一覧に戻る。
- 通常の管理は秘書へ依頼できる。手動操作はヘッダー・場所・Projectの **…** に集約。Agent追加、Project作成／名前変更、工房設定、終了履歴を開ける。Agentカードの **…** で表示名／Project所属の変更・解除・終了を行う。終了は確認チェックが必要。秘書不在の全体／Projectでは **秘書を追加** を表示する。ローカル実行環境が未登録ならその登録画面へ進み、保存後に秘書の起動画面を開く。秘書が応答不能でもメニューは使える。
- **工房設定** は登録／編集専用。起動ダイアログとは分離。指示送信・PurpleMuxリンク・終了操作は各Agentに属し、接続先の選択・送信処理は既存APIを維持する。
- 下書き・送信結果照合のrequestId・会話スクロールをAgentごとに保持。定期更新で入力DOMを作り直さない。Enter送信、Shift+Enter改行、IME確定保護は共通処理を継続利用する。

## Agentウィンドウの選択と確認状態（ユーザー修正を優先）

各返信の確認ボタン・チェック・既読表示・未確認件数を撤去。Agentカードへのクリック（pointerdown）またはキーボードフォーカス（focusin）で、そのAgentを選択する。カード本体もTabで到達可能。選択中は落ち着いた文字色・通常の太さの「選択中」、ヘッダー下辺の控えめな1px境界、aria-currentで示す。白枠・白いinset・選択による背景色の上書きは撤去。キーボードfocus-visibleのみ2pxの落ち着いた破線で識別できる。拡大・縮小も同じ選択を使う。全体／Project／場所／ページの選択だけではAgentを選択せず、その一覧への切替で選択を解除する。

Agent単位の控えめな「更新あり／確認済み」を表示する。idleを応答完了と推定しない。選択Agentの表示済み応答は、document.visibilityStateがvisible、document.hasFocus()がtrue、カードが現在の一覧に表示され、管理ダイアログに覆われていない場合だけ確認扱いにする。選択中に新しい完了が届いた場合も、表示へ反映後に同じ条件で確認する。ブラウザ非表示・非フォーカス中は新着を残し、復帰時に選択中のAgentだけを確認する。ダイアログを閉じた後も同様。履歴はAgent選択の変更、または会話領域へのクリック／フォーカスで確認し、履歴ダイアログを開いただけでは既定のAgentを確認しない。

POST /api/direct/agents/:id/view に画面が表示したAgentのrevisionを渡す。revisionは完了したnative session/turn（旧runはrun ID）の集合からサーバーが作るハッシュで、Agentごとに確認したrevisionを永続保存する。別sessionの同じturn IDは別の版となる。新着と競合した古いrevisionは409で拒否し、遅れたHTTP応答も新しい画面状態を上書きしない。返信ごとの既読管理はUIには出さない。以前の保存済み確認データは全件確認済みの場合だけ引き継ぐ。旧POST /api/direct/reviewsは撤去。

状態の●と枠色は作業中=青（既存#669eff）、応答完了=緑（MulmoTerminalのdone #22c55e）、完了の根拠がない待機=灰、入力待ち=黄、不明=紫。稼働状態がidleで、現在sessionの最新native turn（native情報がない旧データは最新run）が実際にcompletedの場合に緑とする。過去sessionの完了やidleだけでは緑にしない。新しい作業中・入力待ち・エラーは優先する。未確認完了だけ、done色20%と通常ヘッダー背景の混色、done色40%の2px静的リングを使う。確認後は面とリングを解除し、緑のborderと●を保持。中央とサイドバーは同じ判定と色を使い、サイドバーの未確認完了●も同系色リング。選択では色を変更しない。作業中ヘッダーはMulmoTerminalのbg-selected #1b3a6b、blockedはamberの薄い面。点滅・ぼかした発光・不透明度低下は使わない。これは通常応答完了の弱い表示であり、通知券による強い確認要求とは別。

強い「依頼完了・要確認」とfavicon警告は、正式なhumanRequestIdの全体完了だけに接続した。子Agentのturnや秘書の途中返答では出さない。最終完了はサーバーのRequestFlowが子結果の確認、finish操作、指定native turnの正常終了を照合して確定する。Agent選択で確認済みにし、全て確認したらfaviconが通常へ戻る。最終依頼IDもviewのrevisionに含めるため、古い応答の確認更新で新しい最終完了を消さない。通常の緑完了色はこの条件と独立して維持。通知券の消費と画面の確認状態は別。詳細は [依頼単位の通知](native-runtime-board.md#人間の依頼全体を1回だけ通知する実装2026-11-05)。

## 終了と履歴

バックエンドが `terminated` と確認したAgentだけを通常表示から除く。`stopping`、`stop_unknown`、接続不明を終了と推測して隠さない。データ削除は行わず、**終了Agentの履歴**から過去の指示・返答・通知結果を読める。通知のAgentリンクは稼働Agentを拡大し、終了Agentなら履歴ダイアログを開く。

## 参考にしたUI

ローカルの `/home/eletim/DevEnv/mulmoterminal-v1.2.0/` を実際に参照した。

- `src/components/terminalViewActive.ts`: devTerminalグリッドはexpandedのときだけactive、単体表示はactive。グリッドへの単なる表示や通常のセルfocusと、サーバーの確認状態は同一ではない。
- `src/components/Terminal.vue` のviewActive/pushView: 再接続・拡大変更でviewを送信。deactivate/unmount時にfalse、activate時に再送。
- `src/composables/useTerminalConnections.ts` のsendView、`server/session/pty-connection.ts` のapplyViewFrame: view(active=true)でsessionのwaitingを解除。
- `server/session/activity-hook.ts`: activeなpaneのStopはworkingを下げるだけ。inactiveのStopはwaitingを立てる。Notificationは入力待ちと区別し、agent_completed等の情報通知は除外。
- `src/components/attentionStatus.ts`、`cellStatusClasses.ts`: doneは緑の枠・ヘッダー・点、blockedはamber、workingはaccent、idleは通常表示。doneはturn完了であり、村が求める「人間の依頼全体」の完了保証ではない。
- `src/composables/useFaviconState.ts`: waitingをattentionとして優先。村ではその条件をコピーしない。
- このTerminal.vueのview送信経路にはdocument.visibilityState / hasFocus / window blurによる抑制はない（keep-aliveの非表示処理とは別）。村はユーザー意図に合わせ、明示的なAgent選択、ブラウザ表示・フォーカス・モーダルの条件を追加した。Mulmoの拡大必須条件もそのまま移植していない。
- 配置は前回同様 `src/components/gridLayout.ts`、`TerminalGrid.vue`、`CellChromeButtons.vue` を参考にしている。

## 今回の検証

- 単体・HTTPテスト98件、構文チェック、ビルド。
- 第1段階のUI関連20件：登録場所、33 Agent全件到達、4枚2×2・9枚3×3、確認競合・favicon復帰、自動配置、狭幅、拡大復帰、終了・履歴、空工房、ローカル／SSH工房と秘書それぞれの追加・送信先、下書き、スクロール、送信結果不明時の冪等性、IMEイベント順序差。
- 稼働サービスの `/agents` を実データで読み取り確認。全部表示・秘書・E-frontier・E-ryzenの表示、拡大復帰、390px幅、JSエラーなしを確認。確認のためのAgent起動・指示送信・通知送信は行わない。
- 静的ファイルと確認APIを反映し、バックエンド再起動後に読み取り確認。実運用の完了を既読にするテストは行わない。グリッドの証跡は `/tmp/ai-village-grid-four.png`、`/tmp/ai-village-grid-nine.png`。
- OSの実IME手操作は未実施。ブラウザテストではcompositionイベントとkeydown/keyupの順序差を再現する。

## 実行識別

前回導入したnative session／input／turn IDとランタイムイベントの仕組みを維持する。UI側で本文を解析したり、モデルに識別子・JSON・終了宣言を出力させたりしない。server／src／scriptsに旧実行マーカー・出力スキーマ指定がないことを再確認した。詳しくは [ランタイム制御](native-runtime-board.md) を参照。

## 旧UIの検証記録（今回の仕様ではない）

- 自動テスト84件成功。ランタイム識別、過去の結果、外部入力の競合、再起動、通信不明、通知などの既存テストを維持。
- ブラウザ自動テスト25件成功、既存条件付き1件skip。13 Agent／4工房＋秘書のデータで、最大9分割、次ページ、3段階絞り込み、タブ切替、独立スクロール、下書き保持、終了未確定の表示継続、終了確定後の除外、履歴、終了Agentへの通知リンクを検証。390px幅でもページ全体の縦横はみ出しなし。
- 実機検証は通常運用の登録データとは別の状態ディレクトリ・localhost:5186で同じコードを起動して実施。E-ryzenはローカル、E-frontierはSSHで操作し、2台を4つの論理工房として登録（物理PCが4台あるという意味ではない）。村長の家を含め計10個の専用Codexを起動して表示を確認。
- 実機のChromeでも9分割／10個目へのページ切替、5場所の選択、3段階絞り込みを確認。両PCで自由文の指示→native turn完了→追加指示→別turn完了を取得し、会話の独立スクロール・下書き保持・対象Agentの終了後の非表示と履歴閲覧を確認。JSエラーなし。
- 10個の検証Agentだけを終了し、すべてremainingOwned: 0を確認。検証前から存在したタブが残っていることも照合。通常運用のAgentは操作していない。
- 通知は検証用バックエンドのみ無効化。通常サービスのNotify設定・トークンは変更しない。今回、実配送を確認したとは扱わない。

実機の詳細結果・スクリーンショットは `.runtime/validation/tabs-*` に保存（Git対象外）。

## Projectと正式管理API/CLI（第2段階）

Projectは永続ID・名前・revisionを持ち、Agentは明示的なprojectId（1つ、未所属可）を持つ。場所・cwd・名前から推定しない。Project選択はPCをまたぐ所属Agentだけを表示する。Projectにも9枚ごとの仮想グループ、状態点、同じ拡大ボタンで一覧復帰を適用。所属変更で見えているAgentが対象外になれば一覧へ戻る。Projectは人間の依頼IDでも通知単位でもない。履歴を失う削除は今回追加せず、作成・名前変更・所属変更／解除を管理操作とする。

- GET /api/direct/agents: Agent識別情報、projectId/projectName、metadataRevision、Project一覧、登録工房、管理操作案内。
- POST /api/direct/projects: {requestId,name}。同じrequestIdは冪等、同名の二重登録は拒否。
- PUT /api/direct/projects/:id: {revision,name}。
- PUT /api/direct/agents/:id: {revision,name?,projectId?}。projectId:nullで解除。
- POST /api/direct/agents: 従来の起動引数にprojectIdを任意追加。POST /api/direct/agents/:id/stopは既存の正確な端末・プロセス所有確認を維持。

管理revisionは稼働ポーリングから独立し、古いrevisionの更新は409。AgentごとのロックとProjectのロック、既存の単一バックエンド所有・直列のatomic保存を使う。Agent起動のrequestIdは名前変更後も元の起動引数と照合する。

CLIはコアPCのリポジトリで（接続先が異なる場合はVILLAGE_URLを設定）:

```sh
node scripts/village.mjs help
node scripts/village.mjs agents list
node scripts/village.mjs projects list
node scripts/village.mjs projects create REQUEST_ID NAME
node scripts/village.mjs projects rename PROJECT_ID REVISION NAME
node scripts/village.mjs agents rename AGENT_ID REVISION NAME
node scripts/village.mjs agents project AGENT_ID REVISION PROJECT_ID
node scripts/village.mjs agents project AGENT_ID REVISION -
node scripts/village.mjs agents create '{"requestId":"unique-request-id","workshopId":"登録ID","cwd":"/登録済みパス","name":"Agent","provider":"codex","location":"workshop","projectId":"Project ID"}'
node scripts/village.mjs agents stop AGENT_ID
```

表示名の正本は村の保存データ。PurpleMuxの過去のラベルは変更せず、接続先/workspaceId/tabId/sessionNameも固定する。既存CLIに名前変更経路がないため、両者の文字列一致を識別条件にはしない。村のdiscoveryから正確な端末を引く。Project操作・表示名変更はランタイムへ入力しない。

第2段階の検証: 単体・HTTP100件（競合409、保存・再起動、HTTP/CLI操作、識別情報維持を含む）、UI22件（Project横断表示、9枚グループ、拡大復帰、所属変更、停止確認、秘書不在、編集中のpoll、IME）が通過。check/build/diff --checkも通過。稼働登録は汎用コードにIDを埋めずAPIで実施済み。

稼働反映: ai-village-direct.serviceを再起動。正式APIでProject「村実装」「blokus」を作成し、ユーザー指定の各2 Agentを登録、村実装の秘書を「秘書（村実装）」へ改名。登録前後の全Agentの接続先・場所・cwd・workspace/tab IDが不変であることを照合。blokusへの送信・停止なし。実ブラウザで全部表示の4枚2×2、各Projectの2枚、拡大と復帰、390px幅の横はみ出しなし、JSエラーなし、管理メニューを確認。スクリーンショットは /tmp/ai-village-stage2-all.png、-village.png、-blokus.png、-mobile.png。APIによる登録情報はサーバー保存済み。すでに開いているブラウザはページ再読み込みで新しいJSを読み込む。

今回の範囲外・未確認: 通知の依頼単位化と秘書への自動結果配送は設計のみ。既存通知経路を変更していない。実運用のAgentへの新規送信・停止・完了の既読化は検証操作として行わず、隔離テストで検証した。複数Project同時所属、Project削除は今回の操作仕様には含めない。

## Agent選択修正の検証

単体・HTTP100件、関連ブラウザ24件を実行。Agent単位の永続化、再起動、旧確認データの引継ぎ、session切替、古い版の拒否、クリック／Tab選択、選択中の新着、非表示・フォーカス喪失・モーダル抑制と復帰、別Agentへの選択変更中の競合、履歴、Project・9枚表示・IMEを含む。ブラウザの非表示／非フォーカス条件はテスト内でvisibilityState/hasFocusを制御して両条件を個別に検証する。実運用のblokusは送信・停止・選択確認の対象にしない。

稼働反映と画面確認: ai-village-direct.service再起動済み。実際の4枚2×2、通常favicon、返信確認ボタンなし、村実装Agentの白い選択枠と確認済みへの更新、各Project2枚、ビュー切替では選択解除、390px幅の横はみ出しなし、JSエラーなしを確認した。実画面検証の書き込みは村実装Agentの /view 1件のみ。他Agentの保存済み確認状態・Project所属・表示名・workspace/tab/session IDは変化なし。blokusへの送信・停止・選択確認なし。証跡は /tmp/ai-village-selection-live.png と /tmp/ai-village-selection-mobile.png。check/build/diff --check通過。ブラウザは再読み込みが必要。

## 配色・選択表示の調整

ユーザーの最新方針により白い全周outline（active 3px / selected 2px）とヘッダー4px白insetを撤去。固定色#273750での選択上書きも採用しない。実際に参照したMulmoTerminalのsrc/style.css（--done #22c55e、標準テーマ--bg-selected #1b3a6b）、cellStatusClasses.ts（doneリング40%・ヘッダー20%・dot）、attentionStatus.ts（working / done / blocked / idle）を基準にした。村では確認後も緑の完了border/dotを保つ点を今回のユーザー指定に合わせている。この配色調整時点では依頼単位の通知は未実装だった。その後の通知実装は上記「強い依頼完了・要確認」と別文書を参照。通常の緑完了を券の代用にしない方針は維持。

配色修正の検証結果: 単体・HTTP101件、関連UI25件、check/build/diff --check通過。稼働画面で青い作業中カードの選択／非選択と緑の完了カードを並べ、クリック選択のoutlineが全カードnone、中央と全サイドバーの●の実色一致を確認。未確認／確認済みの緑の面・リング差とキーボードfocus-visibleは隔離ブラウザでも確認。1440px・390pxでJSエラー、横はみ出しなし。静的JS/CSSは稼働URLに反映済み（再読み込みで取得）。実画面確認の書き込みAPI呼出しは0件、他Agentへの送信・停止なし。画像: /tmp/ai-village-quiet-selection-live.png、/tmp/ai-village-quiet-states.png、/tmp/ai-village-quiet-selection-mobile.png。

## サイドバー分類トグル

プロジェクトと場所を同時表示する代わりに、小さな2択ボタン（aria-pressed、Tab/Space操作可）で切替。localStorageのai-village-sidebar-v1にモードと各モードの直前の選択ID・9枚単位のページ位置を保存し、再読み込みでも復帰する。保存領域が利用できない場合は同一画面内のメモリで動作する。無効／削除済みID、別分類のID、存在しなくなった仮想グループは全部表示の先頭へ戻す。保存値が壊れていても初期値へ戻す。モード切替はAgent選択と拡大を解除し、確認APIを呼ばない。Project未所属Agentは全部表示と場所で引き続き到達可能。下書き・状態色・●・…管理・拡大からの一覧復帰は維持。

関連UI27件を検証対象とし、新規シナリオで各モードの選択／ページ保存と再読み込み、未所属Agentへの到達、下書き復元、キーボード切替、削除済み選択・過大ページ・不正保存値のフォールバック、切替時の確認API呼出し0件、狭幅を確認する。

トグルの検証結果: 関連UI27件、check/build/diff --check通過。稼働画面でも初期Project、各モードの一覧限定、村実装ProjectとE-ryzenの選択復元、再読み込み、全部表示1項目を確認。実画面の書き込みAPI呼出し0件、JSエラー・390px幅の横はみ出しなし。/tmp/ai-village-toggle-projects.png、-places.png、-mobile.pngに保存。狭幅の2択は文字が重ならないよう10px・余白を縮小。静的画面へ反映済み。
