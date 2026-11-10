# 'runtime-file-replaced' の誤検知調査

長時間稼働していた前任秘書session（約8時間、`.jsonl`が5.58MBまで成長）で、`correlate()`が `'runtime-file-replaced'` を返し、runが`state:'unknown'`のまま永久に固まった事例の根本原因調査。

## 発生経路

- `server/runtime-events.mjs` の `correlate()`: `run.baselineRuntime?.fileIdentity&&snapshot.fileIdentity!==run.baselineRuntime.fileIdentity` で`fileIdentity`の不一致を検出し`'runtime-file-replaced'`を返す。
- `fileIdentity`は `server/runtime_index.py` の `index_read()` 内、`same_source(p)` が偽（＝前回チェックポイントと「同一ソース」とみなせない）のときに、新しいuuidを付与して発行される（`reset`処理）。

## 根本原因（確定）

`same_source(p)` の判定条件のひとつ:

```python
not (now[2]==p['stat'][2] and now[3:]!=p['stat'][3:])
```

これは「サイズが前回と同じなら、`mtime_ns`と`ctime_ns`の**両方**が前回と完全一致していなければならない」という条件。これが2段階の調査・実験で誤りだと判明した。

### 実験1: chmodのみ（合成実験）

実際のClaude Codeセッション（`.jsonl`）のコピーに対し、`chmod`だけを実行して`stat()`を比較:

```
chmod のみ: size_same=True mtime_changed=False ctime_changed=True edges_match=True => 旧ロジックでは same_source=False（誤検知）
```

`ctime`はLinux上で、**内容を一切変更しないメタデータ操作**（`chmod`、拡張属性/ACLの書き込み、ハードリンク数の変化など）でも更新される。`mtime`はそのような操作では変化しない。この時点では「`mtime`だけを見ればよい」という仮説のもとで修正し、`now[3:]!=p['stat'][3:]`（mtime・ctime両方）を`now[3]!=p['stat'][3]`（mtimeのみ）に変更していた。

### 実験2: 実際に稼働中のセッションファイルを継続監視（自然発生の再現）

修正の妥当性を検証するため、実際に成長中の複数のClaude Codeセッションファイル（本タスク自身の稼働中セッションを含む）に対し、1.5秒間隔×約30分（計1199回ポーリング）と0.1秒間隔×約15分（単一ファイル、148回の変化を記録）、`same_source()`相当のチェックを継続実行した。

**30分間の監視で、自然発生の異常を1件捕捉した**（poll 830、監視開始から約1244秒後）:

```
size: 4200052 → 4200052（不変）
mtime_ns: 1794328890516940066 → 1794329151286000000（変化）
ctime_ns: 1794328890516940066 → 1794329151285846174（変化）
edges（先頭4KiB＋オフセット直前4KiBの内容ハッシュ）: 完全一致（不変）
```

**サイズ・内容（edges）は完全に不変のまま、`mtime`と`ctime`が両方動いた。** これは「mtimeだけを見れば安全」という実験1由来の仮説を直接反証する。外部プロセスによる`chmod`等ではなく、おそらくClaude Code CLI自身の内部的な書き込み（事前確保・チェックポイント相当の、可視内容を変えないinode更新）が原因と推測されるが、具体的な操作そのものは特定できていない。

### 結論

**`mtime`・`ctime`のどちらも、単体でも組でも、信頼できるcontent変更の指標ではない。** 実際のバイト内容を確認する`edges()`（先頭4KiB＋オフセット直前4KiBのハッシュ）だけが、この用途で信頼できるシグナルである。同じ問題がもう一箇所（`index_read()`内、読み取り中の競合検知）にも存在した。

### 実際に8時間セッション中に起きた具体的な操作は特定できていない

ファイル自体（dev/inode）は一貫して同一であり、truncateの形跡もない。該当時点のキャッシュ（`.source.json`）はその後の再構築で上書きされ消失しているため、当時何が起きたかの直接証拠はない。ただし、**「サイズ・内容が不変のまま時刻だけが動く」事象のクラス自体が実在し、現在のロジックがそれに対して脆弱である**ことは、合成実験（chmod）と自然発生の実測（上記）の両方で確定している。

## 修正（最終）

`server/runtime_index.py` の2箇所（`same_source()`、読み取り中の競合検知）から、タイムスタンプ比較を完全に除去し、`edges()`（内容ハッシュ）・サイズ非減少・dev/inode一致のみで同一性を判定する。

- `same_source(p)`: `now[3:]!=p['stat'][3:]`（時刻比較）の項を削除。`path`一致・`dev:inode`一致・`size`非減少・`edges()`一致の4条件のみに整理。
- 読み取り中の競合検知（`index_read()`内）: 読み取り開始時に捕捉した`now[2]`（その時点のサイズ）を使い、読み取り直前と直後で`edges(f,now[2])`を2回計算して比較する（`before_edges`）。こちらも時刻比較を完全に撤廃し、同じ理由で`edges()`ベースに統一。
- 「本当の置換検知」（内容が変わるrewrite、truncate、別ファイルへの置換）は、`edges()`の不一致、またはサイズ減少、またはdev/inode不一致で引き続き検知される。既存テスト「same-size rewrite, truncation, inode replacement...」（同じ長さの文字列置換＝同サイズ書き換え）が、この退行がないことを検証している。
- タイムスタンプが本来カバーしようとしていた「`edges()`の4KiB窓に入らない、ファイル中央部だけの同サイズ書き換え」という理論上の穴は残るが、タイムスタンプ自体がその用途で信頼できないことが実測で確定した以上、タイムスタンプを使い続けても実質的な保証は増えない。本システムは単一ユーザー・同一マシンの信頼境界であり、JSONLセッションログは追記のみという前提（既存のcompaction境界テストで実証済み）のもとでは、この残存ギャップは現実的なリスクではないと判断した。

## 新規テスト

`tests/runtime-index.test.js`: `chmod`（ctimeのみ変化）および`utimes()`（mtime・ctime両方が変化、実際の自然発生異常を再現）のいずれでも`fileIdentity`が回転しないこと、続けて本当の同サイズ書き換え（`content.replace('hello','other')`、edges()が実際に不一致になる）では引き続き`fileIdentity`が回転し`correlate()`が`'unknown'`を返すことを確認。
