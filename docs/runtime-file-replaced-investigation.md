# 'runtime-file-replaced' の誤検知調査

長時間稼働していた前任秘書session（約8時間、`.jsonl`が5.58MBまで成長）で、`correlate()`が `'runtime-file-replaced'` を返し、runが`state:'unknown'`のまま永久に固まった事例の根本原因調査。

## 発生経路

- `server/runtime-events.mjs` の `correlate()`: `run.baselineRuntime?.fileIdentity&&snapshot.fileIdentity!==run.baselineRuntime.fileIdentity` で`fileIdentity`の不一致を検出し`'runtime-file-replaced'`を返す。
- `fileIdentity`は `server/runtime_index.py` の `index_read()` 内、`same_source(p)` が偽（＝前回チェックポイントと「同一ソース」とみなせない）のときに、新しいuuidを付与して発行される（`reset`処理、100-110行目付近）。

## 根本原因（確定）

`same_source(p)` の判定条件のひとつ:

```python
not (now[2]==p['stat'][2] and now[3:]!=p['stat'][3:])
```

これは「サイズが前回と同じなら、`mtime_ns`と`ctime_ns`の**両方**が前回と完全一致していなければならない」という条件。`ctime`はLinux上で、**内容を一切変更しないメタデータ操作**（`chmod`、`utime`、拡張属性/ACLの書き込み、ハードリンク数の変化など）でも更新される。`mtime`はそのような操作では変化しない（contentが変わる`write()`/`truncate()`のときだけ変化する）。

つまり、ファイルサイズが前回ポーリング時と同じ（＝ポーリング間隔中に新しい行が追記されなかった、アイドル中などによくある）タイミングで、何らかのプロセスがそのファイルに対して**内容を一切変えないメタデータ操作**を行うと、`ctime`だけが動き、`mtime`・`edges()`（内容ハッシュ）は不変のまま、この条件が偽陽性で発火する。同じ箇所がもう一箇所（`index_read()`内、読み取り中の競合検知）にも存在した（126行目付近）。

### 再現実験（確定）

実際のClaude Codeセッション（`.jsonl`）のコピーに対し、Pythonで直接 `stat()` を比較:

```
chmod のみ: size_same=True mtime_changed=False ctime_changed=True edges_match=True => 旧ロジックでは same_source=False（誤検知）
utime（mtime明示変更）: mtime_changed=True ctime_changed=True => same_source=False（これは正しい陽性。mtimeが実際に動いているため）
read-only open: 変化なし → 影響なし
hardlink追加/削除: ctimeのみ変化 → 旧ロジックでは誤検知
```

`chmod`だけで、内容・サイズ・mtimeが一切変わらないまま`ctime`だけが動き、旧ロジックの`same_source()`が偽になることを実機で確認した。

### 実際にどの操作が8時間セッション中に起きたかは特定できていない

ファイル自体（dev/inode）は一貫して同一であり、truncateの形跡もない。`chmod`/`utime`/拡張属性/ACL/ハードリンク変化のいずれかが実際に起きたかはログに残っておらず、該当時点のキャッシュ（`.source.json`）はその後の再構築で上書きされ消失している。ただし、**`ctime`だけが動き得る操作のクラス自体が実在し、現在のロジックがそれに対して脆弱である**ことは実機再現により確定している。長時間稼働のLinuxホームディレクトリでは、バックアップ/同期ツール、ウイルススキャナ、SELinux/AppArmorの再ラベリング、あるいは単に別プロセスがハードリンクを張る/外すといった操作が、何時間かに一度でも起これば十分に説明がつく。

また、約30分間（1.5秒間隔、3つの実際に稼働中のAgentセッションファイルを並行監視）および約15分間（0.1秒間隔、単一の稼働中セッションファイルを監視）、実際に成長中のセッションファイルに対して`same_source()`相当のチェックを継続的に実行したが、この短い観測窓では自然発生の偽陽性は再現しなかった（低頻度の事象のため、これは予想される結果であり、上記の`chmod`再現実験のほうが根本原因の直接証拠）。

## 修正

`server/runtime_index.py` の2箇所（`same_source()`、読み取り中の競合検知）で、`now[3:]!=p['stat'][3:]`（mtime・ctime両方の不一致を要求）を `now[3]!=p['stat'][3]`（mtimeのみ）に変更。

- `mtime`は実際のcontent変更（write/truncate）でのみ動くため、これだけで十分な一次シグナルになる。
- `edges()`（先頭4KiB＋オフセット直前4KiBの内容ハッシュ）は既存のまま維持しており、mtimeの変化とは独立に実際のバイト内容も確認する。
- 「本当の置換検知」（内容が変わるrewrite、truncate、別ファイルへの置換）は、`edges()`の不一致および/または実際の`mtime`変化（真の書き込みは必ずmtimeを更新する）で引き続き検知される。既存テスト「same-size rewrite, truncation, inode replacement...」（同じ長さの文字列置換＝同サイズ書き換え）がこの退行がないことを検証している。

## 新規テスト

`tests/runtime-index.test.js`: `chmod`のみ（内容・mtime不変、ctimeのみ変化）では`fileIdentity`が回転しないこと、続けて本当の同サイズ書き換え（`content.replace('hello','other')`、mtimeも実際に動く）では引き続き`fileIdentity`が回転し`correlate()`が`'unknown'`を返すことを確認。
