---
name: 第一工房
ssh_host: E-ryzen
purplemux_url: http://e-ryzen.tail6bc726.ts.net:8022/
work_root: /home/eletim/ai-village-workshop
---
# 第一工房 — E-ryzen

AI村の最初の工房です。専用ディレクトリとPurpleMuxのCodex tabを使い、自然文で任せた仕事を実行します。ここに書く設備は調査時点の記録です。現在の負荷やAgentの実行状況とは区別してください。

## 接続と作業場所

接続には上の `ssh_host` をSSHエイリアスとして使います。PurpleMuxのブラウザURLは `purplemux_url`、仕事の保存先ルートは `work_root` です。仕事ごとにUUIDの子ディレクトリと専用workspaceを作ります。CLIはSSH先のログインシェル（`bash -lic`）で利用できます。

PurpleMux CLIは工房の `~/.purplemux/port` と `~/.purplemux/cli-token` を読みます。秘密の値を資料やブラウザへ書かないでください。ブラウザは別途ログインが必要です。ログイン後に対象tabのリンクをもう一度開く場合があります。

## 実物で確認したCLIの使い方

```bash
purplemux --help
purplemux api-guide
purplemux workspaces
purplemux workspace create --cwd /絶対パス --name 名前
purplemux tab create -w WORKSPACE_ID -n レン -t codex-cli
purplemux tab send -w WORKSPACE_ID TAB_ID '自然文の仕事'
purplemux tab status -w WORKSPACE_ID TAB_ID
purplemux tab result -w WORKSPACE_ID TAB_ID
purplemux tab list -w WORKSPACE_ID
purplemux tab close -w WORKSPACE_ID TAB_ID
purplemux workspace delete -w WORKSPACE_ID --if-empty
```

`workspace create`のJSONに初期terminalの`initialTab.tabId`が含まれます。`tab status`の`cliState=busy`が作業中、`tab result`の`status=completed`と`text`が完了した自然文の報告です。captureは画面の観察用で、成果の代わりにはしません。`tab close`は対象tabのtmuxセッションとプロセス群を終了し、プレーンテキスト`ok`を返します。別tabには触れず、workspace削除には空であることを条件にする`--if-empty`を使います。

端末リンクは `purplemux_url` のルートに `?workspace=WORKSPACE_ID&tab=TAB_ID` を付けます。この形式はPurpleMuxのdeep-link実装と照合済みです。未ログインのブラウザではログイン画面へ戻るため、ログイン後の対象端末表示は引き続き確認が必要です。

## 確認済みの設備とツール

2026-10-22 JST、SSH先で読み取り専用のコマンドを使って確認しました。

- Linuxカーネル6.8.0-138-generic、x86_64。
- CPU：AMD Ryzen 9 7900X、12コア・24スレッド（`lscpu`）。
- メモリ：約30GiB、スワップ約32GiB（`free -h`）。
- GPU：NVIDIA GeForce RTX 4060、VRAM 8,188MiB（`nvidia-smi`）。
- 作業先のファイルシステム：`/dev/nvme0n1p2`、総容量916GiB。調査時点で使用57%・空き378GiB（`df -h`）。空き容量は現在値を保証しません。
- Node.js v22.23.2、Codex CLI 0.163.0、Python 3、Google Chrome、PurpleMux CLIが利用可能。
- これまでの実検証では、テキストファイル、ボタン付き一枚HTMLの制作と自然文の報告を実行できました。

## 未確認のこと

得意分野や品質、長時間の制作能力はまだ評価していません。専門性があると推測しないでください。CUDA等の開発環境の詳細、追加GPUの統計、あらゆる制作ツールの動作も未確認です。負荷・メモリ使用量・空き容量・Agentの状態は、必要なときに状況照会してください。

2026-10-22の追加確認：インストール済みPurpleMuxの `src/lib/tmux-target.ts` ではmanaged socketは `purple`。`tmux -L purple display-message -p -t =SESSION_NAME: "#{pane_pid}"` で対象セッションのpane PIDを照会できます。Codexのツールが別プロセス群を作るため、村の解放処理はtabを閉じる前に対象paneの子孫を記録し、tab close後にも停止を確認します。他のtabのプロセスは操作しません。
