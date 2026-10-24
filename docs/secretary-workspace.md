# 秘書専用の永続作業場所

村長発言 `90a22eef-b372-4da3-9094-1c4d4dc7eefe` に関する今回の依頼を実装。元発言の稼働コア内原文は読んでおらず、工房に届いた指示を仕様とした。稼働コア・他workspace/tab/仕事には接続していない。

## 会話からの経路

既存のSecretariatはCodexの新規/再開セッションから構造化actionを受け取り、シェルを直接使わせずホストで処理する。今回も`village` action → `VillageOperations`の共通レジストリ → `Scratch`を使用する。新しい自由なホストshell actionは追加しない。manualの当該ターン読取・変更操作のwrite-ahead記録・既存復旧・通知・簡潔な報告方針は維持。既存セッションにもprotocolVersion 6の更新でwork操作を案内する。

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

## 検証成果

- fixtureと実隔離: `tests/scratch.test.js`。パス拒否、資料永続化、通常ファイルのみ、fork/socket/領域外書込み拒否、CPU/メモリ/出力/ファイル容量、cancel、実バックエンドSIGKILL後のunknown照会・再送拒否、fixture秘書のrun→publish→read_image→reply。
- UI fixtureと実隔離: `tests/browser/scratch.spec.js`。HTTP経由の生成・公開、HTML添付download、安全なリンク、Origin拒否、日本語PNG表示・reload。会話部分はfixtureであり実LLMの能力検証とは区別する。
- 実Codex・実Chrome・実bubblewrap: `scripts/verify-scratch.mjs`。会話指示から汎用Python/Pillowのコードを決定し、指定構想図を作成。ImageStore登録、read_image、返答画像表示、調査メモdownload、再起動、Codexセッション切替、work list/readによる必要ファイル再取得を確認。
- [日本語構想図](secretary-work-evidence/concept.png)、[会話表示](secretary-work-evidence/conversation.png)、[実測結果](secretary-work-evidence/live-result.json)。公開用証拠には認証・セッションID・内部ログを入れていない。内部状態と詳細記録は工房の`.runtime`にのみ残す。

稼働コアへの反映、mainのPR/マージ、Agent承認・解放は実施していない。工房Pushだけでは稼働中の村に反映されない。コア設備の検証も別途必要。

2026-10-24 工房での最終結果: `check`成功、Node **105/105成功・skip0**、UI全体 **28/28成功**、writeの同時実行排他を追加後の関連UI **2/2成功**、`build`成功、`git diff --check`成功。導入スクリプトを実行して生成したランタイムでもNode全件と関連UIを再確認した。実Codex検証はfixtureとは別に2回成功。初回は既設bwrapの未対応が検出され、対応版導入後に解決した。既存のprotocolVersion固定期待値も更新して回帰テストを通した。

この工房の成果ルート: `/home/eletim/ai-village-workshop/6c61f1c5-ff96-4683-bad9-98e9f528b65b/source`。実Codexの保存状態と元証拠は `.runtime/scratch-live-final/`、Nodeログは `.runtime/node-tests-final.log`、UIログは `.runtime/ui-final.log` / `.runtime/ui-last.log`、導入ログは `.runtime/setup-scratch.log`。これらの内部状態はGitに含めない。共有する図・画面・要約結果だけを `docs/secretary-work-evidence/` に収録する。
