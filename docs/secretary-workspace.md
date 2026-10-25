# 秘書専用の永続作業場所

村長発言 `90a22eef-b372-4da3-9094-1c4d4dc7eefe` に関する今回の依頼を実装。元発言の稼働コア内原文は読んでおらず、工房に届いた指示を仕様とした。稼働コア・他workspace/tab/仕事には接続していない。

## 会話からの経路

既存のSecretariatはCodexの新規/再開セッションから構造化actionを受け取り、シェルを直接使わせずホストで処理する。今回も`village` action → `VillageOperations`の共通レジストリ → `Scratch`を使用する。新しい自由なホストshell actionは追加しない。manualの当該ターン読取・変更操作のwrite-ahead記録・既存復旧・通知・簡潔な報告方針は維持。既存セッションにもprotocolVersion 7の更新でscratchと信頼済みworkspaceの区別を案内する。

操作一覧と引数は[manual](../village/manual.md#秘書専用の永続作業場所)。Pythonは汎用コードであり、PNG固定コマンドではない。メモ・データ加工・ファイル生成・Pillow描画などに利用可能。外部調査、SSH、工房起動、反映、承認・解放は既存窓口でのみ扱う。

## 強制する境界

- bubblewrapのuser/mount/PID/network/IPC/UTS等の名前空間を分離し、全capabilityを破棄。新セッションとdie-with-parentで親の終了時にも隔離プロセスを終了する。
- ルートは読取専用。ホストのHOME、コアソース、状態、認証ストア、SSHソケット、他仕事はマウントしない。環境は空からPATH・PYTHONPATH・HOMEだけを構築。端末やホストsocketも継承しない。
- 読取専用で見えるものは `/usr/bin`、`/usr/lib`、`/lib`、`/lib64`、日本語フォント、明示したPython依存パッケージディレクトリ、固定runner。これは信頼済みの公開ランタイム領域であり、運用者はここへ秘密・業務ソースを置かないこと。任意の追加マウントを会話から指定できない。
- `/proc`は新PID名前空間のproc。デバイスは読取専用bindしたnull/urandomのみ。書込み領域はサイズ64MiBの `/work` tmpfsだけ。cwd指定を隔離に用いていない。
- seccompをコード評価より前にロード。fork/clone/exec、socket、mount/setns/unshare、ptrace、keyring、process_vm、io_uring、BPF、memfd/SysV共有メモリ等を拒否する。Pythonの言語レベル制限ではないためctypes経由も同じカーネル制限を受ける。フィルタ設定失敗時はコードを評価しない。
- CPU hard limit 5秒、AS hard limit512MiB、単一ファイル8MiB、FD64、core dump無効。子プロセス・スレッド生成を禁止してRLIMITのプロセス増殖による回避を防ぐ。ホスト監視でも10秒で終了。シリアライズ成果を含むstdoutは24MiB、stderr16KBで強制終了、返却テキストは16000文字まで。

これはLinuxカーネルを共有する隔離でありVMではない。カーネルや信頼済みランタイムの脆弱性を無効化する保証はない。コア側で同じ設備と境界テストを実施してから有効にする。

## 保存・中断・公開

永続領域は`VILLAGE_STATE_DIR/secretary-work`。任意コードから直接マウントしない。ホストが前回のファイルsnapshotをstdinで渡し、隔離領域に復元する。コード終了後に単一階層・通常ファイル・リンク数1を検査して持ち帰り、ホストでも名前・個数・base64・容量を再検査し、atomic renameでsnapshotを更新する。100ファイル・合計16MiB。symlink、hardlink、ディレクトリ、絶対パス、`..`は取り込まない。作業領域の変更を伴うwrite/runは同時に1件。

runは実行前にUUID・開始時刻・コードhashを記録。終了状態・終了時刻・出力を保存。再起動後のrunningはunknownとして照会でき、同じUUIDは再実行しない。ファイル保存後、終了記録前に落ちた場合は新しいファイルが残ってもunknownのまま。既存の会話操作記録も中断した変更を再送しない。cancelは当該実行だけを停止する。強制停止・異常プロトコルのファイルは保存せず前回snapshotを維持する。普通のPython例外では正常に検査できた途中ファイルを保存しfailedとする。

PNGは既存ImageStoreでデコード検証・再エンコードして登録。`read_image`の実画像入力を経て`reply.attachments`で表示。その他はID付き不変snapshotのダウンロードのみ。任意パスをURLに使わず、既存HTTP認証/Origin境界の内側で配信。octet-stream、attachment、nosniff、CSP sandboxを設定し、HTML/SVG等をinline実行させない。会話テキストは従来どおりescapeし、このローカルURLだけリンク化する。

実行記録・公開snapshotは永続保存するため累積容量は増える。保存上限は各実行と現在の作業ファイルに対するものであり、履歴全体のディスクquota/自動削除は未実装。現行村と同じく1つの状態ディレクトリにつきバックエンド1プロセスで運用する。ホスト障害時のfsyncによる耐電断保証はない。

## 導入と再現

Linux x86_64、Python3、libseccomp.so.2、Noto CJKフォント、bubblewrapの`--size`対応版が必要。今回の工房の既設bubblewrapは`--size`未対応で、当初の実行はfail closedになった。0.11.0を工房内でビルドして成功した。Ubuntuの管理者が事前に必要なシステム依存を用意する場合のパッケージは `python3 python3-pip gcc pkg-config libcap-dev libseccomp2 fonts-noto-cjk`。この仕事ではsudoやホストパッケージ変更をしていない。

リポジトリルートで `sh scripts/setup-scratch.sh "$PWD/.runtime/scratch-tools"`。Pillow12.3.0、Meson1.12.1、Ninja1.13.2をローカルに導入し、bubblewrap v0.11.0（commit `9ca3b05ec787acfb4b17bed37db5719fa777834f`）をビルドする。依存は導入時だけネットワーク取得。実行中のコードにはネットワークを渡さない。依存ディレクトリは任意コードに対して読取専用だが、ホスト管理者が信頼して管理する必要がある。

```sh
export VILLAGE_SCRATCH_RUNTIME="$PWD/.runtime/scratch-tools/python"
export VILLAGE_SCRATCH_BWRAP="$PWD/.runtime/scratch-tools/bubblewrap/build/bwrap"
npm run check
npm test
VILLAGE_TEST_PORT=5298 VILLAGE_TEST_STATE="$PWD/.runtime/scratch-ui" \
 VILLAGE_TEST_CODEX_BIN="$PWD/tests/fixtures/secretary-codex.mjs" \
 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:ui
npm run build
git diff --check
# opt-in: インストール済み実Codexを使う。独立したlibrary/state/portで実行。
node scripts/verify-scratch.mjs
```

`VILLAGE_SCRATCH_RUNTIME`未設定、bwrap/seccomp/namespace不足ならコード実行は失敗し、ホストshellへフォールバックしない。標準Nodeテストはランタイム未設定時に実隔離ケースを明示skipする。今回の実測は設定して実行した。フォントは `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`。

## 旧成果の検証記録（今回の実測ではない）

- fixtureと実隔離: `tests/scratch.test.js`。パス拒否、資料永続化、通常ファイルのみ、fork/socket/領域外書込み拒否、CPU/メモリ/出力/ファイル容量、cancel、実バックエンドSIGKILL後のunknown照会・再送拒否、fixture秘書のrun→publish→read_image→reply。
- UI fixtureと実隔離: `tests/browser/scratch.spec.js`。HTTP経由の生成・公開、HTML添付download、安全なリンク、Origin拒否、日本語PNG表示・reload。会話部分はfixtureであり実LLMの能力検証とは区別する。
- 実Codex・実Chrome・実bubblewrap: `scripts/verify-scratch.mjs`。会話指示から汎用Python/Pillowのコードを決定し、指定構想図を作成。ImageStore登録、read_image、返答画像表示、調査メモdownload、再起動、Codexセッション切替、work list/readによる必要ファイル再取得を確認。
- [日本語構想図](secretary-work-evidence/concept.png)、[会話表示](secretary-work-evidence/conversation.png)、[実測結果](secretary-work-evidence/live-result.json)。公開用証拠には認証・セッションID・内部ログを入れていない。内部状態と詳細記録は工房の`.runtime`にのみ残す。

稼働コアへの反映、mainのPR/マージ、Agent承認・解放は実施していない。工房Pushだけでは稼働中の村に反映されない。コア設備の検証も別途必要。

2026-10-24 工房での最終結果: `check`成功、Node **105/105成功・skip0**、UI全体 **28/28成功**、writeの同時実行排他を追加後の関連UI **2/2成功**、`build`成功、`git diff --check`成功。導入スクリプトを実行して生成したランタイムでもNode全件と関連UIを再確認した。実Codex検証はfixtureとは別に2回成功。初回は既設bwrapの未対応が検出され、対応版導入後に解決した。既存のprotocolVersion固定期待値も更新して回帰テストを通した。

この工房の成果ルート: `/home/eletim/ai-village-workshop/6c61f1c5-ff96-4683-bad9-98e9f528b65b/source`。実Codexの保存状態と元証拠は `.runtime/scratch-live-final/`、Nodeログは `.runtime/node-tests-final.log`、UIログは `.runtime/ui-final.log` / `.runtime/ui-last.log`、導入ログは `.runtime/setup-scratch.log`。これらの内部状態はGitに含めない。共有する図・画面・要約結果だけを `docs/secretary-work-evidence/` に収録する。


## レビュー修正とコア反映への接続

今回の基盤は `7000a41834ce3a2b7d6764c62fed3d736db0e010`。旧保存commit `07272feb9626b6dcb9008eb4399b3ecda5b5c296` を今回のGit接続で照合して取り込んだ。信頼済みworkspace exec、担当workshop cli、operations reconcile、復旧改修を保持している。隔離型scratchの失敗からworkspace execへfallbackしてはならない。

1. 運用者が対象ホストの公開ランタイム領域へ明示的に `npm run scratch:setup -- /絶対パス/scratch-tools` を実行する。導入は再実行可能。sudo・設備の自動変更・反映中のネットワーク導入は行わない。
2. バックエンドと反映workerの両方へ `VILLAGE_SCRATCH_RUNTIME=/絶対パス/scratch-tools/python`、`VILLAGE_SCRATCH_BWRAP=/絶対パス/scratch-tools/bubblewrap/build/bwrap` を設定する。使い捨てcandidate worktree内や相対パスを使わない。
3. `npm run scratch:doctor` は同じrunnerによる実namespace/seccomp境界、Pillow/Noto日本語PNG生成とデコードを検査する。設定不足・bwrap起動不可・namespace禁止・ライブラリやフォント不足は非zero終了で理由を返す。インストールや非隔離実行への切替はしない。
4. `npm run test:scratch` は必須モード。doctor成功後にscratch全テストを実行し、未設定でのskipを成功にしない。全Node/UIを必須実行する場合も `VILLAGE_SCRATCH_REQUIRED=1` を設定する。通常テストの設備未設定skipは実隔離の検証成功ではない。
5. `scripts/apply.mjs` は対象candidateのdoctorを **取り込み前** に呼ぶ。設定がある場合は必須scratchテストも実行し、全Node/UIに必須フラグを渡す。両設定なし・必須指定なしの場合は `mode=disabled, verification=NOT RUN, available=false` をchecksに保存して既存機能だけの反映を続行する。scratch未搭載の旧candidateはこの追加工程の対象外。
6. 起動時の診断成功時だけ `work run` をレジストリに公開する。診断失敗でも既存workspace/CLIと保存ファイルの照会・公開を維持する。`work status`で再診断できるが、導入後のrun公開にはバックエンド再起動が必要。起動後に設備が壊れた場合も実行はfail closed。

初回反映には注意が必要: 既に起動している旧コアの反映workerにはこの追加工程がまだない。初回はコア運用者が候補checkoutで上記doctor・必須テスト・全Node/UIを実行してから反映する必要がある。本工房から稼働コアの設備変更・接続・反映はしない。以降、この版のworkerが起動する反映では追加工程が自動で実施される。設定値のサービスへの永続化もコア運用者の作業である。

cancelの返値は `accepted`（要求受付）、`state`、`stopConfirmed` を区別する。停止要求直後はrunningのままになり得る。getで終了記録を確認する。fixtureで受付後もrunningを再現し、実bwrapでもcancel後のgetがcancelled・finishedAt付きになることを検証する。

累積quota・自動削除は追加していない。履歴と公開snapshotは増え続けるため運用者の容量監視が必要。保存済み成果の勝手な削除で制約を隠さない。

## 今回の工房実測（2026-10-25）

成果ルート: `/home/eletim/ai-village-workshop/6b1b4e36-d5db-4e7a-a3ab-3b972ae9f725/source`。旧工房・workspace・tabは利用していない。旧画像・旧実Codex記録は履歴資料として保持し、今回の成功件数には含めない。

| 検証 | 今回の結果 | 記録（成果ルートからの相対パス） |
| --- | --- | --- |
| 専用場所への導入 | exit 0、ローカルbubblewrap v0.11.0とPillowを導入 | `.runtime/setup.log` |
| check / build / diff --check | 成功 | `.runtime/check.log`, `.runtime/build.log` |
| 全Node（実ランタイム、必須） | 117成功、失敗0、skip0 | `.runtime/node.log` |
| 全UI（実Chrome） | 28成功、失敗0、skip0 | `.runtime/ui-final.log` |
| 最終診断修正後のscratch UI再検証 | 2成功、skip0（全UIの部分集合） | `.runtime/ui-scratch-final.log` |
| 必須scratch | doctor成功、7成功、skip0（全Nodeの部分集合） | `.runtime/required.log` |
| ランタイム未設定の全Node | 114成功、skip3。実隔離・実cancel中断・秘書fixture実隔離の3件は設備未設定のため未検証 | `.runtime/node-disabled.log` |
| 未設定doctor / 必須入口 | 両方exit 1（期待どおりの設備不足） | `.runtime/doctor-missing.log`, `.runtime/required-missing.log` |
| 既設bwrap診断 | exit 1、Unknown option --size | `.runtime/doctor-system-bwrap.log` |
| 空の設定runtime診断 | exit 1、configured runtime lacks Pillow | `.runtime/doctor-missing-pillow.log` |

実bwrap/seccompで領域外アクセス・fork/socket・出力量・CPU・メモリ・容量制限、永続化、SIGKILL後unknown、cancel/getを検証した。今回生成した[日本語PNG](secretary-work-evidence/review-japanese.png)は実隔離Pillow/Notoによるもので、ImageStoreでデコードし、実画像の文字表示も確認した。詳細は `.runtime/review-evidence/result.json`。

秘書の意思決定と会話画像表示はfixture。反映工程の追加2件は実apply worker/doctorを使用し、Git/npmをfixtureへ置き換えて取り込み直前で止めた検証であり、コア反映の実測ではない。既存workspace/担当CLI/復旧の回帰を含む全Nodeが成功した。今回、実Codexの自然言語判断能力は再検証していない。稼働コアの設備・サービス環境・初回反映・再起動後稼働は未確認であり、別途コアが実施する。
