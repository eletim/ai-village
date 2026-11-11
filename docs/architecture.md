# AI村の目標設計

この文書を概念・責務・依存関係の基準とする。現在は単一化の第1段階。
過去のstate-stage文書は当時の検証記録であり、現在の配線の仕様ではない。

## 用語

| 名前 | 唯一の意味 |
| --- | --- |
| 村長 | 依頼し、成果や要確認を判断する人間 |
| 秘書Agent | 村長の家に配置した通常のAgent。相談・取りまとめを担う。別の執務室プロセスはない |
| 工房Agent | 工房に配置した通常のAgent。作業を担う |
| Agent | PurpleMuxの専用タブで実行するClaude/Codex。接続先とセッションを持つ |
| 工房（PC） | 登録された実行先PCと作業場所。AgentやProjectとは別 |
| 村長の家 | 秘書Agentの画面上の配置場所。特別なCLIや独立の状態機械を持たない |
| Project | Agentをまとめ、方針を共有する分類。依頼の完了単位ではない |
| 依頼 | 人間の目的を追跡する単位。進行中/完了/取り下げと要確認の印を持つ |
| 送信（run） | 1回の入力とnative記録の照合単位。再試行は別の送信 |
| 委任 | 同じ依頼内で別Agentへの親子付き送信を正式に作る操作 |
| 報告 | 依頼の成果を人間向けにまとめる送信。通常回答と同じnative終了を用いる |
| 完了申告 | 委任ありのまとめ役が記録する判断。正常終了など観察事実と合わせて評価する |

「ジョブ」「執務室秘書」「承認でタブを解放する報告」は廃止する。Agentの停止と依頼の完了は別。

## モジュール地図と依存の向き

HTTP/CLI → アプリケーション操作 → 依頼の流れ/Agent管理 → 状態モデル・接続・記録読取・保存。
状態モデルは外部I/Oを知らず、下位層はHTTPや画面を知らない。画面はAPIの投影を読む。

| 責務 | 第1段階の配置 | 目標 |
| --- | --- | --- |
| 状態ディレクトリ/コマンド実行/SSH | server/execution.mjs | 明示した接続先だけ実行。旧ジョブに依存しない |
| 保存 | direct-store、各専用ストア | 版付きスナップショット、事前バックアップ、単一所有者 |
| PurpleMux操作 | direct.mjsのpmux/execute | 接続層に依存する独立アダプタへ分離 |
| native読取/照合 | runtime-events/index、Python読取器 | 観察事実を返す。出力文を判断材料にしない |
| 状態モデル | state/*.ts | Agent7、送信5＋結果4、依頼3＋要確認。唯一の正本 |
| 依頼の流れ | requests.mjs、request/run-lifecycle | 生成・委任・結果配送・報告・通知をモデル経由で調整 |
| Agent管理 | direct.mjs、agent-lifecycle | 起動停止意図と観察の統合 |
| Agent文面 | 現在はdirect/requests/input-envelope等 | 1つの規則定義から起動文・動的入力・helpを生成 |
| HTTP/CLI | scripts/dev.mjs、operations.mjs、scripts/village.mjs | 同じ操作を呼ぶ薄い境界 |
| 表示 | village-map、direct、report-view | 地図は配置、Workspaceは会話と人間操作 |
| 横断機能 | library、todos、travel、images/attachments、notifier、pull-requests | 依頼/ジョブ実行を所有しない |

## 単一の情報源と段階計画

1. **このPR**: 旧執務室・ジョブ配線を完全撤去。実行/ディレクトリを独立。
   state.json/conversation.jsonは読まず、書かず、削除しない。自動移行・旧ジョブ再開も行わない。
   旧URLは404とし別画面への暗黙互換を残さない。READMEを現行機能だけにする。
2. **状態移行の完了**: runModel/requestModel/agentModelだけを内部で参照。
   projectObservationによる旧state書込、acceptance/blocksInput、work状態、ticket/inbox/w.finishの
   重複表現を除去。API/UIも型付き投影に切替。acknowledge互換を終了する。
   本番進行中入力を保つ版付き移行と段階2〜4の不変条件をテストする。
3. **規則文の単一化・照合の一本化**: 規則は1か所に定義し文面とhelpを生成。
   毎回は人間本文＋識別タグ＋必要な動的資料だけ。入力照合はrun目印のみ。
   inputHash一致とunpasted依存は、旧進行中入力の扱いを明示した移行後に除去する。
4. **PurpleMux正式機能**: 追加指示用の公式API/起動設定をPurpleMux側に用意し、
   内部promptファイル直接追記を廃止。現行hash確認/legacyフォールバックはその切替まで維持。
5. **責務分割・docs統合**: direct/requestsから接続、観察、配信、文面を順に分離。
   本文解析・不明入力自動再送・成功推測を入れず、実機の委任/再起動/通知1回を維持する。
   現行仕様をarchitecture/state-modelに集約し、段階別文書は検証履歴と明記する。

第1段階で残る旧状態投影や文面の複数管理は未解決事項であり、単一化済みとは扱わない。

## 操作の残す/消す基準

DirectAgentsと横断ストアだけで成立する操作を残す。旧ジョブID/執務室会話/ジョブ成果物/
自己開発デプロイ監視を必要とする操作は削除する。代替として同名の別意味を設けない。

- 維持: agents、workshops pattern、projects、requests、reports status/configure、travel、
  todos、images upload/list、notifications、web read、PR管理、help、文書閲覧。
- 廃止: jobs全操作、reports list/get/approve、desk、history（旧ジョブ検索）、images import、
  development、deployments。開発作業は通常の依頼としてAgentが行い、専用自動反映機構は持たない。
- `/api/village`、`/api/direct/*`、health、文書/添付/画像/TODO/出張先APIを維持。
  `/api/state`、`/api/jobs*`、`/api/messages`、`/api/secretary/*`、`/office*`を廃止する。
