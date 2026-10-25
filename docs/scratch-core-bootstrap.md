# 隔離scratchの永続runtimeと初回コア導入

村長発言 `fdc92d0a-d7f7-43cf-8209-ebd305712c54` に基づく修正。工房からコア設備を操作せず、初回導入・必須検証は秘書がコアで確認する。今回の仕事は自動反映しない。報告承認・Agent解放・main操作は不要。

## 固定した取得元と設備

`scripts/scratch-sources.json` が配布物の出典・バージョン・SHA-256のロック。ダウンロード後に検証し、不一致は停止する。PyPIのwheelは公式JSONのdigestを収録し、pipの `--isolated --require-hashes --only-binary=:all: --no-deps` を使う。未知のソースビルド・依存の追加解決をしない。

- bubblewrap 0.11.0: [upstream](https://github.com/containers/bubblewrap/tree/9ca3b05ec787acfb4b17bed37db5719fa777834f)、commit `9ca3b05ec787acfb4b17bed37db5719fa777834f` のarchive。
- libcap 2.76: [kernel.org配布](https://www.kernel.org/pub/linux/libs/security/linux-privs/libcap2/libcap-2.76.tar.xz)。ローカル `libcap.a` とheaderだけをビルドし、bubblewrapへ静的リンク。pkg-configの検索をローカルlibcapだけに限定し、システムlibcap-dev/SELinuxを使わない。
- libseccomp 2.5.5: [公式release](https://github.com/seccomp/libseccomp/releases/tag/v2.5.5)。release archiveに同梱された生成済みsyscall表を使う。gperfは不要。再生成が必要になった場合は `/bin/false` で失敗し、生成を成功扱いしない。共有ライブラリを `python/libseccomp.so.2` に置き、固定runnerから絶対パスでロードする。
- [Pillow 12.3.0](https://pypi.org/project/Pillow/12.3.0/)、Meson 1.12.1、Ninja 1.13.2。システムPillow 9.0.1は変更しない。
- [Noto CJK Sans 2.004](https://github.com/notofonts/noto-cjk/tree/Sans2.004): `NotoSansCJK-Regular.ttc` とOFL LICENSE。font自体も固定hashで確認。

対象はLinux、Python 3.10以上、gcc・make・ar・pkg-config・pip、C標準/カーネルheader、HTTPS取得可能な環境。コア申告のgcc/pkg-config/pipに加え、make/arとheaderの存在はビルドで確認する。インストール済みbwrap、libcap開発パッケージ、Notoフォント、gperf、sudoは不要。user namespaceの成功だけでは十分でなく、実bwrapとseccompの検証が必要。AppArmor等で拒否された場合も停止し、ホスト設定を自動変更しない。

bootstrapは新しい絶対パスへだけ書く。存在するruntimeには上書きしない。中断・失敗したディレクトリは未完成として残るので、原因解決後は新しい版名へ再導入する。完了時に `sources.json` と `installed.json` を記録するが、設定の書換えやサービスの起動はしない。`scratch:preflight` は候補コードのsource lockとの一致、配置済みファイルのhash、使用するruntime/bwrap/fontの一致を確認した後、実隔離の必須テストを行う。ローカル管理者によるruntime/manifest改変を防ぐ署名方式ではないため、runtimeと設定は村の運用ユーザーだけが管理する。

## 永続設定

既定は実バックエンドの状態ディレクトリ (`VILLAGE_STATE_DIR`、未指定時は稼働ソースの `.runtime`) 内の `scratch.json`。設定例は次の2キーだけ。

```json
{"version":1,"runtimeRoot":"/absolute/persistent/scratch-runtime-v1"}
```

認証値・環境変数辞書・マウント一覧・shellは受け付けない。未知キー、相対root、不正JSON、指定した設定ファイルの欠落は失敗する。バックエンドではscratchだけを無効化し、保存ファイル操作・信頼済みworkspace exec・担当workshop CLIを維持する。workerとpreflightでは非zero/failedにする。

`VILLAGE_SCRATCH_CONFIG` は設定ファイルの絶対パスを明示できる。空文字は設定ファイルの読取りを明示的に無効化する。`VILLAGE_SCRATCH_RUNTIME / BWRAP / FONT / REQUIRED` の明示環境値は、空文字も含めJSONから補完しない。空のbwrap/fontから別設備へ自動切替しない。通常の新規導入ではこれらをexportせず、既定の `scratch.json` だけを使う。

supervisorは設定値を環境へ固定しない。起動されるバックエンドが毎回ファイルを読むため、再起動後も設定が適用される。新workerは起動時に同じ読取関数を実状態ディレクトリに対して使い、得られた限定値をcandidateの検証へ渡す。worker実行コードと設定読取moduleは両方deploymentディレクトリへコピーし、checkout更新から独立させる。取り込み前preflightに加え、再起動後healthのscratch.availableも確認する。

隔離内へ渡すフォントは1ファイルだけ。runtimeのpython領域だけを `/runtime` へ、フォントを固定の `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` へ読取専用bindする。downloads、build-tools、libcap、src、設定・manifestはマウントしない。任意マウント設定はない。非隔離fallbackはない。

## 秘書がコアで行う初回手順

以下は**コア運用者用**。工房では実施しない。旧apply workerは新preflightを呼べないため、既存反映窓口を使う**前に**、報告された同一commitの独立checkoutでこの手順を完遂する。設備不足・skip・未実施を成功として反映しない。

1. 既存 `development inspect JOB_ID` で仕事・割当ブランチ・完成報告・リモート先端を確認。他の仕事/反映が実行中なら開始しない。実稼働の開発資料とsupervisorから、ソースと状態ディレクトリの絶対パスを確認する。次の変数だけをその実値に設定する。`EXPECTED` はこの仕事の最終報告の完全SHA。コアの認証値は表示・コピーしない。

```sh
SOURCE='/実稼働ソースの絶対パス'
STATE='/実稼働状態ディレクトリの絶対パス'
EXPECTED='最終報告の40桁commit SHA'
BRANCH='village/work-250bb873-6fc6-411b-89ac-52c334b22de9'
RUNTIME="$HOME/.local/share/ai-village/scratch-250bb873-v1"
REVIEW="$HOME/.local/share/ai-village/review-250bb873"
set -eu
test -f "$STATE/supervisor.json"
test -z "$(git -C "$SOURCE" status --porcelain)"
test "$(git -C "$SOURCE" branch --show-current)" = feat/live-workshop
git -C "$SOURCE" fetch origin "refs/heads/$BRANCH"
test "$(git -C "$SOURCE" rev-parse FETCH_HEAD)" = "$EXPECTED"
git -C "$SOURCE" merge-base --is-ancestor HEAD "$EXPECTED"
mkdir -p "$(dirname "$REVIEW")"
git -C "$SOURCE" worktree add --detach "$REVIEW" "$EXPECTED"
cd "$REVIEW"
npm ci
npm run scratch:setup -- "$RUNTIME"
```

2. 稼働supervisorの `VILLAGE_SCRATCH_CONFIG/RUNTIME/BWRAP/FONT/REQUIRED` の明示値の有無を確認する。**環境全体は出力しない**。下記はその5値だけを読み、認証環境を出さない。既存の明示値がある場合、無条件にunsetして検証を通さない。そのサービス起動設定を新runtimeに揃えてsupervisorを通常の管理手順で再起動し、同じ5値を確認するか、意図した既存値を保持してその値で検証する。古いruntimeへのoverrideが残ったまま新JSONだけで成功としない。

```sh
node --input-type=module - "$STATE" <<'JS'
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const s=JSON.parse(readFileSync(resolve(process.argv[2],'supervisor.json'),'utf8'));
const keys=new Set(['VILLAGE_SCRATCH_CONFIG','VILLAGE_SCRATCH_RUNTIME','VILLAGE_SCRATCH_BWRAP','VILLAGE_SCRATCH_FONT','VILLAGE_SCRATCH_REQUIRED']);
const values=Object.fromEntries(readFileSync(`/proc/${s.pid}/environ`,'utf8').split('\0').filter(x=>keys.has(x.split('=')[0])).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
console.log(JSON.stringify(values,null,2));
JS
```

3. 標準経路（上の結果が `{}`）では候補の設定を作り、同じ設定で必須preflightと全回帰を実施する。隔離したUI state/portを使う。Chromeのパスはコアで存在を確認した実体に置き換える。fixture CodexはこのUI試験にだけ指定する。

```sh
mkdir -p "$REVIEW/.runtime"
python3 - "$RUNTIME" "$REVIEW/.runtime/scratch.json" <<'PY'
import json,os,sys
with open(sys.argv[2], 'x') as f: json.dump({'version':1,'runtimeRoot':sys.argv[1]}, f)
os.chmod(sys.argv[2],0o600)
PY
export VILLAGE_SCRATCH_CONFIG="$REVIEW/.runtime/scratch.json"
npm run scratch:preflight
npm run check
npm test
VILLAGE_TEST_PORT=5298 VILLAGE_TEST_STATE="$REVIEW/.runtime/ui-state" \
 VILLAGE_TEST_CODEX_BIN="$REVIEW/tests/fixtures/secretary-codex.mjs" \
 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:ui
npm run build
git diff --check
test "$(git rev-parse HEAD)" = "$EXPECTED"
```

明示設定を維持する経路では、同じ検証shellに確認した5値だけを設定する。`CONFIG` が明示されているならその永続ファイルを使い、candidate内の一時設定で置き換えない。preflightが使用先の不一致を検出した場合は反映せず、サービス設定と検証設定を揃える。

4. 全成功・scratchテストskip0を確認してから、標準経路では実状態ディレクトリへ設定を永続化する。既存ファイルがある場合は勝手に上書きせず内容を照合する。以下は初回だけを扱い、既存設定があれば停止する。runtimeはreview worktree外にあるため、candidate削除後も残る。

```sh
python3 - "$REVIEW/.runtime/scratch.json" "$STATE/scratch.json" <<'PY'
import os,sys
from pathlib import Path
src,dst=map(Path,sys.argv[1:])
with dst.open('x') as f: f.write(src.read_text())
os.chmod(dst,0o600)
PY
unset VILLAGE_SCRATCH_CONFIG
VILLAGE_STATE_DIR="$STATE" npm run scratch:preflight
```

5. 秘書が結果・runtime・設定先・同一SHAを確認し、再度 `development inspect JOB_ID` で先端を照合してから、**既存窓口の** `development apply JOB_ID` を実行する。手動merge・main操作・直接runner起動はしない。旧worker内部のscratch未実施は、上の外部必須検証を代替しない。先端が変わったら新しいcommitで手順をやり直す。初回失敗後の再試行は理由を解消し、既存窓口の `--retry` を使う。

6. `deployments get ID` でappliedCommit・再起動・保存会話/仕事復元・Pushを確認。初回旧workerにはscratch health確認もないので、反映後に既存窓口の `work status` がavailable=true、`work run` が公開されていることを別途確認する。稼働ソースでも `VILLAGE_STATE_DIR="$STATE" npm run scratch:preflight` を実施し、日本語PNGを生成・publishして執務室で確認する。どこかが失敗なら「コアで利用可能」と報告しない。既存機能は維持し、自動rollbackや非隔離fallbackをしない。

この初回作業が済んだ後、新workerでは同じ永続設定から取り込み前必須検証と再起動後可用性確認が行われる。工房のPushは反映完了ではない。
